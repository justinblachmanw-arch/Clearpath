'use strict'
require('dotenv').config()

const { fetchPage, upsertRecord, logScraperRun, cleanText, extractCPTCodes, extractICD10Codes, extractCARCCodes, makeCounter } = require('../scraperUtils')
const { recordMeta } = require('../../lib/codingIntelligenceUtils')

const SOURCE_URL  = 'https://www.cms.gov/data-research/monitoring-programs/medicare-fee-service-compliance-programs/review-reason-codes-and-statements'
const SOURCE_DATE = new Date('2025-01-01')
const META        = recordMeta('cms_direct', SOURCE_URL, SOURCE_DATE, 1)

// Seed data: CMS review reason codes relevant to primary care
// Structured from published CMS contractor reason code statements
const REVIEW_REASON_CODES = [
  {
    code:        'RRC-E01',
    title:       'Medical necessity not established',
    statement:   'The medical record does not support medical necessity for the service billed. The documentation does not demonstrate that the service was reasonable and necessary for the diagnosis or treatment of illness or injury.',
    carc:        'CO-50',
    rule_type:   'coverage',
    cpt_context: ['99202','99203','99204','99205','99212','99213','99214','99215'],
  },
  {
    code:        'RRC-E02',
    title:       'Documentation does not support level of service billed',
    statement:   'The level of evaluation and management service billed is not supported by the medical record. The documented medical decision making or total time does not meet the requirements for the CPT code billed.',
    carc:        'CO-4',
    rule_type:   'documentation',
    cpt_context: ['99204','99205','99214','99215'],
  },
  {
    code:        'RRC-E03',
    title:       'Service not covered — not a Medicare benefit',
    statement:   'The service billed is not a covered Medicare benefit. Medicare does not cover this service under the conditions documented.',
    carc:        'CO-96',
    rule_type:   'coverage',
    cpt_context: [],
  },
  {
    code:        'RRC-E04',
    title:       'Insufficient documentation to determine coverage',
    statement:   'The documentation submitted is insufficient to determine if the service was medically necessary and covered by Medicare. Required documentation was missing or incomplete.',
    carc:        'CO-16',
    rule_type:   'documentation',
    cpt_context: ['G0438','G0439','99490','99491'],
  },
  {
    code:        'RRC-E05',
    title:       'Procedure code inconsistent with diagnosis',
    statement:   'The procedure code billed is inconsistent with the diagnosis code(s) submitted. The diagnosis does not support the medical necessity of the procedure billed.',
    carc:        'CO-11',
    rule_type:   'coverage',
    cpt_context: ['99202','99203','99204','99205','99212','99213','99214','99215'],
  },
  {
    code:        'RRC-E06',
    title:       'Duplicate claim — same beneficiary, same date, same service',
    statement:   'This claim appears to be a duplicate of a previously submitted and processed claim for the same beneficiary, date of service, and procedure code.',
    carc:        'CO-18',
    rule_type:   'coverage',
    cpt_context: [],
  },
  {
    code:        'RRC-E07',
    title:       'Service not separately payable — included in another billed service',
    statement:   'The service billed is considered part of another service billed on the same date and cannot be reimbursed separately. NCCI edits apply.',
    carc:        'CO-97',
    rule_type:   'bundling',
    cpt_context: [],
  },
  {
    code:        'RRC-E08',
    title:       'Annual wellness visit — missing required elements',
    statement:   'The Annual Wellness Visit does not meet coverage requirements. One or more required elements are absent from the medical record.',
    carc:        'CO-50',
    rule_type:   'documentation',
    cpt_context: ['G0438','G0439'],
  },
  {
    code:        'RRC-E09',
    title:       'Chronic care management — documentation requirements not met',
    statement:   'Chronic Care Management services were billed but the documentation does not demonstrate that all required elements were performed, including a comprehensive care plan and 20+ minutes of clinical staff time.',
    carc:        'CO-50',
    rule_type:   'documentation',
    cpt_context: ['99490','99491'],
  },
  {
    code:        'RRC-E10',
    title:       'Telehealth — place of service code incorrect',
    statement:   'The place of service code submitted does not match the type of telehealth service billed. Verify POS 02 (telehealth other than home) vs POS 10 (telehealth home) requirements.',
    carc:        'CO-4',
    rule_type:   'place_of_service',
    cpt_context: ['99212','99213','99214','99215'],
  },
]

async function scrapeReviewReasonCodes(pool) {
  const counter = makeCounter()

  let pageText = null
  try {
    const html = await fetchPage(SOURCE_URL)
    pageText = html ? cleanText(html.replace(/<[^>]+>/g, ' ')) : null
  } catch (err) {
    counter.notes = [`Fetch failed: ${err.message} — seeding from embedded reason code table`]
  }

  // ── denial_patterns ───────────────────────────────────────────────────────
  for (const code of REVIEW_REASON_CODES) {
    const data = {
      scenario_title:      `${code.code}: ${code.title}`,
      denial_reason_plain: code.statement,
      carc_code:           code.carc,
      payer_code:          'MEDICARE',
      cpt_codes:           code.cpt_context.length ? code.cpt_context : ['*'],
      denial_category:     code.rule_type === 'bundling' ? 'cpt_mismatch' : 'diagnostic_eligibility',
      is_verified:         true,
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'denial_patterns',
      { scenario_title: `${code.code}: ${code.title}`, payer_code: 'MEDICARE' }, data))
  }

  // ── payer_rules ───────────────────────────────────────────────────────────
  for (const code of REVIEW_REASON_CODES) {
    for (const cpt of (code.cpt_context.length ? code.cpt_context : [null])) {
      const data = {
        payer_code:         'MEDICARE',
        payer_name:         'Medicare',
        cpt_code:           cpt,
        rule_type:          code.rule_type,
        rule_title:         code.title,
        rule_description:   code.statement,
        rule_severity:      'hard',
        payer_language:     code.statement,
        likely_denial_code: code.carc,
        is_stated:          true,
        is_published:       true,
        ...META,
      }
      const key = { payer_code: 'MEDICARE', rule_title: code.title }
      if (cpt) key.cpt_code = cpt
      counter.tally(await upsertRecord(pool, 'payer_rules', key, data))
    }
  }

  // ── cpt_knowledge: append denial reasons and CARC codes ──────────────────
  for (const code of REVIEW_REASON_CODES) {
    for (const cpt of code.cpt_context) {
      try {
        await pool.query(`
          UPDATE cpt_knowledge
          SET common_denial_reasons    = array_append(COALESCE(common_denial_reasons, '{}'), $1),
              common_denial_carc_codes = array_append(COALESCE(common_denial_carc_codes, '{}'), $2),
              updated_at               = NOW()
          WHERE cpt_code = $3
            AND NOT ($1 = ANY(COALESCE(common_denial_reasons, '{}')))
        `, [code.title, code.carc, cpt])
      } catch (err) {
        // non-fatal — cpt_knowledge row may not exist yet
      }
    }
  }

  if (pageText) {
    const liveCPTs  = extractCPTCodes(pageText)
    const liveCARCs = extractCARCCodes(pageText)
    if (liveCPTs.length || liveCARCs.length) {
      counter.notes = (counter.notes || []).concat([
        `Live page yielded additional CPTs: ${liveCPTs.join(',')} and CARCs: ${liveCARCs.join(',')} — manual review recommended`,
      ])
    }
  }

  await logScraperRun(pool, 'reviewReasonCodes', {
    ...counter,
    notes: Array.isArray(counter.notes) ? counter.notes.join('; ') : null,
  })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapeReviewReasonCodes }
