'use strict'
require('dotenv').config()

const { fetchPDF, upsertRecord, logScraperRun, cleanText, detectPolicyChange, makeCounter } = require('../scraperUtils')
const { recordMeta, isTrumpEraChange } = require('../../lib/codingIntelligenceUtils')

const SOURCE_URL  = 'https://www.cms.gov/outreach-and-education/medicare-learning-network-mln/mlnproducts/downloads/eval-mgmt-serv-guide-icn006764.pdf'
const SOURCE_DATE = new Date('2026-03-01')
const META        = recordMeta('cms_direct', SOURCE_URL, SOURCE_DATE, 1)

// MDM complexity table — 2021 AMA/CMS E&M guidelines still in effect 2026
const MDM_TABLE = {
  99202: { level: 2, complexity: 'straightforward', minTime: 15, problems: 'Self-limited or minor problem; 1 stable chronic illness', data: 'Minimal or none', risk: 'Minimal risk of complications' },
  99203: { level: 3, complexity: 'low',             minTime: 30, problems: 'At least 2 self-limited/minor problems; 1 stable chronic illness', data: 'Limited: review prior external notes or tests', risk: 'Low risk — OTC drug management' },
  99204: { level: 4, complexity: 'moderate',        minTime: 45, problems: 'Undiagnosed new problem with uncertain prognosis; 1 or more chronic illness with exacerbation', data: 'Moderate: review external records; order tests; independent historian', risk: 'Moderate risk — prescription drug management' },
  99205: { level: 5, complexity: 'high',            minTime: 60, problems: 'Severe exacerbation of chronic illness; threat to life or bodily function', data: 'Extensive: independent interpretation of tests; discussion with external physician', risk: 'High risk — drug therapy requiring intensive monitoring' },
  99211: { level: 1, complexity: null,              minTime: 5,  problems: 'May not require presence of physician/NPP', data: null, risk: null },
  99212: { level: 2, complexity: 'straightforward', minTime: 10, problems: 'Self-limited or minor problem; 1 stable chronic illness', data: 'Minimal or none', risk: 'Minimal risk of complications' },
  99213: { level: 3, complexity: 'low',             minTime: 20, problems: '2 or more self-limited/minor problems; 1 stable chronic illness', data: 'Limited: review prior external notes or tests', risk: 'Low risk — OTC drug management' },
  99214: { level: 4, complexity: 'moderate',        minTime: 30, problems: 'Undiagnosed new problem; 1+ chronic illness with exacerbation; 2+ stable chronic illnesses', data: 'Moderate: review external records; order/review tests', risk: 'Moderate risk — prescription drug management' },
  99215: { level: 5, complexity: 'high',            minTime: 40, problems: 'Severe exacerbation; threat to life or bodily function', data: 'Extensive: independent interpretation; external physician discussion', risk: 'High risk — drug therapy requiring intensive monitoring; hospitalization decision' },
}

const NEW_PT_CODES = ['99202','99203','99204','99205']
const EST_PT_CODES = ['99211','99212','99213','99214','99215']

const COMMON_DENIAL_REASONS = [
  'Documentation does not support MDM level billed',
  'Time-based billing not supported by total time documentation',
  'Missing or inadequate history, exam, or medical decision making',
  'Incident-to billing requirements not met',
  'Upcoding — level billed exceeds complexity documented',
]

const THINGS_TO_AVOID = [
  'Billing by key components (history/exam/MDM) — discontinued 2021',
  'Selecting E&M level based on number of diagnoses alone',
  'Omitting total time when using time-based billing',
  'Failing to document independent interpretation vs review of tests',
  'Copying/pasting prior notes without documenting current encounter',
]

async function scrapeMlnEmGuide(pool) {
  const counter = makeCounter()

  let rawText = null
  try {
    rawText = await fetchPDF(SOURCE_URL)
  } catch (err) {
    counter.errors++
    counter.notes.push(`PDF fetch failed: ${err.message}`)
  }

  const text = rawText ? cleanText(rawText) : null
  if (!text) {
    counter.notes.push('PDF unavailable — seeding from embedded MDM table. Run again when PDF accessible.')
  }

  // ── cpt_knowledge: 99202-99215 ────────────────────────────────────────────
  for (const [cpt, mdm] of Object.entries(MDM_TABLE)) {
    const isNew = NEW_PT_CODES.includes(cpt)
    const data = {
      cpt_code:               cpt,
      category:               isNew ? 'em_new' : 'em_established',
      em_level:               mdm.level,
      em_complexity:          mdm.complexity,
      em_min_time_minutes:    mdm.minTime,
      em_mdm_problems:        mdm.problems,
      em_mdm_data:            mdm.data,
      em_mdm_risk:            mdm.risk,
      em_key_components:      'MDM or total time. Key components (history/exam) no longer used as of 2021.',
      required_documentation: ['Chief complaint or reason for visit', 'MDM elements or total time', 'Assessment and plan'],
      common_denial_reasons:  COMMON_DENIAL_REASONS,
      things_to_avoid:        THINGS_TO_AVOID,
      telehealth_allowed:     true,
      last_cms_change_date:   '2026-03-01',
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'cpt_knowledge', { cpt_code: cpt }, data))
  }

  // ── cpt_knowledge: G2211 ──────────────────────────────────────────────────
  const g2211Data = {
    cpt_code:               'G2211',
    category:               'add_on',
    short_description:      'Visit complexity inherent to primary care',
    full_description:       'Visit complexity inherent to evaluation and management associated with medical care services that serve as the continuing focal point for all needed health care services and/or with medical care services that are part of ongoing care related to a patient\'s single, serious, or complex chronic condition',
    add_on_to:              ['99202','99203','99204','99205','99211','99212','99213','99214','99215'],
    required_documentation: [
      'Ongoing relationship with patient as primary care physician',
      'Documentation of complexity inherent to the visit',
      'Cannot be reported when modifier 25 is appended EXCEPT with CMS preventive services',
    ],
    cannot_bill_same_day:   ['modifier_25_except_preventive'],
    modifier_notes:         'G2211 cannot be billed with modifier 25 except when the E&M is provided same day as a preventive service on the CMS preventive services list',
    is_new_2025:            true,
    last_cms_change_date:   '2025-01-01',
    last_cms_change_description: 'G2211 payment restriction with modifier 25 lifted for preventive services effective January 1 2025',
    audit_risk_level:       'high',
    audit_risk_notes:       'New code — high scrutiny period. CMS actively reviewing G2211 claims for appropriate longitudinal relationship documentation.',
    things_to_avoid:        [
      'Billing without documented longitudinal relationship',
      'Appending modifier 25 unless same-day preventive service from CMS list',
      'Billing with modifier 57',
    ],
    ...META,
  }
  counter.tally(await upsertRecord(pool, 'cpt_knowledge', { cpt_code: 'G2211' }, g2211Data))

  // ── modifier_rules: Modifier 25 ───────────────────────────────────────────
  const mod25Data = {
    modifier_code:          '25',
    modifier_name:          'Significant, Separately Identifiable Evaluation and Management Service',
    description:            'Significant, separately identifiable evaluation and management service by the same physician or other qualified health care professional on the same day of the procedure or other service',
    use_case:               'Append to E&M code when a significant, separately identifiable E&M is performed same day as a procedure or preventive visit',
    required_documentation: 'The medical record must clearly show the E&M was separate and distinct from the procedure performed on the same day — different chief complaint, separate clinical assessment, separate plan',
    when_required:          'Required when billing E&M same day as a procedure to distinguish the E&M from pre/post-procedure work',
    when_optional:          'Not used for minor procedures; required only when the E&M is truly separate and identifiable',
    common_cpt_codes:       ['99213','99214','99215','99202','99203','99204'],
    prevents_denial_codes:  ['CO-97','CO-B15'],
    common_mistakes:        'Appending modifier 25 routinely without documentation that the E&M was truly separate. Auditors look for distinct chief complaint, distinct assessment, and distinct plan.',
    overuse_risk:           'Systematic use of modifier 25 without supporting documentation triggers ADR requests and OIG audits',
    underuse_risk:          'Failure to append modifier 25 on legitimate same-day E&M + procedure results in CO-97 denial',
    medicare_guidance:      'CMS: The medical record must clearly document the significant, separately identifiable E&M. The E&M must stand alone — it cannot be the pre/post-procedure evaluation.',
    ...META,
  }
  counter.tally(await upsertRecord(pool, 'modifier_rules', { modifier_code: '25' }, mod25Data))

  // ── policy_change_log: 2026 guide update ─────────────────────────────────
  if (text) {
    const { isChange, effectiveDate } = detectPolicyChange(text)
    if (isChange && effectiveDate) {
      const changeData = {
        change_date:      new Date().toISOString().split('T')[0],
        payer_code:       null,
        cpt_code:         null,
        change_type:      'documentation_change',
        change_title:     'CMS MLN E&M Guide ICN006764 updated March 2026',
        change_description: 'CMS updated the Medicare Learning Network E&M services guide. Review for any changes to MDM criteria or documentation requirements.',
        impact_level:     'medium',
        effective_date:   effectiveDate.toISOString().split('T')[0],
        trump_era_change: isTrumpEraChange(effectiveDate),
        administration:   isTrumpEraChange(effectiveDate) ? 'trump_2025' : null,
        cms_reference:    'ICN006764',
        source_url:       SOURCE_URL,
        verified:         true,
      }
      counter.tally(await upsertRecord(pool, 'policy_change_log', { cms_reference: 'ICN006764' }, changeData))
    }
  }

  await logScraperRun(pool, 'mlnEmGuide', { ...counter, notes: counter.notes.join('; ') || null })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapeMlnEmGuide }
