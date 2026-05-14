require('dotenv').config()
const OpenAI = require('openai')
const { runCredentialingAgent } = require('./credentialingAgent')
const { getPendingAuths } = require('./priorAuthAgent')
const { getOpenReferrals } = require('./referralAgent')
const { notifyPatient } = require('../lib/notify')
const db = require('../db')

// Priority tiers — lower number = higher urgency
// 1: credentials expiring <30 days (practice cannot bill if DEA/license lapses)
// 2: denied claims (revenue already at risk, clock ticking on appeal window)
// 3: patient balances (revenue but slower-burn, no appeal deadline)
// 4: patient care (prior auths, open referrals)
// 5: compliance (warning-level credentials, payer patterns)
// 6: info only
const PRIORITY = {
  CREDENTIAL_CRITICAL: 1,
  REVENUE_AT_RISK: 2,
  PATIENT_BALANCE: 3,
  PATIENT_CARE: 4,
  COMPLIANCE: 5,
  INFO: 6
}

// Mock data for sub-agent outputs that require DB state in production
function getMockERAActionItems() {
  return [
    {
      source: 'era_agent',
      claimId: 'CLM-001',
      payerName: 'Aetna',
      procedureCode: '99214',
      code: 'CO-4',
      plain: 'Procedure/modifier mismatch',
      amount: 250.00,
      priority: 'high',
      aiInstruction: 'Remove the invalid modifier from claim CLM-001 and resubmit to Aetna. The modifier used does not apply to procedure 99214.'
    },
    {
      source: 'era_agent',
      claimId: 'CLM-002',
      payerName: 'Aetna',
      procedureCode: '99214',
      code: 'CO-97',
      plain: 'Payment included in another service',
      amount: 250.00,
      priority: 'high',
      aiInstruction: 'Appeal claim CLM-002 with documentation supporting separate billing for this service.'
    }
  ]
}

function getMockERAPatterns() {
  return [
    {
      type: 'high_denial_rate',
      payer: 'Aetna',
      denialRate: '22.0',
      topCode: 'CO-4',
      message: 'Aetna denial rate is 22.0% — most common reason: CO-4'
    }
  ]
}

function getMockOutstandingBalances() {
  return [
    { patientToken: 'PT-X1Y2Z3A4', balanceDue: 340.00, daysPastDue: 45, payerCode: 'AETNA' },
    { patientToken: 'PT-Y2Z3A4B5', balanceDue: 150.00, daysPastDue: 62, payerCode: 'MEDICARE' }
  ]
}

async function ensureDailyBriefingsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_briefings (
      id                 SERIAL PRIMARY KEY,
      provider_id        INTEGER REFERENCES providers(id),
      date               DATE          NOT NULL,
      total_action_items INTEGER,
      critical_count     INTEGER,
      high_count         INTEGER,
      revenue_at_risk    DECIMAL(10,2),
      summary            TEXT,
      sms_briefing       TEXT,
      created_at         TIMESTAMP DEFAULT NOW()
    )
  `)
}

async function getOutstandingBalances(providerId) {
  try {
    const rows = await db.query(
      `SELECT p.token AS patient_token,
              c.patient_responsibility AS balance_due,
              c.payer_code,
              GREATEST(0, EXTRACT(DAY FROM NOW() - c.created_at)::INTEGER) AS days_past_due
       FROM claims c
       JOIN patients p ON c.patient_id = p.id
       WHERE c.provider_id = $1
         AND c.patient_responsibility > 0
         AND c.status IN ('paid', 'denied', 'needs_action')
       ORDER BY c.patient_responsibility DESC`,
      [providerId]
    )
    return rows.rows.map(r => ({
      patientToken: r.patient_token,
      balanceDue:   parseFloat(r.balance_due),
      daysPastDue:  parseInt(r.days_past_due, 10),
      payerCode:    r.payer_code
    }))
  } catch (err) {
    console.error('[PRACTICE OPS AGENT] Outstanding balances query failed:', err.message)
    return getMockOutstandingBalances()
  }
}

function prioritizeActionItems(items) {
  return [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    // Secondary sort by revenue at risk descending
    return (b.revenueAtRisk || 0) - (a.revenueAtRisk || 0)
  })
}

async function aggregateActionItems({ credentialingResult, eraActionItems, eraPatterns, pendingAuths, openReferrals, outstandingBalances }) {
  const items = []

  // ERA denied claims — highest priority (revenue at risk)
  for (const denial of eraActionItems) {
    items.push({
      source: 'era_agent',
      priority: PRIORITY.REVENUE_AT_RISK,
      type: 'denied_claim',
      title: `Denied claim ${denial.claimId} — ${denial.payerName} (${denial.code})`,
      description: denial.plain,
      aiInstruction: denial.aiInstruction,
      revenueAtRisk: denial.amount,
      urgency: denial.priority === 'high' ? 'high' : 'medium'
    })
  }

  // Credentialing critical alerts — billing stops if credentials lapse
  for (const alert of credentialingResult.alerts) {
    if (alert.level === 'critical' || alert.level === 'expired') {
      items.push({
        source: 'credentialing_agent',
        priority: PRIORITY.CREDENTIAL_CRITICAL,
        type: 'credential_expiry',
        title: `${alert.level === 'expired' ? 'EXPIRED' : 'CRITICAL'}: ${alert.label}`,
        description: `${Math.abs(alert.daysRemaining)} days ${alert.daysRemaining < 0 ? 'overdue' : 'remaining'} — expires ${alert.expiryDate}`,
        aiInstruction: alert.aiInstruction,
        revenueAtRisk: null,
        urgency: 'critical'
      })
    }
  }

  // Prior auths pending — patient care impact
  for (const auth of pendingAuths) {
    const followUpDate = new Date(auth.followUpDate)
    const daysUntilFollowUp = Math.ceil((followUpDate - new Date()) / (1000 * 60 * 60 * 24))
    items.push({
      source: 'prior_auth_agent',
      priority: PRIORITY.PATIENT_CARE,
      type: 'pending_prior_auth',
      title: `Prior auth pending — ${auth.procedureCode} (${auth.payerCode})`,
      description: `Auth ${auth.authId} submitted, awaiting payer response. Follow up in ${daysUntilFollowUp} days.`,
      aiInstruction: `Check auth status for ${auth.authId} with ${auth.payerCode}. If no response in ${daysUntilFollowUp} days, call payer auth line directly.`,
      revenueAtRisk: null,
      urgency: 'medium'
    })
  }

  // Open referrals awaiting specialist response
  for (const referral of openReferrals) {
    const deadline = new Date(referral.responseDeadline)
    const daysUntilDeadline = Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24))
    const overdue = daysUntilDeadline < 0
    items.push({
      source: 'referral_agent',
      priority: PRIORITY.PATIENT_CARE,
      type: 'open_referral',
      title: `Referral ${referral.referralId} — no response from ${referral.specialistName}`,
      description: overdue
        ? `Response overdue by ${Math.abs(daysUntilDeadline)} days. Patient ${referral.patientScheduled ? 'has scheduled' : 'has NOT scheduled'} appointment.`
        : `Response expected in ${daysUntilDeadline} days. Patient ${referral.patientScheduled ? 'has scheduled' : 'has NOT scheduled'} appointment.`,
      aiInstruction: `Contact ${referral.specialistName} to confirm receipt and get status on referral for ${referral.specialty}.`,
      revenueAtRisk: null,
      urgency: overdue ? 'high' : 'medium'
    })
  }

  // Outstanding patient balances > 30 days
  for (const balance of outstandingBalances) {
    if (balance.daysPastDue >= 30) {
      items.push({
        source: 'practice_ops',
        priority: PRIORITY.PATIENT_BALANCE,
        type: 'outstanding_balance',
        title: `Patient balance $${balance.balanceDue.toFixed(2)} overdue ${balance.daysPastDue} days`,
        description: `Patient token ${balance.patientToken} owes $${balance.balanceDue.toFixed(2)}, ${balance.daysPastDue} days past due.`,
        aiInstruction: 'Send patient statement and follow up via phone. Consider payment plan if balance exceeds $200.',
        revenueAtRisk: balance.balanceDue,
        urgency: balance.daysPastDue > 60 ? 'high' : 'medium'
      })
    }
  }

  // Warning-level credentials as compliance/info items
  for (const alert of credentialingResult.alerts) {
    if (alert.level === 'warning' || alert.level === 'info') {
      items.push({
        source: 'credentialing_agent',
        priority: alert.level === 'warning' ? PRIORITY.COMPLIANCE : PRIORITY.INFO,
        type: 'credential_expiry',
        title: `${alert.level.toUpperCase()}: ${alert.label} — ${alert.daysRemaining} days`,
        description: `Expires ${alert.expiryDate}`,
        aiInstruction: alert.aiInstruction,
        revenueAtRisk: null,
        urgency: alert.level
      })
    }
  }

  // Payer denial rate patterns as compliance alerts
  for (const pattern of eraPatterns) {
    items.push({
      source: 'era_agent',
      priority: PRIORITY.COMPLIANCE,
      type: 'denial_pattern',
      title: `Payer alert: ${pattern.message}`,
      description: `${pattern.payer} denial rate at ${pattern.denialRate}% — review billing patterns for ${pattern.topCode}.`,
      aiInstruction: `Audit all ${pattern.topCode} claims submitted to ${pattern.payer} in the last 90 days. Identify the root cause and correct the underlying billing error.`,
      revenueAtRisk: null,
      urgency: 'medium'
    })
  }

  return prioritizeActionItems(items)
}

async function generateDailySummary({ actionItems, credentialingResult, eraTotal, eraClaims, pendingAuthCount, openReferralCount }) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const criticalCredentials = credentialingResult.alerts.filter(a => a.level === 'critical' || a.level === 'expired').length
  const totalRevenueAtRisk = actionItems
    .filter(i => i.revenueAtRisk)
    .reduce((sum, i) => sum + i.revenueAtRisk, 0)

  // No PHI — aggregate metrics only
  const prompt = `
You are a healthcare practice management AI generating a morning briefing for a physician.

Today's metrics:
- Total action items requiring attention: ${actionItems.length}
- Revenue at risk from denied claims: $${totalRevenueAtRisk.toFixed(2)}
- ERA payments processed: $${eraTotal.toFixed(2)} across ${eraClaims} claims
- Critical credentialing issues: ${criticalCredentials}
- Prior authorizations pending payer response: ${pendingAuthCount}
- Referrals awaiting specialist response: ${openReferralCount}

Write a 3-sentence morning briefing for the provider dashboard.
Lead with the most urgent financial issue. Then patient care. Then compliance.
Be direct. Use dollar amounts. No fluff. No patient names or identifiers.
`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 180
  })

  return response.choices[0].message.content.trim()
}

async function runPracticeOpsAgent({ providerId = 'PROV-001', providerPhone = null, eraResults = null } = {}) {
  console.log(`\n[PRACTICE OPS AGENT] Starting morning briefing for provider ${providerId}`)

  // Resolve to numeric providerId — 'PROV-001' strings and null both map to 1
  const numericProviderId = typeof providerId === 'number'
    ? providerId
    : (Number.isInteger(Number(providerId)) && providerId !== null && !String(providerId).startsWith('PROV')
        ? Number(providerId)
        : 1)

  // Gather live data from each sub-agent / state store
  console.log(`[PRACTICE OPS AGENT] Running credentialing check`)
  let credentialingResult
  try {
    credentialingResult = await runCredentialingAgent(numericProviderId)
  } catch (err) {
    console.error(`[PRACTICE OPS AGENT] Credentialing check failed:`, err.message)
    credentialingResult = { alerts: [], pendingEnrollments: [], criticalCount: 0, warningCount: 0, infoCount: 0 }
  }

  // ERA data comes from the ERA agent run (injected or mock)
  const eraActionItems = eraResults?.actionItems || getMockERAActionItems()
  const eraPatterns = eraResults?.patterns || getMockERAPatterns()
  const eraTotal = eraResults?.totalPaid || 182.00
  const eraClaims = eraResults?.claimsProcessed || 3

  console.log(`[PRACTICE OPS AGENT] ERA: $${eraTotal.toFixed(2)} paid, ${eraActionItems.length} action items, ${eraPatterns.length} pattern(s)`)

  // Prior auths — async DB-backed when numericProviderId available
  const pendingAuths = await getPendingAuths(numericProviderId)
  console.log(`[PRACTICE OPS AGENT] Prior auths pending: ${pendingAuths.length}`)

  // Open referrals — async DB-backed when numericProviderId available
  const openReferrals = await getOpenReferrals(numericProviderId)
  console.log(`[PRACTICE OPS AGENT] Open referrals: ${openReferrals.length}`)

  // Outstanding patient balances from DB
  const outstandingBalances = await getOutstandingBalances(numericProviderId)
  console.log(`[PRACTICE OPS AGENT] Outstanding balances: ${outstandingBalances.length}`)

  // Aggregate and prioritize all action items
  console.log(`[PRACTICE OPS AGENT] Aggregating action items`)
  const actionItems = await aggregateActionItems({
    credentialingResult,
    eraActionItems,
    eraPatterns,
    pendingAuths,
    openReferrals,
    outstandingBalances
  })

  console.log(`[PRACTICE OPS AGENT] ${actionItems.length} total action items after prioritization`)

  // Generate AI narrative summary
  console.log(`[PRACTICE OPS AGENT] Generating AI daily summary`)
  let dailySummary = ''
  try {
    dailySummary = await generateDailySummary({
      actionItems,
      credentialingResult,
      eraTotal,
      eraClaims,
      pendingAuthCount: pendingAuths.length,
      openReferralCount: openReferrals.length
    })
  } catch (err) {
    console.error(`[PRACTICE OPS AGENT] Summary generation failed:`, err.message)
    dailySummary = `You have ${actionItems.length} action items today. ${credentialingResult.criticalCount} credential(s) need urgent attention.`
  }

  // Persist morning briefing to DB
  const smsBriefing = [
    `Morning briefing — ${actionItems.length} action items:`,
    ...actionItems.slice(0, 3).map((item, i) => `${i + 1}. ${item.title}`)
  ].join('\n')

  try {
    await ensureDailyBriefingsTable()
    await db.query(
      `INSERT INTO daily_briefings
         (provider_id, date, total_action_items, critical_count, high_count,
          revenue_at_risk, summary, sms_briefing)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)`,
      [
        numericProviderId,
        actionItems.length,
        actionItems.filter(i => i.urgency === 'critical').length,
        actionItems.filter(i => i.urgency === 'high').length,
        actionItems.filter(i => i.revenueAtRisk).reduce((sum, i) => sum + i.revenueAtRisk, 0),
        dailySummary,
        smsBriefing
      ]
    )
    console.log(`[PRACTICE OPS AGENT] Daily briefing saved to DB`)
  } catch (err) {
    console.error(`[PRACTICE OPS AGENT] Daily briefing DB save failed:`, err.message)
  }

  // Send SMS briefing with top 3 action items
  if (providerPhone) {
    try {
      await notifyPatient({ to: providerPhone, message: smsBriefing })
      console.log(`[PRACTICE OPS AGENT] Morning briefing SMS sent to provider`)
    } catch (err) {
      console.error(`[PRACTICE OPS AGENT] SMS send failed:`, err.message)
    }
  }

  const result = {
    providerId,
    generatedAt: new Date().toISOString(),
    dailySummary,
    actionItems,
    totalActionItems: actionItems.length,
    criticalCount: actionItems.filter(i => i.urgency === 'critical').length,
    highCount: actionItems.filter(i => i.urgency === 'high').length,
    topActionItems: actionItems.slice(0, 3),
    metrics: {
      eraTotalPaid: eraTotal,
      eraClaimsProcessed: eraClaims,
      eraActionItemCount: eraActionItems.length,
      eraPatternCount: eraPatterns.length,
      credentialCriticalCount: credentialingResult.criticalCount,
      pendingAuthCount: pendingAuths.length,
      openReferralCount: openReferrals.length,
      outstandingBalanceCount: outstandingBalances.length,
      totalRevenueAtRisk: actionItems.filter(i => i.revenueAtRisk).reduce((sum, i) => sum + i.revenueAtRisk, 0)
    }
  }

  console.log(`\n[PRACTICE OPS AGENT] Complete`)
  console.log(`[PRACTICE OPS AGENT] Total action items: ${result.totalActionItems} (${result.criticalCount} critical, ${result.highCount} high)`)
  console.log(`[PRACTICE OPS AGENT] Revenue at risk: $${result.metrics.totalRevenueAtRisk.toFixed(2)}`)
  console.log(`[PRACTICE OPS AGENT] Summary: ${dailySummary}`)

  return result
}

module.exports = { runPracticeOpsAgent, prioritizeActionItems, aggregateActionItems, PRIORITY }
