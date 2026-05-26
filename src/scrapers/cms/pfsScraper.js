'use strict'
require('dotenv').config()

const { fetchPage, upsertRecord, logScraperRun, makeCounter } = require('../scraperUtils')
const { recordMeta } = require('../../lib/codingIntelligenceUtils')

const SOURCE_URL  = 'https://www.cms.gov/medicare/payment/fee-schedules/physician'
const SOURCE_DATE = new Date('2025-01-01')
const META        = recordMeta('cms_direct', SOURCE_URL, SOURCE_DATE, 1)

// Age-banded preventive CPT codes — new patient
const NEW_PREVENTIVE = [
  { cpt: '99381', ageMin: 0,  ageMax: 11,  desc: 'Initial preventive medicine — infant (age younger than 1 year)' },
  { cpt: '99382', ageMin: 1,  ageMax: 4,   desc: 'Initial preventive medicine — early childhood (age 1-4 years)' },
  { cpt: '99383', ageMin: 5,  ageMax: 11,  desc: 'Initial preventive medicine — late childhood (age 5-11 years)' },
  { cpt: '99384', ageMin: 12, ageMax: 17,  desc: 'Initial preventive medicine — adolescent (age 12-17 years)' },
  { cpt: '99385', ageMin: 18, ageMax: 39,  desc: 'Initial preventive medicine — adult (age 18-39 years)' },
  { cpt: '99386', ageMin: 40, ageMax: 64,  desc: 'Initial preventive medicine — adult (age 40-64 years)' },
  { cpt: '99387', ageMin: 65, ageMax: 999, desc: 'Initial preventive medicine — elderly (age 65 years and older)' },
]

// Age-banded preventive CPT codes — established patient
const EST_PREVENTIVE = [
  { cpt: '99391', ageMin: 0,  ageMax: 11,  desc: 'Periodic preventive medicine — infant (age younger than 1 year)' },
  { cpt: '99392', ageMin: 1,  ageMax: 4,   desc: 'Periodic preventive medicine — early childhood (age 1-4 years)' },
  { cpt: '99393', ageMin: 5,  ageMax: 11,  desc: 'Periodic preventive medicine — late childhood (age 5-11 years)' },
  { cpt: '99394', ageMin: 12, ageMax: 17,  desc: 'Periodic preventive medicine — adolescent (age 12-17 years)' },
  { cpt: '99395', ageMin: 18, ageMax: 39,  desc: 'Periodic preventive medicine — adult (age 18-39 years)' },
  { cpt: '99396', ageMin: 40, ageMax: 64,  desc: 'Periodic preventive medicine — adult (age 40-64 years)' },
  { cpt: '99397', ageMin: 65, ageMax: 999, desc: 'Periodic preventive medicine — elderly (age 65 years and older)' },
]

async function scrapePfs(pool) {
  const counter = makeCounter()

  let pageText = null
  try {
    const html = await fetchPage(SOURCE_URL)
    pageText = html ? html.replace(/<[^>]+>/g, ' ') : null
  } catch (err) {
    counter.notes = [`PFS page fetch failed: ${err.message} — seeding demographic rules from CPT spec`]
  }

  // ── patient_demographics_rules: age-banded preventive codes ───────────────
  for (const code of [...NEW_PREVENTIVE, ...EST_PREVENTIVE]) {
    const data = {
      demographic_type: 'age',
      age_min:          code.ageMin,
      age_max:          code.ageMax === 999 ? null : code.ageMax,
      sex:              'any',
      cpt_code:         code.cpt,
      rule_description: `${code.cpt} is only valid for patients aged ${code.ageMin}${code.ageMax === 999 ? '+' : '–' + code.ageMax} years. Billing for a patient outside this age range results in denial.`,
      rationale:        'CMS and AMA define age-specific preventive codes. Payers validate patient age against the billed code.',
      common_errors:    `Billing ${code.cpt} for wrong age group. Most common: billing 99395 (18-39) for a patient who has turned 40 — should be 99396.`,
      denial_risk:      'CO-4 (service inconsistent with patient age) or CO-96 (non-covered)',
      carc_code:        'CO-4',
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'patient_demographics_rules',
      { demographic_type: 'age', cpt_code: code.cpt }, data))
  }

  // ── cpt_knowledge: seed preventive code descriptions ─────────────────────
  for (const code of [...NEW_PREVENTIVE, ...EST_PREVENTIVE]) {
    const isNew = NEW_PREVENTIVE.some(c => c.cpt === code.cpt)
    const data = {
      cpt_code:             code.cpt,
      short_description:    code.desc,
      category:             'preventive',
      subcategory:          isNew ? 'preventive_new' : 'preventive_established',
      telehealth_allowed:   false,
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'cpt_knowledge', { cpt_code: code.cpt }, data))
  }

  // ── patient_demographics_rules: sex-specific codes ────────────────────────
  // Pap smear, mammography — not in scope but flag cervical/prostate codes if encountered
  const sexSpecific = [
    { cpt: '99385', sex: 'female', note: 'Age 18-39 female preventive — Pap smear recommended per USPSTF' },
    { cpt: '99386', sex: 'female', note: 'Age 40-64 female preventive — mammography screening applies' },
  ]
  for (const rule of sexSpecific) {
    const data = {
      demographic_type: 'sex',
      age_min:          null,
      age_max:          null,
      sex:              rule.sex,
      cpt_code:         rule.cpt,
      rule_description: rule.note,
      rationale:        'Certain preventive screenings are sex-specific — billing against wrong patient sex can trigger CO-4',
      common_errors:    'Billing sex-specific preventive components for wrong patient sex',
      denial_risk:      'CO-4',
      carc_code:        'CO-4',
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'patient_demographics_rules',
      { demographic_type: 'sex', cpt_code: rule.cpt }, data))
  }

  if (!pageText) {
    counter.notes = (counter.notes || []).concat(['PFS page unavailable — national average rates not seeded. Re-run to capture fee schedule data.'])
  } else {
    counter.notes = (counter.notes || []).concat(['PFS page fetched — detailed fee schedule rates require structured CSV download. Age rules seeded from CPT spec.'])
  }

  await logScraperRun(pool, 'pfs', {
    ...counter,
    notes: Array.isArray(counter.notes) ? counter.notes.join('; ') : null,
  })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapePfs }
