require('dotenv').config()
const OpenAI = require('openai')
const db = require('../db')
const { getCodingContext } = require('../lib/codingIntelligence')

// Timely filing windows in days per payer — default 90 if unknown
const TIMELY_FILING_WINDOWS = {
  MEDICARE: 365,
  MEDICAID: 365,
  AETNA: 365,
  UHC: 365,
  BCBS: 180,
  CIGNA: 180,
  DEFAULT: 90
}

// E&M complexity mapping: procedure code → expected complexity band
const EM_COMPLEXITY = {
  '99202': 'straightforward', '99212': 'straightforward',
  '99203': 'low',             '99213': 'low',
  '99204': 'moderate',        '99214': 'moderate',
  '99205': 'high',            '99215': 'high'
}

// Known valid modifier + procedure combinations (non-exhaustive — AI validates further)
const INVALID_MODIFIER_COMBOS = [
  { modifier: '57', not_with: ['99202', '99203', '99212', '99213'] }, // decision for major surgery on low-level E&M
]

// In-memory duplicate detection — in production this is a DB unique-index query
const submittedClaimsCache = new Set()

function getMockClaim(scenario = 'clean') {
  const base = {
    claimId: 'CLM-TEST-001',
    providerId: 'PROV-001',
    providerNPI: '1234567890',
    providerTaxId: '123456789',
    patientToken: 'PT-A1B2C3D4',
    payerCode: 'AETNA',
    dateOfService: '2026-05-01',
    placeOfService: '11',
    diagnosisCodes: ['Z00.00', 'I10'],
    serviceLines: [
      { procedureCode: '99214', modifiers: [], billedAmount: 250.00, units: 1 }
    ],
    complexity: 'moderate',
    noteDocumented: true
  }

  const scenarios = {
    clean: base,

    missing_npi: { ...base, claimId: 'CLM-TEST-002', providerNPI: null },

    em_mismatch: {
      ...base,
      claimId: 'CLM-TEST-003',
      serviceLines: [{ procedureCode: '99215', modifiers: [], billedAmount: 300.00, units: 1 }],
      complexity: 'low'
    },

    invalid_modifier: {
      ...base,
      claimId: 'CLM-TEST-004',
      serviceLines: [{ procedureCode: '99213', modifiers: ['57'], billedAmount: 180.00, units: 1 }]
    },

    timely_filing: {
      ...base,
      claimId: 'CLM-TEST-005',
      dateOfService: '2024-01-15',
      payerCode: 'DEFAULT'
    },

    not_credentialed: {
      ...base,
      claimId: 'CLM-TEST-006',
      payerCode: 'UHC'
    }
  }

  return scenarios[scenario] || base
}

function checkRequiredFields(claim) {
  const errors = []
  const required = [
    ['providerNPI', 'Provider NPI is required'],
    ['providerTaxId', 'Provider Tax ID is required'],
    ['dateOfService', 'Date of service is required'],
    ['placeOfService', 'Place of service is required'],
    ['patientToken', 'Patient identifier is required'],
    ['payerCode', 'Payer code is required']
  ]
  for (const [field, message] of required) {
    if (!claim[field]) errors.push({ check: 'required_fields', field, message, fixable: true })
  }
  if (!claim.diagnosisCodes || claim.diagnosisCodes.length === 0) {
    errors.push({ check: 'required_fields', field: 'diagnosisCodes', message: 'At least one diagnosis code is required', fixable: true })
  }
  if (!claim.serviceLines || claim.serviceLines.length === 0) {
    errors.push({ check: 'required_fields', field: 'serviceLines', message: 'At least one service line is required', fixable: true })
  }
  return errors
}

function checkTimelyFiling(claim) {
  const errors = []
  const window = TIMELY_FILING_WINDOWS[claim.payerCode] || TIMELY_FILING_WINDOWS.DEFAULT
  const dos = new Date(claim.dateOfService)
  const today = new Date()
  const daysSinceService = Math.floor((today - dos) / (1000 * 60 * 60 * 24))

  if (daysSinceService > window) {
    errors.push({
      check: 'timely_filing',
      message: `Claim is ${daysSinceService} days past date of service — ${claim.payerCode || 'this payer'} requires submission within ${window} days. Submit proof of timely filing or write off.`,
      fixable: false
    })
  }
  return errors
}

function checkEMLevel(claim) {
  const errors = []
  const emLines = claim.serviceLines.filter(l => EM_COMPLEXITY[l.procedureCode])
  for (const line of emLines) {
    const expectedComplexity = EM_COMPLEXITY[line.procedureCode]
    if (claim.complexity && expectedComplexity !== claim.complexity) {
      errors.push({
        check: 'em_level',
        procedureCode: line.procedureCode,
        message: `E&M code ${line.procedureCode} requires ${expectedComplexity} complexity but note documents ${claim.complexity} complexity. Downcode to match documentation or upgrade documentation before signing.`,
        fixable: true
      })
    }
  }
  return errors
}

function checkModifiers(claim) {
  const errors = []
  for (const line of claim.serviceLines) {
    for (const modifier of line.modifiers || []) {
      const rule = INVALID_MODIFIER_COMBOS.find(r => r.modifier === modifier && r.not_with.includes(line.procedureCode))
      if (rule) {
        errors.push({
          check: 'modifier',
          procedureCode: line.procedureCode,
          modifier,
          message: `Modifier ${modifier} is not valid with ${line.procedureCode}. Remove modifier ${modifier} or use a procedure code appropriate for the documented clinical decision.`,
          fixable: true
        })
      }
    }
  }
  return errors
}

function checkCredentialing(claim, credentialedPayers) {
  const errors = []
  // credentialedPayers defaults to the active enrollments in mock provider data
  const activePayers = credentialedPayers || ['MEDICARE', 'AETNA', 'BCBS']
  if (claim.payerCode && !activePayers.includes(claim.payerCode)) {
    errors.push({
      check: 'credentialing',
      payerCode: claim.payerCode,
      message: `Provider is not credentialed with ${claim.payerCode}. This claim cannot be submitted until credentialing is complete. Check the credentialing tracker for enrollment status.`,
      fixable: false
    })
  }
  return errors
}

function checkDuplicate(claim) {
  const errors = []
  const key = [
    claim.patientToken,
    claim.dateOfService,
    ...(claim.serviceLines || []).map(l => l.procedureCode)
  ].join('|')

  if (submittedClaimsCache.has(key)) {
    errors.push({
      check: 'duplicate',
      message: `Duplicate claim detected — same patient token, date of service, and procedure code(s) already submitted. Review claim ${claim.claimId} before resubmitting.`,
      fixable: false
    })
  } else {
    // Mark as seen only if we're going to submit (caller decides after scrub)
    claim._duplicateKey = key
  }
  return errors
}

function markSubmitted(claim) {
  if (claim._duplicateKey) submittedClaimsCache.add(claim._duplicateKey)
}

async function validateCodeCombinations(claim) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const procedures = claim.serviceLines.map(l =>
    `${l.procedureCode}${l.modifiers.length ? ' -' + l.modifiers.join(' -') : ''} ($${l.billedAmount})`
  ).join(', ')

  // Get full coding context (payer policy + AMA guidelines + NCCI bundling) for each E&M line
  const emLines = claim.serviceLines.filter(l => /^992\d\d$|^993\d\d$/.test(l.procedureCode))
  const contextBlocks = []
  for (const line of emLines) {
    const ctx = await getCodingContext({
      payerCode:      claim.payerCode,
      cptCode:        line.procedureCode,
      diagnosisCodes: claim.diagnosisCodes,
    }).catch(() => null)
    if (ctx?.summary) contextBlocks.push(ctx.summary)
  }
  const policySection = contextBlocks.length
    ? `\nCoding intelligence:\n${contextBlocks.join('\n\n')}\n`
    : ''

  // No PHI — only billing codes and clinical context (no patient identifiers)
  const prompt = `
You are a medical billing auditor reviewing a claim before submission.

Payer: ${claim.payerCode}
Place of service: ${claim.placeOfService}
Diagnosis codes (ICD-10): ${claim.diagnosisCodes.join(', ')}
Procedures: ${procedures}
Note documented: ${claim.noteDocumented}
${policySection}
Respond in JSON with exactly this shape:
{
  "valid": true or false,
  "issues": ["issue 1", "issue 2"] or [],
  "analysis": "one sentence summary"
}

Check: (1) Do diagnosis codes support medical necessity for these procedures? (2) Are there NCCI bundling issues? (3) Are the ICD-10 codes valid and specific enough?${policySection ? ' (4) Does the documentation meet the published AMA and payer requirements for these E&M codes based on the coding intelligence above?' : ''} No patient information in your response.
`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      response_format: { type: 'json_object' }
    })

    const parsed = JSON.parse(response.choices[0].message.content)
    return {
      valid: parsed.valid,
      issues: (parsed.issues || []).map(msg => ({ check: 'ai_validation', message: msg, fixable: true })),
      analysis: parsed.analysis || ''
    }
  } catch (err) {
    console.error('[CLAIM SCRUB AGENT] AI validation failed:', err.message)
    return { valid: true, issues: [], analysis: 'AI validation unavailable — manual review recommended' }
  }
}

async function runClaimScrubAgent(claim, credentialedPayers = null) {
  console.log(`\n[CLAIM SCRUB AGENT] Starting scrub for claim ${claim.claimId}`)

  const errors = []
  const warnings = []

  // Rule-based checks — run all synchronously first
  errors.push(...checkRequiredFields(claim))
  console.log(`[CLAIM SCRUB AGENT] Required fields check — ${errors.filter(e => e.check === 'required_fields').length} issue(s)`)

  errors.push(...checkTimelyFiling(claim))
  console.log(`[CLAIM SCRUB AGENT] Timely filing check — ${errors.filter(e => e.check === 'timely_filing').length} issue(s)`)

  errors.push(...checkEMLevel(claim))
  console.log(`[CLAIM SCRUB AGENT] E&M level check — ${errors.filter(e => e.check === 'em_level').length} issue(s)`)

  errors.push(...checkModifiers(claim))
  console.log(`[CLAIM SCRUB AGENT] Modifier check — ${errors.filter(e => e.check === 'modifier').length} issue(s)`)

  errors.push(...checkCredentialing(claim, credentialedPayers))
  console.log(`[CLAIM SCRUB AGENT] Credentialing check — ${errors.filter(e => e.check === 'credentialing').length} issue(s)`)

  errors.push(...checkDuplicate(claim))
  console.log(`[CLAIM SCRUB AGENT] Duplicate check — ${errors.filter(e => e.check === 'duplicate').length} issue(s)`)

  // AI code-combination validation — skipped when no diagnosis codes (e.g. DB claims)
  let aiValidation = { valid: true, issues: [], analysis: '' }
  if (claim.diagnosisCodes && claim.diagnosisCodes.length > 0) {
    console.log(`[CLAIM SCRUB AGENT] Running AI code combination validation`)
    try {
      aiValidation = await validateCodeCombinations(claim)
      errors.push(...aiValidation.issues)
    } catch (err) {
      console.error('[CLAIM SCRUB AGENT] AI step error:', err.message)
    }
    console.log(`[CLAIM SCRUB AGENT] AI validation — ${aiValidation.issues.length} issue(s)`)
  } else {
    console.log(`[CLAIM SCRUB AGENT] AI code validation skipped — no diagnosis codes`)
  }

  const passed = errors.length === 0
  const autoSubmit = passed

  if (autoSubmit) markSubmitted(claim)

  const result = {
    claimId: claim.claimId,
    passed,
    autoSubmit,
    errorCount: errors.length,
    errors,
    warnings,
    aiAnalysis: aiValidation.analysis,
    scrubbedAt: new Date().toISOString()
  }

  console.log(`[CLAIM SCRUB AGENT] Claim ${claim.claimId} — ${passed ? 'PASSED — auto-submitting' : `FAILED — ${errors.length} error(s)`}`)

  return result
}

async function runClaimScrubAgentForProvider(providerId) {
  console.log(`\n[CLAIM SCRUB AGENT] Starting DB scrub for provider ${providerId}`)

  const providerRow = await db.query('SELECT npi, tax_id FROM providers WHERE id = $1', [providerId])
  if (!providerRow.rows.length) throw new Error(`Provider ${providerId} not found`)
  const provider = providerRow.rows[0]

  const enrollRows = await db.query(
    `SELECT payer_code FROM payer_enrollments WHERE provider_id = $1 AND status = 'active'`,
    [providerId]
  )
  const credentialedPayers = enrollRows.rows.map(r => r.payer_code)
  console.log(`[CLAIM SCRUB AGENT] Active payer enrollments: ${credentialedPayers.join(', ')}`)

  const claimRows = await db.query(
    `SELECT c.id AS db_claim_id, c.claim_number, c.payer_code, c.date_of_service,
            p.token AS patient_token,
            cl.procedure_code, cl.billed_amount AS line_billed, cl.units
     FROM claims c
     JOIN patients p ON c.patient_id = p.id
     LEFT JOIN claim_lines cl ON cl.claim_id = c.id
     WHERE c.provider_id = $1 AND c.status IN ('pending', 'needs_action')
     ORDER BY c.id, cl.id`,
    [providerId]
  )

  // Group service lines by claim
  const claimsMap = new Map()
  for (const row of claimRows.rows) {
    if (!claimsMap.has(row.db_claim_id)) {
      const dos = row.date_of_service
        ? (row.date_of_service instanceof Date
            ? row.date_of_service.toISOString().split('T')[0]
            : String(row.date_of_service).split('T')[0])
        : null
      claimsMap.set(row.db_claim_id, {
        dbClaimId:     row.db_claim_id,
        claimId:       row.claim_number,
        providerNPI:   provider.npi,
        providerTaxId: provider.tax_id,
        patientToken:  row.patient_token,
        payerCode:     row.payer_code,
        dateOfService: dos,
        placeOfService: '11',
        diagnosisCodes: [],  // not in DB schema — AI code validation skipped
        serviceLines:   [],
        complexity:     null, // not in DB schema — E&M check naturally skipped
        noteDocumented: true
      })
    }
    if (row.procedure_code) {
      claimsMap.get(row.db_claim_id).serviceLines.push({
        procedureCode: row.procedure_code,
        modifiers:     [],
        billedAmount:  parseFloat(row.line_billed) || 0,
        units:         row.units || 1
      })
    }
  }

  console.log(`[CLAIM SCRUB AGENT] Found ${claimsMap.size} claim(s) to scrub`)

  const results = []
  for (const claim of claimsMap.values()) {
    const scrubResult = await runClaimScrubAgent(claim, credentialedPayers)
    results.push(scrubResult)

    if (scrubResult.passed) {
      try {
        await db.query(
          `UPDATE claims SET submitted_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [claim.dbClaimId]
        )
        console.log(`[CLAIM SCRUB AGENT] Claim ${claim.claimId} — submitted, DB updated`)
      } catch (err) {
        console.error(`[CLAIM SCRUB AGENT] DB update failed for ${claim.claimId}:`, err.message)
      }
    } else {
      try {
        await db.query(
          `UPDATE claims SET status = 'needs_action', updated_at = NOW() WHERE id = $1`,
          [claim.dbClaimId]
        )
      } catch (err) {
        console.error(`[CLAIM SCRUB AGENT] Status update failed for ${claim.claimId}:`, err.message)
      }

      for (const error of scrubResult.errors) {
        try {
          const sourceId = `${claim.claimId}|${error.check}`
          const existing = await db.query(
            `SELECT id FROM action_items
             WHERE provider_id = $1 AND source_agent = 'claim_scrub_agent'
               AND source_id = $2 AND resolved = false`,
            [providerId, sourceId]
          )
          if (existing.rows.length === 0) {
            await db.saveActionItem({
              providerId,
              type:         'scrub_failure',
              priority:     3,
              title:        `Scrub failed: ${claim.claimId} — ${error.check}`,
              description:  error.message,
              aiInstruction: error.message,
              sourceAgent:  'claim_scrub_agent',
              sourceId
            })
          }
        } catch (err) {
          console.error(`[CLAIM SCRUB AGENT] Action item save failed:`, err.message)
        }
      }
    }
  }

  const passedCount = results.filter(r => r.passed).length
  const failedCount = results.filter(r => !r.passed).length
  console.log(`\n[CLAIM SCRUB AGENT] Complete — ${passedCount} passed, ${failedCount} failed`)
  return results
}

module.exports = { runClaimScrubAgent, runClaimScrubAgentForProvider, getMockClaim, markSubmitted, checkRequiredFields, checkEMLevel, checkModifiers, checkTimelyFiling, checkCredentialing }
