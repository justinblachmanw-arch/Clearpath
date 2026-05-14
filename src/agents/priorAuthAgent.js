require('dotenv').config()
const OpenAI = require('openai')
const db = require('../db')

// Rules table: payer + procedure code → auth required
// In production this would be a DB table updated via payer policy feeds
const AUTH_RULES = {
  AETNA: {
    '27447': true,   // total knee arthroplasty
    '27130': true,   // total hip arthroplasty
    '72148': true,   // MRI lumbar spine
    '70553': true,   // MRI brain with contrast
    '43239': true,   // upper GI endoscopy w/ biopsy
    '99214': false,
    '99213': false,
    '99203': false
  },
  MEDICARE: {
    '72148': true,
    '70553': true,
    '27447': false,  // Medicare typically doesn't require PA for joint replacement
    '99214': false
  },
  UHC: {
    '27447': true,
    '27130': true,
    '72148': true,
    '70553': true,
    '43239': true,
    '99214': false
  },
  BCBS: {
    '27447': true,
    '72148': true,
    '70553': true,
    '99214': false
  },
  DEFAULT: {}
}

// In-memory auth tracker — fallback when DB is unavailable or providerId is not numeric
const authTracker = new Map()

async function ensurePriorAuthsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS prior_auths (
      id                     SERIAL PRIMARY KEY,
      provider_id            INTEGER       NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      patient_id             INTEGER       REFERENCES patients(id),
      claim_id               INTEGER       REFERENCES claims(id),
      auth_id                VARCHAR(100),
      payer_code             VARCHAR(50),
      procedure_code         VARCHAR(20),
      procedure_description  TEXT,
      diagnosis_codes        TEXT[],
      status                 VARCHAR(50)   NOT NULL DEFAULT 'pending',
      narrative              TEXT,
      submitted_at           TIMESTAMP,
      expected_response_date TIMESTAMP,
      follow_up_date         TIMESTAMP,
      created_at             TIMESTAMP     NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMP     NOT NULL DEFAULT NOW()
    )
  `)
}

function requiresAuth(payerCode, procedureCode) {
  const payerRules = AUTH_RULES[payerCode] || AUTH_RULES.DEFAULT
  // If no explicit rule, default to false (no auth needed)
  return payerRules[procedureCode] === true
}

function getMockEncounter(scenario = 'auth_required') {
  const base = {
    encounterId: 'ENC-001',
    providerId: 'PROV-001',
    patientToken: 'PT-A1B2C3D4',
    payerCode: 'AETNA',
    dateOfService: '2026-05-20',
    diagnosisCodes: ['M17.11', 'M25.561'],  // primary osteoarthritis right knee, pain right knee
    procedures: [
      { code: '27447', description: 'Total knee arthroplasty, right' }
    ],
    clinicalJustification: 'Patient presents with severe right knee pain limiting ambulation. Conservative treatment including physical therapy, NSAIDs, and cortisone injections over 12 months have failed to provide relief. X-ray demonstrates bone-on-bone arthritis. Surgery is medically necessary.'
  }

  const scenarios = {
    auth_required: base,

    no_auth_needed: {
      ...base,
      encounterId: 'ENC-002',
      procedures: [{ code: '99214', description: 'Office visit, moderate complexity' }],
      diagnosisCodes: ['I10'],
      clinicalJustification: 'Routine hypertension follow-up.'
    },

    mri_auth: {
      ...base,
      encounterId: 'ENC-003',
      procedures: [{ code: '72148', description: 'MRI lumbar spine without contrast' }],
      diagnosisCodes: ['M54.5'],
      clinicalJustification: 'Persistent low back pain radiating to left leg for 8 weeks despite conservative management. Need to rule out disc herniation or stenosis.'
    }
  }

  return scenarios[scenario] || base
}

async function submitAuthRequest(encounter, procedure) {
  if (process.env.PRIOR_AUTH_SANDBOX === 'true' || !process.env.PAYER_AUTH_API_URL) {
    // Mock submission — in production calls payer-specific API or clearinghouse
    const mockAuthId = `AUTH-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    console.log(`[PRIOR AUTH AGENT] [MOCK] Auth request submitted — assigned ID: ${mockAuthId}`)
    return {
      authId: mockAuthId,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      expectedResponseDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    }
  }

  // Production: POST to payer API
  const axios = require('axios')
  try {
    const response = await axios.post(process.env.PAYER_AUTH_API_URL, {
      payerCode: encounter.payerCode,
      providerNPI: process.env.PROVIDER_NPI,
      patientToken: encounter.patientToken,
      procedureCode: procedure.code,
      diagnosisCodes: encounter.diagnosisCodes,
      clinicalJustification: encounter.clinicalJustification,
      dateOfService: encounter.dateOfService
    })
    return response.data
  } catch (err) {
    throw new Error(`Payer auth API failed: ${err.message}`)
  }
}

async function generateAuthNarrative(encounter, procedure) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  // No PHI — uses patient token, diagnosis/procedure codes, and provider-supplied justification text only
  const prompt = `
You are a prior authorization specialist writing a clinical justification letter for payer review.

Procedure: ${procedure.code} — ${procedure.description}
Diagnosis codes: ${encounter.diagnosisCodes.join(', ')}
Clinical justification provided by physician: ${encounter.clinicalJustification}
Payer: ${encounter.payerCode}

Write a 3-sentence prior authorization clinical summary. Lead with the diagnosis and failed conservative treatments. State medical necessity. End with the expected outcome if approved.
No patient names. No dates of birth. Use only what is provided above.
`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 200
  })

  return response.choices[0].message.content.trim()
}

async function runPriorAuthAgent(encounter, providerId = null) {
  console.log(`\n[PRIOR AUTH AGENT] Starting for encounter ${encounter.encounterId}`)

  const numericProviderId = typeof providerId === 'number' ? providerId : null
  if (numericProviderId) {
    try { await ensurePriorAuthsTable() } catch (err) {
      console.error('[PRIOR AUTH AGENT] Table ensure failed:', err.message)
    }
  }

  const results = []

  for (const procedure of encounter.procedures) {
    const needsAuth = requiresAuth(encounter.payerCode, procedure.code)
    console.log(`[PRIOR AUTH AGENT] ${procedure.code} (${procedure.description}) — auth required: ${needsAuth}`)

    if (!needsAuth) {
      results.push({
        procedureCode: procedure.code,
        procedureDescription: procedure.description,
        authRequired: false,
        status: 'not_required',
        authId: null,
        narrative: null
      })
      continue
    }

    // Generate clinical narrative for the auth request
    let narrative = null
    try {
      narrative = await generateAuthNarrative(encounter, procedure)
      console.log(`[PRIOR AUTH AGENT] Clinical narrative generated for ${procedure.code}`)
    } catch (err) {
      console.error(`[PRIOR AUTH AGENT] Narrative generation failed:`, err.message)
      narrative = encounter.clinicalJustification
    }

    // Submit auth request
    let submission = null
    try {
      submission = await submitAuthRequest(encounter, procedure)
      console.log(`[PRIOR AUTH AGENT] Auth request submitted — ID: ${submission.authId} — status: ${submission.status}`)
    } catch (err) {
      console.error(`[PRIOR AUTH AGENT] Auth submission failed:`, err.message)
      submission = {
        authId: null,
        status: 'submission_failed',
        error: err.message,
        submittedAt: new Date().toISOString(),
        expectedResponseDate: null
      }
    }

    const authRecord = {
      encounterId: encounter.encounterId,
      patientToken: encounter.patientToken,
      payerCode: encounter.payerCode,
      procedureCode: procedure.code,
      procedureDescription: procedure.description,
      authRequired: true,
      authId: submission.authId,
      status: submission.status,
      submittedAt: submission.submittedAt,
      expectedResponseDate: submission.expectedResponseDate,
      followUpDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      narrative,
      diagnosisCodes: encounter.diagnosisCodes
    }

    // Track in memory
    if (authRecord.authId) {
      authTracker.set(authRecord.authId, authRecord)
    }

    // Persist to DB when we have a numeric providerId
    if (numericProviderId) {
      try {
        await db.query(
          `INSERT INTO prior_auths
             (provider_id, patient_id, claim_id, auth_id, payer_code,
              procedure_code, procedure_description, diagnosis_codes,
              status, narrative, submitted_at, expected_response_date, follow_up_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            numericProviderId,
            encounter.patientId || null,
            encounter.claimId   || null,
            authRecord.authId,
            authRecord.payerCode,
            authRecord.procedureCode,
            authRecord.procedureDescription,
            encounter.diagnosisCodes || [],
            authRecord.status,
            authRecord.narrative,
            authRecord.submittedAt         || null,
            authRecord.expectedResponseDate || null,
            authRecord.followUpDate        || null
          ]
        )
        console.log(`[PRIOR AUTH AGENT] Auth record saved to DB — ${authRecord.authId}`)
      } catch (err) {
        console.error(`[PRIOR AUTH AGENT] DB save failed:`, err.message)
      }
    }

    results.push(authRecord)
  }

  const pendingCount = results.filter(r => r.status === 'pending').length
  const notRequiredCount = results.filter(r => r.status === 'not_required').length

  console.log(`[PRIOR AUTH AGENT] Complete — ${pendingCount} pending, ${notRequiredCount} not required`)

  return {
    encounterId: encounter.encounterId,
    patientToken: encounter.patientToken,
    processedAt: new Date().toISOString(),
    results,
    pendingCount,
    notRequiredCount,
    allClear: pendingCount === 0
  }
}

function getAuthStatus(authId) {
  return authTracker.get(authId) || null
}

async function updateAuthStatus(authId, status) {
  const record = authTracker.get(authId)
  if (record) {
    record.status = status
    record.updatedAt = new Date().toISOString()
    authTracker.set(authId, record)
  }
  try {
    await db.query(
      `UPDATE prior_auths SET status = $1, updated_at = NOW() WHERE auth_id = $2`,
      [status, authId]
    )
  } catch (err) {
    console.error(`[PRIOR AUTH AGENT] DB status update failed:`, err.message)
  }
  console.log(`[PRIOR AUTH AGENT] Auth ${authId} status updated to: ${status}`)
  return record || null
}

async function getPendingAuths(providerId = null) {
  if (typeof providerId === 'number') {
    try {
      await ensurePriorAuthsTable()
      const rows = await db.query(
        `SELECT * FROM prior_auths WHERE provider_id = $1 AND status = 'pending' ORDER BY created_at`,
        [providerId]
      )
      return rows.rows.map(r => ({
        authId:               r.auth_id,
        payerCode:            r.payer_code,
        procedureCode:        r.procedure_code,
        procedureDescription: r.procedure_description,
        followUpDate:         r.follow_up_date ? r.follow_up_date.toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status:               r.status,
        submittedAt:          r.submitted_at   ? r.submitted_at.toISOString()   : null,
        expectedResponseDate: r.expected_response_date ? r.expected_response_date.toISOString() : null
      }))
    } catch (err) {
      console.error('[PRIOR AUTH AGENT] getPendingAuths DB query failed:', err.message)
    }
  }
  return Array.from(authTracker.values()).filter(r => r.status === 'pending')
}

module.exports = {
  runPriorAuthAgent,
  getMockEncounter,
  requiresAuth,
  getAuthStatus,
  updateAuthStatus,
  getPendingAuths
}
