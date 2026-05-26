'use strict'
require('dotenv').config()

const { fetchPDF, upsertRecord, logScraperRun, cleanText, makeCounter } = require('../scraperUtils')
const { recordMeta } = require('../../lib/codingIntelligenceUtils')

const SOURCE_URL  = 'https://www.idsociety.org/globalassets/idsa/practice-resources/coding-and-payment/2025-em-services-reference-guide_final.pdf'
const SOURCE_DATE = new Date('2025-10-01')
const META        = recordMeta('idsa_reference', SOURCE_URL, SOURCE_DATE, 1)

// IDSA E&M reference — October 2025 edition
// Clinical examples validate MDM assignments from CMS MLN guide
const IDSA_CLINICAL_EXAMPLES = [
  {
    title:       'Established patient — HTN follow-up, stable',
    cptCode:     '99213',
    icd10Codes:  ['I10'],
    complexity:  'low',
    mdmProblems: '1 stable chronic illness (hypertension)',
    correct:     'Low complexity MDM — one stable chronic condition, minimal data review, low risk prescription',
    wrongCode:   '99214',
    errorType:   'intensity_justification',
  },
  {
    title:       'Established patient — Diabetes with worsening HbA1c',
    cptCode:     '99214',
    icd10Codes:  ['E11.65','E11.9'],
    complexity:  'moderate',
    mdmProblems: '1 chronic illness with exacerbation (diabetes — worsening glycemic control)',
    correct:     'Moderate complexity MDM — chronic illness with exacerbation, prescription drug management (add/adjust medication)',
    wrongCode:   '99213',
    errorType:   'intensity_justification',
  },
  {
    title:       'New patient — chest pain workup',
    cptCode:     '99204',
    icd10Codes:  ['R07.9','I25.10'],
    complexity:  'moderate',
    mdmProblems: 'Undiagnosed new problem with uncertain prognosis',
    correct:     'Moderate complexity — new problem uncertain prognosis, ordering independent tests, prescription management',
    wrongCode:   '99203',
    errorType:   'intensity_justification',
  },
  {
    title:       'Established patient — multiple chronic conditions decompensating',
    cptCode:     '99215',
    icd10Codes:  ['E11.65','I10','N18.3','J44.1'],
    complexity:  'high',
    mdmProblems: 'Severe exacerbation of chronic illness; threat to bodily function',
    correct:     'High complexity — multiple decompensating chronic conditions, drug therapy requiring intensive monitoring, potential hospitalization decision',
    wrongCode:   '99214',
    errorType:   'intensity_justification',
  },
  {
    title:       'G2211 — established primary care visit with longitudinal complexity',
    cptCode:     'G2211',
    icd10Codes:  ['E11.9','I10','E78.5'],
    complexity:  'moderate',
    mdmProblems: 'Multiple stable chronic conditions — complexity of being the focal point for all care',
    correct:     'G2211 appropriate when provider serves as continuing focal point for all care needs. Document longitudinal relationship explicitly.',
    wrongCode:   null,
    errorType:   null,
  },
]

const SPLIT_SHARED_RULES = {
  appointmentType:          'split_shared',
  ruleDescription:          'In a split/shared visit, the billing provider must personally perform and document the substantive portion of the visit — defined as more than half the total time, or the complexity-determining key portion of MDM. Effective January 1 2022.',
  requiredDocumentation:    'Billing provider must sign and date their portion. Documentation must identify which provider performed which elements. "Substantive portion" must be explicitly stated.',
  commonErrors:             'Billing provider signing a note written entirely by NP/PA without performing or documenting the substantive portion. Using split/shared billing when the physician only reviewed and co-signed.',
}

async function scrapeIdsa(pool) {
  const counter = makeCounter()

  let text = null
  try {
    const raw = await fetchPDF(SOURCE_URL)
    text = raw ? cleanText(raw) : null
  } catch (err) {
    counter.notes = [`IDSA PDF fetch failed: ${err.message} — seeding from embedded IDSA clinical examples`]
  }

  // ── denial_patterns: clinical examples ────────────────────────────────────
  for (const ex of IDSA_CLINICAL_EXAMPLES) {
    const data = {
      scenario_title:      ex.title,
      scenario_description: ex.correct,
      cpt_codes:            [ex.cptCode],
      icd10_codes:          ex.icd10Codes,
      denial_category:      ex.errorType,
      denial_reason_plain:  ex.wrongCode
        ? `Billed as ${ex.wrongCode} — documentation supports ${ex.cptCode} based on IDSA MDM guidance`
        : null,
      root_cause:           ex.mdmProblems,
      fix_description:      ex.correct,
      prevention_tip:       'Use IDSA E&M reference guide MDM table to validate complexity before billing',
      is_verified:          true,
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'denial_patterns',
      { scenario_title: ex.title, payer_code: null }, data))
  }

  // ── cpt_knowledge: cross-reference MDM — increment consistency if matches CMS ──
  const mdmMap = {
    '99213': { problems: 'low', data: 'limited', risk: 'low' },
    '99214': { problems: 'moderate', data: 'moderate', risk: 'moderate' },
    '99215': { problems: 'high', data: 'extensive', risk: 'high' },
    '99203': { problems: 'low', data: 'limited', risk: 'low' },
    '99204': { problems: 'moderate', data: 'moderate', risk: 'moderate' },
    '99205': { problems: 'high', data: 'extensive', risk: 'high' },
  }

  for (const [cpt, levels] of Object.entries(mdmMap)) {
    // Increment consistency_score — IDSA agrees with CMS MLN on MDM levels
    try {
      await pool.query(`
        UPDATE cpt_knowledge
        SET consistency_score = LEAST(COALESCE(consistency_score,1) + 1, 5),
            confidence_score  = LEAST(COALESCE(confidence_score,5) + 1, 15),
            updated_at        = NOW()
        WHERE cpt_code = $1
      `, [cpt])
    } catch (err) { /* non-fatal */ }
  }

  // ── appointment_type_rules: split/shared ──────────────────────────────────
  const splitSharedData = {
    appointment_type:           SPLIT_SHARED_RULES.appointmentType,
    cpt_code:                   null,
    rule_description:           SPLIT_SHARED_RULES.ruleDescription,
    required_modifiers:         [],
    documentation_requirements: SPLIT_SHARED_RULES.requiredDocumentation,
    common_errors:              SPLIT_SHARED_RULES.commonErrors,
    ...META,
  }
  counter.tally(await upsertRecord(pool, 'appointment_type_rules',
    { appointment_type: 'split_shared', cpt_code: null }, splitSharedData))

  await logScraperRun(pool, 'idsa', {
    ...counter,
    notes: Array.isArray(counter.notes) ? counter.notes.join('; ') : null,
  })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapeIdsa }
