require('dotenv').config()
const { parseERA, detectPatterns } = require('../lib/eraParser')
const { getDenialInfo } = require('../lib/denialCodes')
const OpenAI = require('openai')
const db = require('../db')

// Denied claim action items are revenue-at-risk → priority 2
const DENIAL_PRIORITY = 2

// TRN03 in 835 EDI is the payer routing/ID number, not the check date.
// Normalize whatever arrives: accept YYYY-MM-DD, convert YYYYMMDD, fall back to today.
function normalizeCheckDate(raw) {
  if (!raw) return new Date().toISOString().split('T')[0]
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return new Date().toISOString().split('T')[0]
}

async function runERAAgent(era835Files, providerId = 1) {
  console.log(`\n[ERA AGENT] Starting — processing ${era835Files.length} ERA file(s)`)

  const parsedERAs = []
  const allActionItems = []

  for (const era835 of era835Files) {
    console.log(`\n[ERA AGENT] Parsing ERA from ${era835.payerName} — check #${era835.checkNumber}`)

    const parsed = parseERA(era835)
    parsedERAs.push(parsed)

    console.log(`[ERA AGENT] ${parsed.claims.length} claims parsed — total paid: $${parsed.totalPaid.toFixed(2)}`)

    // Persist ERA file record
    let eraFileId = null
    try {
      const saved = await db.saveERAFile({
        providerId,
        payerName: parsed.payerName,
        payerId: era835.payerId || null,
        checkNumber: parsed.checkNumber,
        checkDate: normalizeCheckDate(parsed.checkDate),
        totalPaid: parsed.totalPaid,
        claimsCount: parsed.claims.length,
        parseWarning: era835.parseWarning || null,
        rawEdi: era835.rawEdi || null
      })
      eraFileId = saved.id
      console.log(`[ERA AGENT] ERA file saved to DB — id ${eraFileId}`)
    } catch (err) {
      console.error(`[ERA AGENT] ERA file DB save failed:`, err.message)
    }

    for (const claim of parsed.claims) {
      // Try to match an existing claim in DB by claim_number so we can update it
      let dbClaimId = null
      let dbLineId = null
      try {
        const claimRow = await db.query(
          'SELECT id FROM claims WHERE claim_number = $1',
          [claim.claimId]
        )
        if (claimRow.rows.length > 0) {
          dbClaimId = claimRow.rows[0].id

          await db.query(
            `UPDATE claims
             SET status = $1, paid_amount = $2, patient_responsibility = $3,
                 contractual_adjustment = $4,
                 paid_at = CASE WHEN $1 = 'paid' THEN NOW() ELSE paid_at END,
                 updated_at = NOW()
             WHERE id = $5`,
            [claim.status, claim.amountPaid, claim.patientResponsibility,
             claim.contractualAdjustment, dbClaimId]
          )
          console.log(`[ERA AGENT] Claim ${claim.claimId} matched in DB (id ${dbClaimId}) — updated to ${claim.status}`)

          const lineRow = await db.query(
            'SELECT id FROM claim_lines WHERE claim_id = $1 LIMIT 1',
            [dbClaimId]
          )
          if (lineRow.rows.length > 0) dbLineId = lineRow.rows[0].id
        } else {
          console.log(`[ERA AGENT] Claim ${claim.claimId} — no DB match, skipping DB update`)
        }
      } catch (err) {
        console.error(`[ERA AGENT] Claim DB update failed for ${claim.claimId}:`, err.message)
      }

      // Write adjustments to DB if we have the claim line
      if (dbLineId) {
        for (const line of claim.servicelines || []) {
          for (const adj of line.adjustments || []) {
            try {
              await db.query(
                `INSERT INTO adjustments
                   (claim_line_id, code, amount, group_code, plain_english, fix_instruction, appealable)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [dbLineId, adj.code, adj.amount,
                 adj.code.split('-')[0],
                 adj.plain, adj.fix, adj.appealable]
              )
            } catch (err) {
              if (!err.message.includes('duplicate')) {
                console.error(`[ERA AGENT] Adjustment insert failed:`, err.message)
              }
            }
          }
        }
      }

      if (claim.needsAttention) {
        console.log(`[ERA AGENT] Claim ${claim.claimId} needs attention — ${claim.actionItems.length} issue(s)`)

        for (const item of claim.actionItems) {
          const enriched = await enrichActionItem({ item, claim, payerName: era835.payerName })
          allActionItems.push(enriched)

          // Write action item to DB (skip if one already exists for this claim+code)
          try {
            const sourceId = `${claim.claimId}|${item.code}`
            const existing = await db.query(
              `SELECT id FROM action_items
               WHERE provider_id = $1 AND source_agent = 'era_agent'
                 AND source_id = $2 AND resolved = false`,
              [providerId, sourceId]
            )
            if (existing.rows.length === 0) {
              await db.saveActionItem({
                providerId,
                type: 'denied_claim',
                priority: DENIAL_PRIORITY,
                title: `Denied: ${claim.claimId} — ${era835.payerName} (${item.code})`,
                description: item.plain,
                aiInstruction: enriched.aiInstruction,
                sourceAgent: 'era_agent',
                sourceId
              })
            }
          } catch (err) {
            console.error(`[ERA AGENT] Action item save failed:`, err.message)
          }
        }
      } else {
        console.log(`[ERA AGENT] Claim ${claim.claimId} — clean, auto-posting $${claim.amountPaid.toFixed(2)}`)
      }
    }
  }

  const patterns = detectPatterns(parsedERAs)

  if (patterns.length > 0) {
    console.log(`\n[ERA AGENT] ${patterns.length} pattern(s) detected`)
    for (const pattern of patterns) {
      console.log(`[ERA AGENT] Pattern: ${pattern.message}`)
    }
  }

  const summary = await generateERASummary({ parsedERAs, allActionItems, patterns })

  const result = {
    erasProcessed: parsedERAs.length,
    totalPaid: parsedERAs.reduce((sum, e) => sum + e.totalPaid, 0),
    claimsProcessed: parsedERAs.reduce((sum, e) => sum + e.claims.length, 0),
    actionItems: allActionItems,
    patterns,
    summary,
    processedAt: new Date().toISOString()
  }

  console.log(`\n[ERA AGENT] Complete`)
  console.log(`[ERA AGENT] Total paid: $${result.totalPaid.toFixed(2)}`)
  console.log(`[ERA AGENT] Action items: ${result.actionItems.length}`)
  console.log(`[ERA AGENT] Patterns detected: ${result.patterns.length}`)

  return result
}

async function enrichActionItem({ item, claim, payerName }) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const prompt = `
You are a healthcare billing expert helping an independent provider resolve a claim denial.

Payer: ${payerName}
Procedure code: ${item.procedureCode}
Denial code: ${item.code}
Denial reason: ${item.plain}
Amount at stake: $${item.amount}
Priority: ${item.priority}

Write a specific, actionable 2-sentence instruction for the provider to resolve this denial.
Be direct. No filler. Reference the specific code and amount.
Do not include any patient information.
`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 150
  })

  return {
    ...item,
    payerName,
    claimId: claim.claimId,
    patientToken: claim.patientToken,
    dateOfService: claim.dateOfService,
    aiInstruction: response.choices[0].message.content.trim()
  }
}

async function generateERASummary({ parsedERAs, allActionItems, patterns }) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const totalPaid = parsedERAs.reduce((sum, e) => sum + e.totalPaid, 0)
  const totalClaims = parsedERAs.reduce((sum, e) => sum + e.claims.length, 0)
  const deniedCount = allActionItems.length
  const totalAtRisk = allActionItems.reduce((sum, i) => sum + i.amount, 0)

  const codeCounts = {}
  for (const item of allActionItems) {
    codeCounts[item.code] = (codeCounts[item.code] || 0) + 1
  }
  const codeBreakdown = Object.entries(codeCounts)
    .map(([code, count]) => `${code} (${count} claim${count > 1 ? 's' : ''})`)
    .join(', ')

  const prompt = `
You are a healthcare billing assistant generating a daily ERA summary for a provider dashboard.

ERA processing results:
- ERAs processed: ${parsedERAs.length}
- Total claims: ${totalClaims}
- Total paid: $${totalPaid.toFixed(2)}
- Claims needing action: ${deniedCount}
- Revenue at risk: $${totalAtRisk.toFixed(2)}
- Denial codes: ${codeBreakdown || 'none'}
- Patterns detected: ${patterns.length}
${patterns.map(p => `- ${p.message}`).join('\n')}

Write a 2-3 sentence plain English summary for the provider.
Lead with the money collected. Name each denial code explicitly by code number (e.g., "CO-97 bundling denials", "CO-4 modifier errors") — do not use generic phrases like "a specific reason" or "certain issues". Note any payer patterns.
No patient information. Just clear business language.
`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 150
  })

  return response.choices[0].message.content.trim()
}

module.exports = { runERAAgent }
