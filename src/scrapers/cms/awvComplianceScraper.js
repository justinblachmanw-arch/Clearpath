'use strict'
require('dotenv').config()

const { fetchPage, upsertRecord, logScraperRun, cleanText, makeCounter } = require('../scraperUtils')
const { recordMeta } = require('../../lib/codingIntelligenceUtils')

const SOURCE_URL  = 'https://www.cms.gov/training-education/medicare-learning-networkr-mln/compliance/medicare-provider-compliance-tips/annual-wellness-visits'
const SOURCE_DATE = new Date('2024-01-01')
const META        = recordMeta('cms_direct', SOURCE_URL, SOURCE_DATE, 1)

const AWV_CODES = ['G0438', 'G0439', 'G0402']

// Published CMS denial patterns for AWV — highest improper payment rate in primary care
const AWV_DENIAL_PATTERNS = [
  {
    title:       'Initial AWV billed as subsequent (G0438 vs G0439)',
    description: 'Provider billed G0439 (subsequent AWV) for a patient who had not received a previous AWV — G0438 (initial) was required',
    root_cause:  'System does not track prior AWV history; staff billing G0439 by default',
    fix:         'Verify Medicare claims history before billing. G0438 = first AWV ever. G0439 = every AWV after the first.',
    carc:        'CO-96',
  },
  {
    title:       'Missing or incomplete Health Risk Assessment',
    description: 'AWV billed without a documented Health Risk Assessment (HRA) meeting CMS requirements',
    root_cause:  'HRA not performed or not documented in the medical record',
    fix:         'Complete and document all required HRA elements: health history, mental health screening, ADL assessment, review of clinical risk factors',
    carc:        'CO-50',
  },
  {
    title:       'AWV billed within 12-month frequency limit',
    description: 'Subsequent AWV (G0439) billed less than 12 full months after previous AWV',
    root_cause:  'Scheduling system does not enforce 12-month minimum between AWVs',
    fix:         'Enforce minimum 12 full calendar months between AWV dates. Bill on or after the same date one year later.',
    carc:        'CO-119',
  },
  {
    title:       'Initial AWV billed within 12 months of Welcome to Medicare exam (G0402)',
    description: 'G0438 billed within 12 months of the Welcome to Medicare Preventive Visit',
    root_cause:  'Staff unaware of 12-month restriction between G0402 and G0438',
    fix:         'Do not bill G0438 until 12 full months after G0402',
    carc:        'CO-119',
  },
  {
    title:       'Missing cognitive assessment documentation',
    description: 'AWV performed without required cognitive impairment detection assessment documentation',
    root_cause:  'Cognitive assessment not performed or results not documented',
    fix:         'Document cognitive impairment detection assessment using validated tool (e.g., Mini-Cog, MMSE). Results must be in the medical record.',
    carc:        'CO-50',
  },
  {
    title:       'AWV billed with overlapping preventive services by same provider',
    description: 'G0438/G0439 billed on same day as other wellness/preventive services that include duplicative elements',
    root_cause:  'Staff billing both AWV and IPPE or other comprehensive wellness services on same day',
    fix:         'Do not bill G0402 and G0438 on the same date of service. AWV elements are inclusive.',
    carc:        'CO-97',
  },
]

async function scrapeAwvCompliance(pool) {
  const counter = makeCounter()

  let text = null
  try {
    const html = await fetchPage(SOURCE_URL)
    text = html ? cleanText(html.replace(/<[^>]+>/g, ' ')) : null
  } catch (err) {
    counter.notes = counter.notes || []
    counter.notes.push(`Fetch failed: ${err.message}`)
  }

  // ── cpt_knowledge: AWV codes ──────────────────────────────────────────────
  const awvBase = {
    required_documentation: [
      'Health Risk Assessment (HRA) — must meet CMS minimum elements',
      'Review of medical and family history',
      'List of current providers and suppliers',
      'Measurements: height, weight, BMI, blood pressure',
      'Cognitive impairment detection assessment',
      'Review of potential risk for depression and other mood disorders',
      'Review of functional ability and safety',
      'Written screening schedule for next 5-10 years',
      'List of risk factors and conditions for which secondary interventions are recommended',
      'Patient goals and a health advice for the patient',
    ],
    audit_risk_level: 'very_high',
    audit_risk_notes: '24.5% improper payment rate per 2024 CERT report — highest improper payment rate in primary care. OIG active monitoring.',
    common_denial_reasons: AWV_DENIAL_PATTERNS.map(p => p.title),
    ...META,
  }

  for (const code of AWV_CODES) {
    counter.tally(await upsertRecord(pool, 'cpt_knowledge', { cpt_code: code }, { cpt_code: code, ...awvBase }))
  }

  // ── denial_patterns: one per AWV denial reason ────────────────────────────
  for (const pattern of AWV_DENIAL_PATTERNS) {
    for (const cptCode of ['G0438', 'G0439']) {
      const data = {
        scenario_title:      pattern.title,
        scenario_description: pattern.description,
        cpt_codes:           [cptCode],
        payer_code:          'MEDICARE',
        denial_reason_plain: pattern.description,
        root_cause:          pattern.root_cause,
        fix_description:     pattern.fix,
        carc_code:           pattern.carc,
        denial_category:     'diagnostic_eligibility',
        appointment_type:    'annual_wellness',
        is_verified:         true,
        ...META,
      }
      counter.tally(await upsertRecord(pool, 'denial_patterns',
        { scenario_title: pattern.title, payer_code: 'MEDICARE' }, data))
    }
  }

  // ── payer_rules: AWV documentation requirements ───────────────────────────
  for (const cptCode of ['G0438', 'G0439']) {
    const ruleData = {
      payer_code:       'MEDICARE',
      payer_name:       'Medicare',
      cpt_code:         cptCode,
      rule_type:        'documentation',
      rule_title:       `AWV ${cptCode} complete documentation requirement`,
      rule_description: 'All AWV elements must be performed and documented. Missing any single required element results in improper payment.',
      rule_severity:    'hard',
      likely_denial_code: 'CO-50',
      denial_description: 'Service does not meet clinical coverage criteria — AWV elements incomplete',
      fix_action:       'Use AWV documentation checklist before billing. Verify all required elements documented.',
      is_stated:        true,
      is_published:     true,
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'payer_rules',
      { payer_code: 'MEDICARE', cpt_code: cptCode, rule_type: 'documentation' }, ruleData))
  }

  if (!text) counter.notes = (counter.notes || []).concat(['CMS page unavailable — seeded from embedded denial patterns. Re-run when accessible.'])

  await logScraperRun(pool, 'awvCompliance', {
    ...counter,
    notes: Array.isArray(counter.notes) ? counter.notes.join('; ') : null,
  })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapeAwvCompliance }
