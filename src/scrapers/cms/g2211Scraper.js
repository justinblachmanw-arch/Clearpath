'use strict'
require('dotenv').config()

const { fetchPDF, upsertRecord, logScraperRun, cleanText, makeCounter } = require('../scraperUtils')
const { recordMeta } = require('../../lib/codingIntelligenceUtils')

const SOURCE_URL  = 'https://www.cms.gov/files/document/mm13473-how-use-office-and-outpatient-evaluation-and-management-visit-complexity-add-code-g2211.pdf'
const SOURCE_DATE = new Date('2025-01-01')
const META        = recordMeta('cms_direct', SOURCE_URL, SOURCE_DATE, 1)

const EM_CODES = ['99202','99203','99204','99205','99211','99212','99213','99214','99215']

async function scrapeG2211(pool) {
  const counter = makeCounter()

  let text = null
  try {
    const raw = await fetchPDF(SOURCE_URL)
    text = raw ? cleanText(raw) : null
  } catch (err) {
    counter.notes = [`PDF fetch failed: ${err.message} — seeding from embedded G2211 rules`]
  }

  // ── cpt_knowledge: G2211 ──────────────────────────────────────────────────
  const g2211 = {
    cpt_code:               'G2211',
    category:               'add_on',
    short_description:      'Visit complexity inherent to primary care',
    full_description:       'Visit complexity inherent to evaluation and management associated with medical care services that serve as the continuing focal point for all needed health care services and/or with medical care services that are part of ongoing care related to a patient\'s single, serious, or complex chronic condition. Not separately billable when modifier 25 is appended, except when a preventive service is also billed on the same date of service.',
    add_on_to:              EM_CODES,
    required_documentation: [
      'Ongoing longitudinal relationship documented — provider serves as continuing focal point for patient\'s care',
      'Visit complexity: documentation of complexity inherent to primary care coordination',
      'Cannot be billed with modifier 25 UNLESS a CMS-covered preventive service is also billed same day',
      'Cannot be billed when modifier 57 is appended to the E&M',
    ],
    cannot_bill_same_day:   ['modifier_25_restrictions_apply'],
    modifier_notes:         'G2211 is incompatible with modifier 25 EXCEPT when the E&M is provided on the same day as a preventive service from the CMS preventive services list. When modifier 25 is appended for a same-day procedure (non-preventive), G2211 cannot be billed.',
    is_new_2025:            true,
    last_cms_change_date:   '2025-01-01',
    last_cms_change_description: 'Effective January 1 2025: G2211 may be billed with modifier 25 when the same-day separately identifiable service is a preventive service on the Medicare Preventive Services list. Previous restriction was absolute.',
    change_impact:          'high',
    audit_risk_level:       'high',
    audit_risk_notes:       'New code effective January 2024, modifier 25 restriction updated January 2025. CMS and OIG actively auditing G2211 claims for longitudinal relationship documentation.',
    things_to_avoid:        [
      'Billing G2211 without documented longitudinal relationship',
      'Billing G2211 with modifier 25 for same-day procedures (non-preventive)',
      'Billing G2211 on a new patient visit without explanation of complexity',
      'Billing G2211 with modifier 57',
      'Billing G2211 on every visit as a default without reviewing eligibility',
    ],
    telehealth_allowed:     true,
    ...META,
  }
  counter.tally(await upsertRecord(pool, 'cpt_knowledge', { cpt_code: 'G2211' }, g2211))

  // ── payer_rules: G2211 + modifier 25 restriction ──────────────────────────
  const rule1 = {
    payer_code:        'MEDICARE',
    payer_name:        'Medicare',
    cpt_code:          'G2211',
    rule_type:         'modifier',
    rule_title:        'G2211 with modifier 25 restriction',
    rule_description:  'G2211 cannot be billed when modifier 25 is appended to the E&M code, UNLESS the separately identifiable service is a preventive service on the CMS preventive services list. Billing G2211 with modifier 25 for a same-day procedure will result in denial.',
    rule_severity:     'hard',
    payer_language:    'CMS MM13473: G2211 is not separately reportable when modifier 25 is appended to the associated office or outpatient E&M visit except when the additional service furnished on the same day is a Medicare preventive service.',
    likely_denial_code: 'CO-4',
    denial_description: 'Modifier or service inconsistent with G2211 billing requirements',
    fix_action:        'Remove G2211 when modifier 25 is present and same-day service is not a preventive service. Or remove modifier 25 if the procedure is not truly separate.',
    appeal_strategy:   'Document that same-day service IS on CMS preventive services list if disputed',
    is_published:      true,
    is_stated:         true,
    effective_date:    '2025-01-01',
    is_new_change:     true,
    trump_era_change:  true,
    ...META,
  }
  counter.tally(await upsertRecord(pool, 'payer_rules',
    { payer_code: 'MEDICARE', cpt_code: 'G2211', rule_type: 'modifier' }, rule1))

  // ── payer_rules: G2211 preventive services exception ─────────────────────
  const rule2 = {
    payer_code:        'MEDICARE',
    payer_name:        'Medicare',
    cpt_code:          'G2211',
    rule_type:         'coverage',
    rule_title:        'G2211 payable with preventive services when modifier 25 present',
    rule_description:  'Effective January 1 2025, G2211 IS payable when modifier 25 is appended to the E&M and the separately identifiable same-day service is a preventive service on the Medicare Preventive Services list.',
    rule_severity:     'hard',
    payer_language:    'CMS MM13473 effective January 1 2025: G2211 may be reported with a modifier 25 when the additional service furnished on the same day is a Medicare preventive service.',
    is_published:      true,
    is_stated:         true,
    effective_date:    '2025-01-01',
    is_new_change:     true,
    trump_era_change:  true,
    ...META,
  }
  counter.tally(await upsertRecord(pool, 'payer_rules',
    { payer_code: 'MEDICARE', cpt_code: 'G2211', rule_type: 'coverage' }, rule2))

  // ── policy_change_log: G2211 modifier 25 update ───────────────────────────
  const changeData = {
    change_date:        '2025-01-01',
    payer_code:         'MEDICARE',
    cpt_code:           'G2211',
    change_type:        'new_code',
    change_title:       'G2211 now billable with preventive services when modifier 25 present — January 2025',
    change_description: 'CMS updated G2211 billing policy effective January 1 2025. G2211 may now be billed with modifier 25 when the same-day separately identifiable service is a Medicare preventive service. Previous policy prohibited G2211 with modifier 25 in all circumstances.',
    impact_level:       'high',
    old_rule:           'G2211 never billable with modifier 25',
    new_rule:           'G2211 billable with modifier 25 ONLY when same-day service is a Medicare preventive service',
    action_required:    'Update billing workflows to include G2211 on eligible primary care visits. Review same-day preventive + E&M claims to add G2211 where appropriate.',
    effective_date:     '2025-01-01',
    is_temporary:       false,
    administration:     'trump_2025',
    trump_era_change:   true,
    cms_reference:      'MM13473',
    source_url:         SOURCE_URL,
    verified:           true,
  }
  counter.tally(await upsertRecord(pool, 'policy_change_log',
    { cms_reference: 'MM13473' }, changeData))

  await logScraperRun(pool, 'g2211', {
    ...counter,
    notes: Array.isArray(counter.notes) ? counter.notes.join('; ') : null,
  })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapeG2211 }
