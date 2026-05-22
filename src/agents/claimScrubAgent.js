'use strict'
require('dotenv').config()

const { OpenAI } = require('openai')
const pool = require('../lib/db')
const { getCodingContext } = require('../lib/codingIntelligence')

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMELY_FILING_DAYS = {
  MEDICARE: 365, MEDICAID: 365, AETNA: 365,
  UHC: 365, UNITED: 365, BCBS: 180, CIGNA: 180
}
const DEFAULT_TIMELY_DAYS = 90

const RECOGNIZED_PAYERS = new Set([
  'MEDICARE', 'MEDICAID', 'AETNA', 'UHC', 'UNITED', 'BCBS', 'CIGNA', 'TRICARE', 'HUMANA'
])

const isEmCode      = c => /^992\d{2}$/.test(c)
const isPreventive  = c => { const n = parseInt(c, 10); return (n >= 99381 && n <= 99387) || (n >= 99391 && n <= 99397) }

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function fetchSupporting(claim) {
  const [prov, pat, lines] = await Promise.all([
    pool.query('SELECT npi, tax_id FROM providers WHERE id = $1', [claim.provider_id]),
    pool.query('SELECT token FROM patients WHERE id = $1', [claim.patient_id]),
    pool.query('SELECT procedure_code, billed_amount, units FROM claim_lines WHERE claim_id = $1 ORDER BY id', [claim.id])
  ])
  return {
    provider:     prov.rows[0] || null,
    patient:      pat.rows[0] || null,
    serviceLines: lines.rows
  }
}

async function writeResult(claim, decision, layerTag, reason, actionPriority) {
  const status = decision === 'fail' ? 'needs_action' : 'ready_to_submit'
  try {
    await pool.query(
      `UPDATE claims
       SET status=$1, scrub_result=$2, scrub_notes=$3, scrubbed_at=NOW(), updated_at=NOW()
       WHERE id=$4`,
      [status, decision, reason, claim.id]
    )
  } catch (err) {
    console.error(`[CLAIM SCRUB] DB update failed for ${claim.id}:`, err.message)
  }
  if (decision !== 'pass') {
    const sourceId = `scrub|${claim.id}`
    try {
      const dup = await pool.query(
        `SELECT id FROM action_items WHERE source_agent='claimScrubAgent' AND source_id=$1 AND resolved=false`,
        [sourceId]
      )
      if (!dup.rows.length) {
        await pool.query(
          `INSERT INTO action_items
             (provider_id, type, priority, title, description, ai_instruction, source_agent, source_id, created_at)
           VALUES ($1,'claim_scrub_fail',$2,$3,$4,$5,'claimScrubAgent',$6,NOW())`,
          [
            claim.provider_id, actionPriority,
            `Scrub ${decision} [${layerTag}]: ${claim.claim_number || claim.id}`,
            reason, reason, sourceId
          ]
        )
      }
    } catch (err) {
      console.error('[CLAIM SCRUB] Action item insert failed:', err.message)
    }
  }
}

// ─── Layer 1: Hard Rules (binary, no AI) ─────────────────────────────────────

async function layer1(claim, provider, patient, serviceLines) {
  if (!provider?.npi)        return 'Provider NPI is missing'
  if (!provider?.tax_id)     return 'Provider Tax ID is missing'
  if (!claim.date_of_service) return 'Date of service is missing'

  const dos = new Date(claim.date_of_service)
  if (isNaN(dos.getTime()))  return `Date of service '${claim.date_of_service}' is invalid`

  if (!serviceLines.length)  return 'No CPT codes — at least one service line required'
  if (!patient)              return 'Patient record not found'

  const payer = (claim.payer_code || '').toUpperCase()
  if (!payer)                return 'Payer code is missing'
  if (!RECOGNIZED_PAYERS.has(payer)) return `Payer '${claim.payer_code}' not recognized — verify enrollment`

  const daysSince = Math.floor((Date.now() - dos.getTime()) / 86400000)
  const window = TIMELY_FILING_DAYS[payer] || DEFAULT_TIMELY_DAYS
  if (daysSince > window) {
    return `Timely filing missed — ${daysSince} days since DOS, ${payer} allows ${window} days`
  }

  // Duplicate: another submitted/paid claim for same patient + DOS
  try {
    const dup = await pool.query(
      `SELECT claim_number FROM claims
       WHERE patient_id=$1 AND date_of_service=$2 AND status IN ('submitted','paid') AND id!=$3
       LIMIT 1`,
      [claim.patient_id, claim.date_of_service, claim.id]
    )
    if (dup.rows.length) {
      return `Duplicate — claim ${dup.rows[0].claim_number} already submitted for this patient on this date`
    }
  } catch (err) {
    console.warn('[CLAIM SCRUB] Duplicate check error:', err.message)
  }

  return null
}

// ─── Layer 2: Payer Policy Rules (no AI) ─────────────────────────────────────

async function layer2(claim, serviceLines) {
  const payer    = (claim.payer_code || '').toUpperCase()
  const cptCodes = serviceLines.map(l => l.procedure_code)
  const emCodes  = cptCodes.filter(isEmCode)

  // Modifier 25 required when E&M + preventive billed same day
  const preventiveCodes = cptCodes.filter(isPreventive)
  if (emCodes.length && preventiveCodes.length) {
    const emLine = serviceLines.find(l => isEmCode(l.procedure_code))
    const mods   = (emLine.modifiers || []).map(String)
    if (!mods.includes('25')) {
      return `${payer} requires modifier 25 on ${emLine.procedure_code} when billed same day as preventive (${preventiveCodes.join('/')}) — add modifier 25 to the E&M line`
    }
  }

  // Payer policy + NCCI bundling for each E&M code
  for (const cpt of emCodes) {
    let ctx
    try {
      ctx = await getCodingContext({
        payerCode:      payer,
        cptCode:        cpt,
        diagnosisCodes: claim.diagnosis_codes || claim.diagnosisCodes || []
      })
    } catch (err) {
      console.warn(`[CLAIM SCRUB] getCodingContext failed for ${payer}/${cpt}:`, err.message)
      continue
    }

    // Payer explicitly doesn't cover this CPT
    const coverage = (ctx.payerRequirements?.coverage_criteria || '').toLowerCase()
    if (coverage.includes('not covered') || coverage.includes('excluded')) {
      return `${payer} does not cover ${cpt} — ${ctx.payerRequirements.coverage_criteria}`
    }

    // NCCI bundling: rule text says "cannot be billed with [other CPT]"
    for (const rule of ctx.bundlingRules || []) {
      const content = (rule.content || '').toLowerCase()
      for (const other of cptCodes) {
        if (other !== cpt && content.includes(other) && content.includes('cannot be billed')) {
          return `NCCI bundling violation: ${cpt} and ${other} cannot be billed together — ${rule.content}`
        }
      }
    }
  }

  return null
}

// ─── Layer 3: AI Judgment (one GPT-4o call max) ───────────────────────────────

async function layer3(claim, serviceLines) {
  const payer   = (claim.payer_code || '').toUpperCase()
  const emLines = serviceLines.filter(l => isEmCode(l.procedure_code))

  // Fetch coding context for each E&M line in parallel
  const ctxResults = await Promise.allSettled(
    emLines.map(l => getCodingContext({
      payerCode:      payer,
      cptCode:        l.procedure_code,
      diagnosisCodes: claim.diagnosis_codes || claim.diagnosisCodes || []
    }))
  )
  const codingCtx = ctxResults
    .filter(r => r.status === 'fulfilled' && r.value?.summary)
    .map(r => r.value.summary)
    .join('\n')
    .slice(0, 350)  // keep prompt under 800 tokens

  const procedures = serviceLines.map(l => `${l.procedure_code} ($${l.billed_amount})`).join(', ')
  const diagCodes  = (claim.diagnosis_codes || claim.diagnosisCodes || []).join(', ') || 'not provided'

  const prompt = [
    `Billing audit. Payer: ${payer}. POS: ${claim.place_of_service || '11'}.`,
    `ICD-10: ${diagCodes}. CPT: ${procedures}.`,
    codingCtx && `Requirements:\n${codingCtx}`,
    `Does ICD-10 support medical necessity? E&M level appropriate? Any NCCI or billing issues?`,
    `JSON only: { "decision": "pass"|"fail"|"warning", "reason": "<one sentence>", "action": "<specific fix or null>" }`
  ].filter(Boolean).join('\n')

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await openai.chat.completions.create({
      model:           'gpt-4o',
      messages:        [{ role: 'user', content: prompt }],
      max_tokens:      120,
      response_format: { type: 'json_object' }
    })
    return JSON.parse(res.choices[0].message.content)
  } catch (err) {
    console.error('[CLAIM SCRUB] GPT-4o call failed:', err.message)
    return { decision: 'warning', reason: 'AI judgment unavailable — manual review recommended', action: 'Review before submission' }
  }
}

// ─── scrubClaim — main entry point for DB claims ─────────────────────────────

async function scrubClaim(claim) {
  const t0    = Date.now()
  const label = claim.claim_number || claim.id
  console.log(`[CLAIM SCRUB] Starting: ${label}`)

  let provider, patient, serviceLines
  try {
    ;({ provider, patient, serviceLines } = await fetchSupporting(claim))
  } catch (err) {
    console.error(`[CLAIM SCRUB] ${label} — DB fetch error:`, err.message)
    return { claimId: claim.id, decision: 'fail', reason: `DB fetch error: ${err.message}`, layer: 0 }
  }

  // ── Layer 1: Hard Rules ──
  const l1fail = await layer1(claim, provider, patient, serviceLines)
  if (l1fail) {
    console.log(`[CLAIM SCRUB] ${label} → Layer 1 FAIL: ${l1fail}`)
    await writeResult(claim, 'fail', 'layer_1', l1fail, 1)
    return { claimId: claim.id, decision: 'fail', reason: l1fail, layer: 1 }
  }
  console.log(`[CLAIM SCRUB] ${label} — Layer 1 passed`)

  // ── Layer 2: Payer Policy ──
  const l2fail = await layer2(claim, serviceLines)
  if (l2fail) {
    console.log(`[CLAIM SCRUB] ${label} → Layer 2 FAIL: ${l2fail}`)
    await writeResult(claim, 'fail', 'layer_2', l2fail, 2)
    return { claimId: claim.id, decision: 'fail', reason: l2fail, layer: 2 }
  }
  console.log(`[CLAIM SCRUB] ${label} — Layer 2 passed`)

  // ── Layer 3: AI Judgment ──
  const l3 = await layer3(claim, serviceLines)
  await writeResult(claim, l3.decision, 'layer_3', l3.reason, l3.decision === 'fail' ? 2 : 3)
  console.log(`[CLAIM SCRUB] ${label} → Layer 3 ${l3.decision.toUpperCase()}: ${l3.reason} (${Date.now() - t0}ms)`)

  return { claimId: claim.id, decision: l3.decision, reason: l3.reason, layer: 3 }
}

// ─── Backward-compatible interface for mock/index.js testing ─────────────────

const EM_COMPLEXITY = {
  '99202': 'straightforward', '99212': 'straightforward',
  '99203': 'low',             '99213': 'low',
  '99204': 'moderate',        '99214': 'moderate',
  '99205': 'high',            '99215': 'high'
}

const TIMELY_WINDOWS_MOCK = { MEDICARE: 365, MEDICAID: 365, AETNA: 365, UHC: 365, BCBS: 180, CIGNA: 180, DEFAULT: 90 }

const INVALID_MODIFIER_COMBOS = [
  { modifier: '57', not_with: ['99202', '99203', '99212', '99213'] }
]

function checkRequiredFields(claim) {
  const errors = []
  for (const [field, message] of [
    ['providerNPI',  'Provider NPI is required'],
    ['providerTaxId','Provider Tax ID is required'],
    ['dateOfService','Date of service is required'],
    ['placeOfService','Place of service is required'],
    ['patientToken', 'Patient identifier is required'],
    ['payerCode',    'Payer code is required']
  ]) {
    if (!claim[field]) errors.push({ check: 'required_fields', field, message, fixable: true })
  }
  if (!claim.diagnosisCodes?.length)
    errors.push({ check: 'required_fields', field: 'diagnosisCodes', message: 'At least one diagnosis code is required', fixable: true })
  if (!claim.serviceLines?.length)
    errors.push({ check: 'required_fields', field: 'serviceLines', message: 'At least one service line is required', fixable: true })
  return errors
}

function checkTimelyFiling(claim) {
  const window = TIMELY_WINDOWS_MOCK[claim.payerCode] || TIMELY_WINDOWS_MOCK.DEFAULT
  const days   = Math.floor((Date.now() - new Date(claim.dateOfService)) / 86400000)
  if (days > window) {
    return [{ check: 'timely_filing', message: `${days} days past DOS — ${claim.payerCode || 'this payer'} requires submission within ${window} days`, fixable: false }]
  }
  return []
}

function checkEMLevel(claim) {
  const errors = []
  for (const line of (claim.serviceLines || []).filter(l => EM_COMPLEXITY[l.procedureCode])) {
    const expected = EM_COMPLEXITY[line.procedureCode]
    if (claim.complexity && expected !== claim.complexity) {
      errors.push({
        check: 'em_level', procedureCode: line.procedureCode,
        message: `${line.procedureCode} requires ${expected} complexity but note documents ${claim.complexity} — downcode or upgrade documentation`,
        fixable: true
      })
    }
  }
  return errors
}

function checkModifiers(claim) {
  const errors = []
  for (const line of (claim.serviceLines || [])) {
    for (const modifier of (line.modifiers || [])) {
      const rule = INVALID_MODIFIER_COMBOS.find(r => r.modifier === modifier && r.not_with.includes(line.procedureCode))
      if (rule) errors.push({ check: 'modifier', procedureCode: line.procedureCode, modifier, message: `Modifier ${modifier} invalid with ${line.procedureCode}`, fixable: true })
    }
  }
  return errors
}

function checkCredentialing(claim, credentialedPayers) {
  const active = credentialedPayers || ['MEDICARE', 'AETNA', 'BCBS']
  if (claim.payerCode && !active.includes(claim.payerCode)) {
    return [{ check: 'credentialing', payerCode: claim.payerCode, message: `Provider not credentialed with ${claim.payerCode}`, fixable: false }]
  }
  return []
}

function getMockClaim(scenario = 'clean') {
  const base = {
    claimId: 'CLM-TEST-001', providerId: 'PROV-001',
    providerNPI: '1234567890', providerTaxId: '123456789',
    patientToken: 'PT-A1B2C3D4', payerCode: 'AETNA',
    dateOfService: '2026-05-01', placeOfService: '11',
    diagnosisCodes: ['Z00.00', 'I10'],
    serviceLines: [{ procedureCode: '99214', modifiers: [], billedAmount: 250.00, units: 1 }],
    complexity: 'moderate', noteDocumented: true
  }
  const scenarios = {
    clean:            base,
    missing_npi:      { ...base, claimId: 'CLM-TEST-002', providerNPI: null },
    em_mismatch:      { ...base, claimId: 'CLM-TEST-003', serviceLines: [{ procedureCode: '99215', modifiers: [], billedAmount: 300.00, units: 1 }], complexity: 'low' },
    invalid_modifier: { ...base, claimId: 'CLM-TEST-004', serviceLines: [{ procedureCode: '99213', modifiers: ['57'], billedAmount: 180.00, units: 1 }] },
    timely_filing:    { ...base, claimId: 'CLM-TEST-005', dateOfService: '2024-01-15', payerCode: 'DEFAULT' },
    not_credentialed: { ...base, claimId: 'CLM-TEST-006', payerCode: 'UHC' }
  }
  return scenarios[scenario] || base
}

// Rules-only (no AI) for deterministic mock testing and index.js usage
async function runClaimScrubAgent(claim, credentialedPayers = null) {
  console.log(`\n[CLAIM SCRUB AGENT] Starting scrub for claim ${claim.claimId}`)
  const errors = []

  errors.push(...checkRequiredFields(claim))
  console.log(`[CLAIM SCRUB AGENT] Required fields — ${errors.filter(e => e.check === 'required_fields').length} issue(s)`)

  errors.push(...checkTimelyFiling(claim))
  console.log(`[CLAIM SCRUB AGENT] Timely filing — ${errors.filter(e => e.check === 'timely_filing').length} issue(s)`)

  errors.push(...checkEMLevel(claim))
  console.log(`[CLAIM SCRUB AGENT] E&M level — ${errors.filter(e => e.check === 'em_level').length} issue(s)`)

  errors.push(...checkModifiers(claim))
  console.log(`[CLAIM SCRUB AGENT] Modifiers — ${errors.filter(e => e.check === 'modifier').length} issue(s)`)

  errors.push(...checkCredentialing(claim, credentialedPayers))
  console.log(`[CLAIM SCRUB AGENT] Credentialing — ${errors.filter(e => e.check === 'credentialing').length} issue(s)`)

  const passed = errors.length === 0
  console.log(`[CLAIM SCRUB AGENT] ${claim.claimId} — ${passed ? 'PASSED' : `FAILED — ${errors.length} error(s)`}`)

  return {
    claimId:      claim.claimId,
    passed,
    autoSubmit:   passed,
    errorCount:   errors.length,
    errors,
    aiAnalysis:   '',
    scrubbedAt:   new Date().toISOString()
  }
}

module.exports = {
  scrubClaim,
  runClaimScrubAgent,
  getMockClaim,
  checkRequiredFields,
  checkEMLevel,
  checkModifiers,
  checkTimelyFiling,
  checkCredentialing
}
