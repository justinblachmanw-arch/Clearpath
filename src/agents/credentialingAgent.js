require('dotenv').config()
const OpenAI = require('openai')
const db = require('../db')

// Provider configuration — swap state/URL here when onboarding a provider in a different state
const providerConfig = {
  state: 'New Jersey',
  stateAbbrev: 'NJ',
  stateLicenseUrl: 'https://newjersey.mylicense.com/eGov/Login.aspx'
}

// Human-readable labels for credential types stored in DB
function getCredentialLabel(credType, issuingBody, state) {
  const map = {
    caqh:          'CAQH ProView Attestation',
    dea:           'DEA Registration',
    state_license: `${state || providerConfig.state} Medical License`,
    malpractice:   'Malpractice Insurance',
    board_cert:    'Board Certification',
    npi:           'NPI Registration'
  }
  return map[credType] || credType
}

// Fetch and normalize credentials + payer enrollments from DB
async function getProviderDataFromDB(providerId) {
  const providerRow = await db.query('SELECT * FROM providers WHERE id = $1', [providerId])
  if (!providerRow.rows.length) throw new Error(`Provider ${providerId} not found`)
  const provider = providerRow.rows[0]

  const credRows = await db.getCredentials(providerId)
  const credentials = credRows.map(c => ({
    type:       c.credential_type,
    label:      getCredentialLabel(c.credential_type, c.issuing_body, c.state),
    identifier: c.identifier,
    expiryDate: c.expiry_date
      ? (c.expiry_date instanceof Date
          ? c.expiry_date.toISOString().split('T')[0]
          : String(c.expiry_date).split('T')[0])
      : null,
    status:     c.status,
    renewalUrl: c.renewal_url || null
  }))

  const enrollRows = await db.query(
    'SELECT * FROM payer_enrollments WHERE provider_id = $1 ORDER BY payer_name',
    [providerId]
  )
  const payerEnrollments = enrollRows.rows.map(e => ({
    payerCode:     e.payer_code,
    payerName:     e.payer_name,
    status:        e.status,
    effectiveDate: e.effective_date
      ? (e.effective_date instanceof Date
          ? e.effective_date.toISOString().split('T')[0]
          : String(e.effective_date).split('T')[0])
      : null,
    expiryDate:    e.expiry_date || null
  }))

  return {
    providerId,
    providerName: provider.name,
    npi:          provider.npi,
    credentials,
    payerEnrollments
  }
}

// Mock credentials for backward compatibility and testing
function getMockProviderCredentials() {
  return {
    providerId: 'PROV-001',
    providerName: 'Dr. Anjali Patel',
    npi: '1234567890',
    credentials: [
      {
        type: 'caqh',
        label: 'CAQH ProView Attestation',
        identifier: '12345678',
        expiryDate: '2026-05-15',
        status: 'active',
        renewalUrl: 'https://proview.caqh.org'
      },
      {
        type: 'dea',
        label: 'DEA Registration',
        identifier: 'BP1234567',
        expiryDate: '2026-06-01',
        status: 'active',
        renewalUrl: 'https://www.deadiversion.usdoj.gov/drugreg/reg_apps/online_forms.htm'
      },
      {
        type: 'state_license',
        label: `${providerConfig.state} Medical License`,
        identifier: 'MA98765',
        expiryDate: '2026-07-01',
        status: 'active',
        renewalUrl: providerConfig.stateLicenseUrl
      },
      {
        type: 'malpractice',
        label: 'Malpractice Insurance',
        identifier: 'POL-2024-44321',
        expiryDate: '2026-08-01',
        status: 'active',
        renewalUrl: null
      },
      {
        type: 'board_cert',
        label: 'Board Certification — Internal Medicine',
        identifier: 'ABIM-2020-78901',
        expiryDate: '2026-08-10',
        status: 'active',
        renewalUrl: 'https://www.abim.org/maintain-certification/'
      },
      {
        type: 'npi',
        label: 'NPI Registration',
        identifier: '1234567890',
        expiryDate: null,
        status: 'active',
        renewalUrl: null
      }
    ],
    payerEnrollments: [
      { payerCode: 'MEDICARE', payerName: 'Medicare',              status: 'active',  effectiveDate: '2022-01-15', expiryDate: null },
      { payerCode: 'AETNA',    payerName: 'Aetna',                 status: 'active',  effectiveDate: '2023-06-01', expiryDate: null },
      { payerCode: 'UHC',      payerName: 'United Healthcare',     status: 'pending', effectiveDate: null,         expiryDate: null },
      { payerCode: 'BCBS',     payerName: 'Blue Cross Blue Shield', status: 'active', effectiveDate: '2021-03-01', expiryDate: null }
    ]
  }
}

function getDaysUntilExpiry(expiryDate) {
  if (!expiryDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(expiryDate)
  expiry.setHours(0, 0, 0, 0)
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24))
}

function getAlertLevel(daysRemaining) {
  if (daysRemaining === null) return null
  if (daysRemaining < 0)   return 'expired'
  if (daysRemaining <= 30) return 'critical'
  if (daysRemaining <= 60) return 'warning'
  if (daysRemaining <= 90) return 'info'
  return 'ok'
}

// Priority mapping for action_items table
function alertPriority(level) {
  if (level === 'critical' || level === 'expired') return 1  // CREDENTIAL_CRITICAL
  if (level === 'warning') return 5                          // COMPLIANCE
  return 6                                                   // INFO
}

async function runCredentialingAgent(providerOrId = null) {
  console.log('\n[CREDENTIALING AGENT] Starting daily credential check')

  // Accept numeric DB id or fall back to mock data
  let providerData
  const numericId = typeof providerOrId === 'number'
    ? providerOrId
    : (Number.isInteger(Number(providerOrId)) && providerOrId !== null && !String(providerOrId).startsWith('PROV')
        ? Number(providerOrId)
        : null)

  if (numericId !== null) {
    try {
      providerData = await getProviderDataFromDB(numericId)
      console.log(`[CREDENTIALING AGENT] Loaded from DB — ${providerData.providerName}`)
    } catch (err) {
      console.error(`[CREDENTIALING AGENT] DB load failed, using mock:`, err.message)
      providerData = getMockProviderCredentials()
    }
  } else {
    providerData = providerOrId || getMockProviderCredentials()
  }

  console.log(`[CREDENTIALING AGENT] Checking credentials for provider ${providerData.providerId} — ${providerData.providerName}`)

  const alerts = []
  const pendingEnrollments = []

  for (const cred of providerData.credentials) {
    if (!cred.expiryDate) {
      console.log(`[CREDENTIALING AGENT] ${cred.label} — no expiry, skipping`)
      continue
    }

    const daysRemaining = getDaysUntilExpiry(cred.expiryDate)
    const level = getAlertLevel(daysRemaining)

    const label = daysRemaining < 0
      ? `EXPIRED ${Math.abs(daysRemaining)} days ago`
      : `${daysRemaining} days remaining`
    console.log(`[CREDENTIALING AGENT] ${cred.label} — ${label} — ${level.toUpperCase()}`)

    if (level === 'ok') continue

    let aiInstruction = null
    try {
      aiInstruction = await generateRenewalInstruction({
        credentialType: cred.type,
        label: cred.label,
        identifier: cred.identifier,
        daysRemaining,
        expiryDate: cred.expiryDate,
        renewalUrl: cred.renewalUrl
      })
    } catch (err) {
      console.error(`[CREDENTIALING AGENT] AI instruction failed for ${cred.label}:`, err.message)
      aiInstruction = cred.renewalUrl
        ? `Renew ${cred.label} at ${cred.renewalUrl} before ${cred.expiryDate}.`
        : `Contact the issuing authority to renew ${cred.label} before ${cred.expiryDate}.`
    }

    const alert = {
      type: 'credential_expiry',
      credentialType: cred.type,
      label: cred.label,
      identifier: cred.identifier,
      expiryDate: cred.expiryDate,
      daysRemaining,
      level,
      renewalUrl: cred.renewalUrl || null,
      aiInstruction
    }
    alerts.push(alert)

    // Write alert to action_items — skip if an open item already exists for this credential
    if (numericId !== null) {
      try {
        const sourceId = `cred-${cred.type}`
        const existing = await db.query(
          `SELECT id FROM action_items
           WHERE provider_id = $1 AND source_agent = 'credentialing_agent'
             AND source_id = $2 AND resolved = false`,
          [numericId, sourceId]
        )
        if (existing.rows.length === 0) {
          const title = level === 'expired'
            ? `EXPIRED: ${cred.label} — ${Math.abs(daysRemaining)} days overdue`
            : `${level.toUpperCase()}: ${cred.label} expires in ${daysRemaining} days`
          await db.saveActionItem({
            providerId: numericId,
            type: 'credential_expiry',
            priority: alertPriority(level),
            title,
            description: `${cred.identifier} — expires ${cred.expiryDate}`,
            aiInstruction,
            sourceAgent: 'credentialing_agent',
            sourceId
          })
          console.log(`[CREDENTIALING AGENT] Alert saved to DB for ${cred.label}`)
        }
      } catch (err) {
        console.error(`[CREDENTIALING AGENT] Action item save failed:`, err.message)
      }
    }
  }

  for (const enrollment of providerData.payerEnrollments) {
    if (enrollment.status === 'pending') {
      console.log(`[CREDENTIALING AGENT] Payer enrollment PENDING — ${enrollment.payerName}`)
      pendingEnrollments.push(enrollment)
    }
  }

  const criticalCount = alerts.filter(a => a.level === 'critical' || a.level === 'expired').length
  const warningCount  = alerts.filter(a => a.level === 'warning').length
  const infoCount     = alerts.filter(a => a.level === 'info').length

  const result = {
    providerId: providerData.providerId,
    checkedAt: new Date().toISOString(),
    totalCredentialsChecked: providerData.credentials.filter(c => c.expiryDate).length,
    alerts,
    pendingEnrollments,
    criticalCount,
    warningCount,
    infoCount
  }

  console.log(`\n[CREDENTIALING AGENT] Complete`)
  console.log(`[CREDENTIALING AGENT] Alerts: ${alerts.length} total — ${criticalCount} critical, ${warningCount} warning, ${infoCount} info`)
  console.log(`[CREDENTIALING AGENT] Pending payer enrollments: ${pendingEnrollments.length}`)

  return result
}

async function generateRenewalInstruction({ credentialType, label, identifier, daysRemaining, expiryDate, renewalUrl }) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const urgency = daysRemaining < 0  ? 'EXPIRED'
    : daysRemaining <= 30 ? 'CRITICAL'
    : daysRemaining <= 60 ? 'WARNING'
    : 'INFO'

  // No PHI — provider credential data only
  const prompt = `
You are a healthcare practice administrator helping a physician renew their credentials.

Credential: ${label}
Identifier: ${identifier}
Expiry date: ${expiryDate}
Days remaining: ${daysRemaining < 0 ? `EXPIRED ${Math.abs(daysRemaining)} days ago` : daysRemaining}
Urgency: ${urgency}
${renewalUrl ? `Renewal URL: ${renewalUrl}` : ''}

Write 2 concise sentences with the exact steps to renew this credential.
Be specific to this credential type. State the consequence of lapse (e.g., DEA lapse = cannot prescribe controlled substances; license lapse = cannot practice).
No filler language. No patient information.
`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 120
  })

  return response.choices[0].message.content.trim()
}

module.exports = { runCredentialingAgent, getMockProviderCredentials, getDaysUntilExpiry, getAlertLevel }
