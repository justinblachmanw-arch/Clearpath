'use strict'
require('dotenv').config()

const fs      = require('fs')
const readline = require('readline')
const path    = require('path')
const { Pool } = require('pg')

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD
})

const SAMPLE_SIZE  = 100
const CSV_PATH     = path.join(__dirname, 'carrier.csv')
const OUTPUT_PATH  = path.join(__dirname, 'validation_results.json')

// Valid HCPCS: 5 digits (CPT) or letter + 4 digits (Level II)
const isValidHCPCS = c => /^\d{5}$/.test(c) || /^[A-Z]\d{4}$/.test(c)
// E&M range only (what payer_policies covers)
const isEM = c => { const n = parseInt(c, 10); return n >= 99202 && n <= 99215 }

const mapCMSClaim = (row) => ({
  claim_id:           row.CLM_ID,
  cpt_code:           row.HCPCS_CD,
  icd10_primary:      row.PRNCPAL_DGNS_CD,
  icd10_codes:        [
    row.ICD_DGNS_CD1, row.ICD_DGNS_CD2,
    row.ICD_DGNS_CD3, row.ICD_DGNS_CD4
  ].filter(Boolean),
  billed_amount:      parseFloat(row.NCH_CARR_CLM_SBMTD_CHRG_AMT) || 0,
  paid_amount:        parseFloat(row.CLM_PMT_AMT) || 0,
  place_of_service:   row.LINE_PLACE_OF_SRVC_CD,
  provider_specialty: row.PRVDR_SPCLTY,
  payer_code:         'MEDICARE',
  cms_outcome:        row.CLM_DISP_CD === '2' ? 'denied' :
                      row.CLM_DISP_CD === '1' ? 'paid' : 'other',
  denial_code:        row.CARR_CLM_PMT_DNL_CD,
})

// ── Layer 1: Hard rules (binary, no DB, no AI) ────────────────────────────────

function layer1(claim) {
  const flags = []
  if (!claim.cpt_code)                                       flags.push('missing_cpt')
  if (!claim.icd10_primary && !claim.icd10_codes.length)    flags.push('missing_icd10')
  if (!claim.place_of_service)                              flags.push('missing_pos')
  if (claim.billed_amount === 0)                            flags.push('zero_billed')
  if (claim.cpt_code && !isValidHCPCS(claim.cpt_code))     flags.push('invalid_cpt')
  return flags
}

// ── Layer 2: Payer policy rules (DB read-only, no AI) ────────────────────────

async function layer2(claim) {
  // payer_policies only covers E&M; non-E&M codes → no_policy_data
  if (!claim.cpt_code) return []  // already caught by layer1

  let policy = null
  try {
    const res = await pool.query(
      `SELECT coverage_criteria, documentation_required
         FROM payer_policies
        WHERE payer_code = $1 AND cpt_code = $2
        LIMIT 1`,
      ['MEDICARE', claim.cpt_code]
    )
    policy = res.rows[0] || null
  } catch (err) {
    // DB unavailable — skip layer 2
    return ['db_error']
  }

  if (!policy) return ['no_policy_data']

  const flags = []
  const coverage = (policy.coverage_criteria || '').toLowerCase()
  if (coverage.includes('not covered') || coverage.includes('excluded')) {
    flags.push('not_covered')
  }

  // Basic medical necessity: at least one ICD-10 must be present
  const allDiags = [claim.icd10_primary, ...claim.icd10_codes].filter(Boolean)
  if (!allDiags.length) flags.push('no_supporting_diagnosis')

  return flags
}

// ── CSV reader ────────────────────────────────────────────────────────────────

async function readSample() {
  return new Promise((resolve, reject) => {
    const rows   = []
    const rl     = readline.createInterface({ input: fs.createReadStream(CSV_PATH), crlfDelay: Infinity })
    let headers  = null
    let linesSeen = 0

    rl.on('line', (line) => {
      if (!headers) {
        headers = line.split('|')
        return
      }
      if (linesSeen >= SAMPLE_SIZE) {
        rl.close()
        return
      }
      const values = line.split('|')
      const row    = {}
      headers.forEach((h, i) => { row[h] = values[i] || '' })
      rows.push(row)
      linesSeen++
    })

    rl.on('close', () => resolve(rows))
    rl.on('error', reject)
  })
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scorecard(results) {
  const forOutcome = (o) => results.filter(r => r.cms_outcome === o)
  const denied = forOutcome('denied')
  const paid   = forOutcome('paid')

  const TP = results.filter(r => r.agent_decision === 'flag' && r.cms_outcome === 'denied').length
  const FN = results.filter(r => r.agent_decision === 'pass' && r.cms_outcome === 'denied').length
  const FP = results.filter(r => r.agent_decision === 'flag' && r.cms_outcome === 'paid').length
  const TN = results.filter(r => r.agent_decision === 'pass' && r.cms_outcome === 'paid').length

  const catchRate = denied.length ? ((TP / denied.length) * 100).toFixed(1) : 'N/A'
  const fpRate    = paid.length   ? ((FP / paid.length)   * 100).toFixed(1) : 'N/A'

  const l1Catches = results.filter(r => r.layer_caught === 1 && r.cms_outcome === 'denied').length
  const l2Catches = results.filter(r => r.layer_caught === 2 && r.cms_outcome === 'denied').length
  const missed    = FN

  const l1Pct = denied.length ? ((l1Catches / denied.length) * 100).toFixed(1) : '0.0'
  const l2Pct = denied.length ? ((l2Catches / denied.length) * 100).toFixed(1) : '0.0'
  const missPct = denied.length ? ((missed / denied.length) * 100).toFixed(1) : '0.0'

  // Missed denial patterns (FN) grouped by denial_code
  const missedByCode = {}
  results.filter(r => r.agent_decision === 'pass' && r.cms_outcome === 'denied').forEach(r => {
    const key = r.denial_code || 'unknown'
    missedByCode[key] = (missedByCode[key] || 0) + 1
  })
  const topMissed = Object.entries(missedByCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  // FP triggers (first flag on each FP claim)
  const fpTriggers = {}
  results.filter(r => r.agent_decision === 'flag' && r.cms_outcome === 'paid').forEach(r => {
    const key = r.flags_raised[0] || 'unknown'
    fpTriggers[key] = (fpTriggers[key] || 0) + 1
  })
  const topFP = Object.entries(fpTriggers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  const divider = '═'.repeat(48)
  const lines = [
    divider,
    'VALIDATION RESULTS — 100 CMS CLAIMS',
    divider,
    `Total claims:        ${results.length}`,
    `Denied in CMS data:  ${denied.length}`,
    `Paid in CMS data:    ${paid.length}`,
    `Other outcome:       ${results.length - denied.length - paid.length}`,
    '',
    `True positives:      ${TP}   (agent flagged, CMS denied)`,
    `False negatives:     ${FN}   (agent passed, CMS denied — misses)`,
    `False positives:     ${FP}   (agent flagged, CMS paid)`,
    `True negatives:      ${TN}   (agent passed, CMS paid)`,
    '',
    `Agent catch rate:    ${catchRate}% (of denials caught)`,
    `False positive rate: ${fpRate}% (of paid claims flagged)`,
    '',
    'By layer:',
    `  Layer 1 catches:   ${l1Catches} / ${denied.length} (${l1Pct}%)`,
    `  Layer 2 catches:   ${l2Catches} / ${denied.length} (${l2Pct}%)`,
    `  Missed entirely:   ${missed} / ${denied.length} (${missPct}%)`,
    '',
    'Most common missed denial patterns (denial_code):',
  ]

  topMissed.forEach(([code, count], i) => {
    lines.push(`  ${i + 1}. denial_code=${code} — ${count} claim${count > 1 ? 's' : ''}`)
  })
  if (!topMissed.length) lines.push('  (none — all denials caught)')

  lines.push('')
  lines.push('Most common false positive triggers:')
  topFP.forEach(([rule, count], i) => {
    lines.push(`  ${i + 1}. ${rule} — ${count} claim${count > 1 ? 's' : ''}`)
  })
  if (!topFP.length) lines.push('  (none)')

  lines.push(divider)
  return lines.join('\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[VALIDATE] Reading carrier.csv sample...')
  const rawRows = await readSample()
  console.log(`[VALIDATE] Loaded ${rawRows.length} rows`)

  const results = []

  for (const raw of rawRows) {
    const claim = mapCMSClaim(raw)

    // Layer 1
    const l1flags = layer1(claim)
    let flags       = l1flags.slice()
    let layer_caught = null

    if (l1flags.length) {
      layer_caught = 1
    } else {
      // Layer 2 only if layer1 passes
      const l2flags = await layer2(claim)
      if (l2flags.length) {
        flags        = l2flags
        layer_caught = 2
      }
    }

    const agent_decision = flags.length ? 'flag' : 'pass'

    results.push({
      claim_id:         claim.claim_id,
      cpt_code:         claim.cpt_code,
      icd10_primary:    claim.icd10_primary,
      place_of_service: claim.place_of_service,
      billed_amount:    claim.billed_amount,
      paid_amount:      claim.paid_amount,
      provider_specialty: claim.provider_specialty,
      denial_code:      claim.denial_code,
      cms_outcome:      claim.cms_outcome,
      agent_decision,
      flags_raised:     flags,
      layer_caught,
    })
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2))
  console.log(`[VALIDATE] Results saved → ${OUTPUT_PATH}`)

  console.log('\n' + scorecard(results))
  await pool.end()
}

main().catch(err => {
  console.error('[VALIDATE] Fatal:', err.message)
  pool.end()
  process.exit(1)
})
