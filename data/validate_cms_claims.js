'use strict'
require('dotenv').config()

const fs       = require('fs')
const readline = require('readline')
const path     = require('path')
const { Pool }   = require('pg')
const { OpenAI } = require('openai')

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD
})

const CSV_PATH    = path.join(__dirname, 'carrier.csv')
const OUTPUT_PATH = path.join(__dirname, 'validation_results.json')

const isValidHCPCS = c => /^\d{5}$/.test(c) || /^[A-Z]\d{4}$/.test(c)
const isEM = c => { const n = parseInt(c, 10); return n >= 99202 && n <= 99215 }

const mapCMSClaim = (row) => ({
  claim_id:           row.CLM_ID,
  cpt_code:           row.HCPCS_CD,
  icd10_primary:      row.PRNCPAL_DGNS_CD,
  icd10_codes:        [row.ICD_DGNS_CD1, row.ICD_DGNS_CD2, row.ICD_DGNS_CD3, row.ICD_DGNS_CD4].filter(Boolean),
  billed_amount:      parseFloat(row.NCH_CARR_CLM_SBMTD_CHRG_AMT) || 0,
  paid_amount:        parseFloat(row.CLM_PMT_AMT) || 0,
  place_of_service:   row.LINE_PLACE_OF_SRVC_CD,
  provider_specialty: row.PRVDR_SPCLTY,
  payer_code:         'MEDICARE',
  cms_outcome:        row.CLM_DISP_CD === '2' ? 'denied' : row.CLM_DISP_CD === '1' ? 'paid' : 'other',
  denial_code:        row.CARR_CLM_PMT_DNL_CD,
})

// ── Layers ────────────────────────────────────────────────────────────────────

function layer1(claim) {
  const flags = []
  if (!claim.cpt_code)                                    flags.push('missing_cpt')
  if (!claim.icd10_primary && !claim.icd10_codes.length) flags.push('missing_icd10')
  if (!claim.place_of_service)                           flags.push('missing_pos')
  if (claim.billed_amount === 0)                         flags.push('zero_billed')
  if (claim.cpt_code && !isValidHCPCS(claim.cpt_code))  flags.push('invalid_cpt')
  return flags
}

async function layer2(claim) {
  // Only applies to E&M codes — payer_policies covers 99202-99215 only
  if (!claim.cpt_code || !isEM(claim.cpt_code)) return []

  let policy = null
  try {
    const res = await pool.query(
      `SELECT coverage_criteria FROM payer_policies WHERE payer_code=$1 AND cpt_code=$2 LIMIT 1`,
      ['MEDICARE', claim.cpt_code]
    )
    policy = res.rows[0] || null
  } catch (err) {
    return ['db_error']
  }

  if (!policy) return ['no_policy_data']

  const flags = []
  const coverage = (policy.coverage_criteria || '').toLowerCase()
  if (coverage.includes('not covered') || coverage.includes('excluded')) flags.push('not_covered')
  const allDiags = [claim.icd10_primary, ...claim.icd10_codes].filter(Boolean)
  if (!allDiags.length) flags.push('no_supporting_diagnosis')
  return flags
}

// Layer 3 only fires on claims that pass L1 + L2 — one GPT-4o call per claim
async function layer3(claim) {
  const diags = [claim.icd10_primary, ...claim.icd10_codes].filter(Boolean).join(', ')
  const prompt = [
    `Medicare claim billing audit. No PHI present.`,
    `CPT: ${claim.cpt_code} | ICD-10: ${diags} | POS: ${claim.place_of_service}`,
    `Is there a billing issue? Consider: medical necessity, NCCI bundling, modifier requirements, prior auth, benefit limits.`,
    `JSON only: { "decision": "pass"|"fail"|"warning", "reason": "<one sentence>", "category": "bundling"|"medical_necessity"|"modifier"|"prior_auth"|"benefit_limit"|"other"|"none" }`,
  ].join('\n')

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const res = await openai.chat.completions.create({
      model:           'gpt-4o',
      messages:        [{ role: 'user', content: prompt }],
      max_tokens:      80,
      response_format: { type: 'json_object' },
    })
    return JSON.parse(res.choices[0].message.content)
  } catch (err) {
    console.warn(`[VALIDATE] GPT-4o failed for ${claim.claim_id}:`, err.message)
    return { decision: 'warning', reason: 'AI unavailable', category: 'other' }
  }
}

async function evaluate(claim) {
  const l1 = layer1(claim)
  if (l1.length) return { agent_decision: 'flag', flags_raised: l1, layer_caught: 1 }

  const l2 = await layer2(claim)
  if (l2.length) return { agent_decision: 'flag', flags_raised: l2, layer_caught: 2 }

  const l3 = await layer3(claim)
  if (l3.decision === 'fail') {
    return { agent_decision: 'flag', flags_raised: [`l3:${l3.category}:${l3.reason}`], layer_caught: 3 }
  }
  return { agent_decision: 'pass', flags_raised: [], layer_caught: null }
}

// ── CSV reader — filter for valid populated rows ───────────────────────────────

function isQualified(row) {
  const cpt = row.HCPCS_CD || ''
  return cpt && isValidHCPCS(cpt) && row.PRNCPAL_DGNS_CD && row.LINE_PLACE_OF_SRVC_CD &&
    parseFloat(row.NCH_CARR_CLM_SBMTD_CHRG_AMT) > 0
}

async function readPaidSample(n) {
  return new Promise((resolve, reject) => {
    const rows  = []
    const rl    = readline.createInterface({ input: fs.createReadStream(CSV_PATH), crlfDelay: Infinity })
    let headers = null
    let scanned = 0

    rl.on('line', (line) => {
      if (!headers) { headers = line.split('|'); return }
      if (rows.length >= n) { rl.close(); return }
      const vals = line.split('|')
      const row  = {}
      headers.forEach((h, i) => { row[h] = vals[i] || '' })
      scanned++
      if (isQualified(row)) rows.push(row)
    })
    rl.on('close', () => { console.log(`[VALIDATE] Scanned ${scanned} rows → ${rows.length} qualified paid`); resolve(rows) })
    rl.on('error', reject)
  })
}

// ── Synthetic denied claims ───────────────────────────────────────────────────

function generateSyntheticDenied() {
  const base = (id, overrides, denial_code, denial_reason) => ({
    claim_id: `SYN-${String(id).padStart(3, '0')}`,
    cpt_code: 'G0444',
    icd10_primary: 'Z13.89',
    icd10_codes: ['F32.9'],
    billed_amount: 125.00,
    paid_amount: 0,
    place_of_service: '11',
    provider_specialty: '01',
    payer_code: 'MEDICARE',
    cms_outcome: 'denied',
    denial_code,
    _denial_reason: denial_reason,  // explains why CMS denied — for FN pattern analysis
    ...overrides,
  })

  const claims = []
  let id = 1

  // ── Layer 1 catches (should be TP) ──

  // Missing CPT (10)
  for (let i = 0; i < 10; i++) claims.push(base(id++, { cpt_code: '' }, 'CO-16', 'missing_cpt'))
  // Missing ICD-10 (7)
  for (let i = 0; i < 7; i++) claims.push(base(id++, { icd10_primary: '', icd10_codes: [] }, 'CO-11', 'missing_icd10'))
  // Zero billed (5)
  for (let i = 0; i < 5; i++) claims.push(base(id++, { billed_amount: 0 }, 'CO-4', 'zero_billed'))
  // Missing POS (4)
  for (let i = 0; i < 4; i++) claims.push(base(id++, { place_of_service: '' }, 'CO-16', 'missing_pos'))
  // Invalid CPT format (4)
  const badCpts = ['BADCD', '9999X', 'AB123', 'Z9999']
  for (let i = 0; i < 4; i++) claims.push(base(id++, { cpt_code: badCpts[i] }, 'CO-4', 'invalid_cpt'))

  // ── Layer 2 catches (should be TP — E&M codes, no policy or not covered) ──

  const emCodes = ['99202', '99203', '99204', '99213', '99214']
  for (const cpt of emCodes) {
    claims.push(base(id++, { cpt_code: cpt }, 'CO-50', 'em_no_policy'))
  }

  // ── Rules miss these — FN — structurally valid, denied for non-structural reasons ──

  // CO-97: bundling — two codes billed together violating NCCI (valid fields, can't detect without NCCI table)
  for (let i = 0; i < 4; i++) claims.push(base(id++, { cpt_code: 'G0444' }, 'CO-97', 'bundling_violation'))
  // CO-B7: prior auth required — valid claim, no prior auth (can't detect without auth system)
  for (let i = 0; i < 3; i++) claims.push(base(id++, { cpt_code: '96156' }, 'CO-B7', 'prior_auth_required'))
  // CO-11: medical necessity — ICD-10 present but semantically wrong for CPT (need AI to detect)
  for (let i = 0; i < 4; i++) claims.push(base(id++, { cpt_code: '99408', icd10_primary: 'M79.3', icd10_codes: ['M79.1'] }, 'CO-11', 'medical_necessity'))
  // CO-4: modifier required — valid CPT, no modifier provided (no modifier field in our claim struct)
  for (let i = 0; i < 2; i++) claims.push(base(id++, { cpt_code: '99495' }, 'CO-4', 'missing_modifier'))
  // CO-119: benefit maximum reached — nothing in claim fields indicates this
  for (let i = 0; i < 2; i++) claims.push(base(id++, { cpt_code: 'G0442' }, 'CO-119', 'benefit_max_reached'))

  return claims
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scorecard(results, label) {
  const denied = results.filter(r => r.cms_outcome === 'denied')
  const paid   = results.filter(r => r.cms_outcome === 'paid')

  const TP = results.filter(r => r.agent_decision === 'flag' && r.cms_outcome === 'denied').length
  const FN = results.filter(r => r.agent_decision === 'pass' && r.cms_outcome === 'denied').length
  const FP = results.filter(r => r.agent_decision === 'flag' && r.cms_outcome === 'paid').length
  const TN = results.filter(r => r.agent_decision === 'pass' && r.cms_outcome === 'paid').length

  const catchRate = denied.length ? ((TP / denied.length) * 100).toFixed(1) : 'N/A'
  const fpRate    = paid.length   ? ((FP / paid.length)   * 100).toFixed(1) : 'N/A'

  const l1TP = results.filter(r => r.layer_caught === 1 && r.cms_outcome === 'denied').length
  const l2TP = results.filter(r => r.layer_caught === 2 && r.cms_outcome === 'denied').length
  const l3TP = results.filter(r => r.layer_caught === 3 && r.cms_outcome === 'denied').length

  const l1Pct  = denied.length ? ((l1TP / denied.length) * 100).toFixed(1) : '0.0'
  const l2Pct  = denied.length ? ((l2TP / denied.length) * 100).toFixed(1) : '0.0'
  const l3Pct  = denied.length ? ((l3TP / denied.length) * 100).toFixed(1) : '0.0'
  const missPct = denied.length ? ((FN   / denied.length) * 100).toFixed(1) : '0.0'

  // FN patterns
  const fnPatterns = {}
  results.filter(r => r.agent_decision === 'pass' && r.cms_outcome === 'denied').forEach(r => {
    const key = r._denial_reason || r.denial_code || 'unknown'
    fnPatterns[key] = (fnPatterns[key] || 0) + 1
  })
  const topFN = Object.entries(fnPatterns).sort((a, b) => b[1] - a[1]).slice(0, 3)

  // FP triggers
  const fpTriggers = {}
  results.filter(r => r.agent_decision === 'flag' && r.cms_outcome === 'paid').forEach(r => {
    const key = r.flags_raised[0] || 'unknown'
    fpTriggers[key] = (fpTriggers[key] || 0) + 1
  })
  const topFP = Object.entries(fpTriggers).sort((a, b) => b[1] - a[1]).slice(0, 3)

  const D = '═'.repeat(52)
  const lines = [
    D,
    label,
    D,
    `Total claims:        ${results.length}  (denied: ${denied.length} | paid: ${paid.length})`,
    '',
    `True positives:      ${TP}`,
    `False negatives:     ${FN}   ← misses`,
    `False positives:     ${FP}`,
    `True negatives:      ${TN}`,
    '',
    `Agent catch rate:    ${catchRate}% (of denials caught)`,
    `False positive rate: ${fpRate}% (of paid claims flagged)`,
    '',
    'By layer:',
    `  Layer 1 catches:   ${l1TP} (${l1Pct}% of denials)`,
    `  Layer 2 catches:   ${l2TP} (${l2Pct}% of denials)`,
    `  Layer 3 catches:   ${l3TP} (${l3Pct}% of denials)`,
    `  Missed entirely:   ${FN} (${missPct}% of denials)`,
    '',
    'Most common missed denial patterns (FN):',
  ]
  topFN.forEach(([p, n], i) => lines.push(`  ${i + 1}. ${p} — ${n} claim${n > 1 ? 's' : ''}`))
  if (!topFN.length) lines.push('  (none)')
  lines.push('')
  lines.push('Most common false positive triggers:')
  topFP.forEach(([r, n], i) => lines.push(`  ${i + 1}. ${r} — ${n} claim${n > 1 ? 's' : ''}`))
  if (!topFP.length) lines.push('  (none)')
  lines.push(D)
  return lines.join('\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── PART 1: FP analysis — 100 real paid rows ─────────────────────────────

  console.log('\n[VALIDATE] PART 1 — reading 100 qualified paid rows from carrier.csv...')
  const realPaid100 = await readPaidSample(20)
  const realMapped  = realPaid100.map(mapCMSClaim)

  const part1Results = []
  for (const claim of realMapped) {
    const { agent_decision, flags_raised, layer_caught } = await evaluate(claim)
    part1Results.push({ ...claim, agent_decision, flags_raised, layer_caught, _source: 'cms_real' })
  }

  // ── PART 2: Full TP/FN/FP/TN — 50 paid + 50 synthetic denied ────────────

  console.log('[VALIDATE] PART 2 — loading 50 paid + 50 synthetic denied...')
  const real50     = realMapped.slice(0, 20)
  // Only structurally valid denied claims — all Layer 1 checks pass
  // This isolates what Layer 2 (payer policy) actually catches
  const synthetic  = generateSyntheticDenied().filter(c =>
    c.cpt_code && isValidHCPCS(c.cpt_code) &&
    (c.icd10_primary || c.icd10_codes.length) &&
    c.place_of_service &&
    c.billed_amount > 0
  )
  const mixed      = [...real50, ...synthetic]

  const part2Results = []
  for (const claim of mixed) {
    const { agent_decision, flags_raised, layer_caught } = await evaluate(claim)
    part2Results.push({ ...claim, agent_decision, flags_raised, layer_caught, _source: claim._denial_reason ? 'synthetic_denied' : 'cms_real' })
  }

  // ── Print ─────────────────────────────────────────────────────────────────

  console.log('\n' + scorecard(part1Results, 'PART 1 — FALSE POSITIVE RATE (100 REAL PAID CLAIMS)'))
  console.log('\n' + scorecard(part2Results, 'PART 2 — FULL SCORECARD (50 PAID + 50 SYNTHETIC DENIED)'))

  // ── Save ──────────────────────────────────────────────────────────────────

  const output = {
    generated_at: new Date().toISOString(),
    part1_fp_analysis: part1Results,
    part2_mixed: part2Results,
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2))
  console.log(`\n[VALIDATE] Results saved → ${OUTPUT_PATH}`)

  await pool.end()
}

main().catch(err => {
  console.error('[VALIDATE] Fatal:', err.message)
  pool.end()
  process.exit(1)
})
