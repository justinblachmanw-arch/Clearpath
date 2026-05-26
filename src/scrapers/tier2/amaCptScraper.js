'use strict'
require('dotenv').config()

const { fetchPDF, upsertRecord, logScraperRun, cleanText, makeCounter } = require('../scraperUtils')
const { recordMeta } = require('../../lib/codingIntelligenceUtils')

const SOURCE_URL  = 'https://www.ama-assn.org/system/files/2023-e-m-descriptors-guidelines.pdf'
const SOURCE_DATE = new Date('2023-01-01')
const META        = recordMeta('ama_official', SOURCE_URL, SOURCE_DATE, 2)

// Official AMA CPT descriptors for E&M codes — validate against CMS descriptions
const AMA_DESCRIPTORS = {
  '99202': 'Office or other outpatient visit for a new patient, which requires a medically appropriate history and/or examination and straightforward medical decision making. When using total time on the date of the encounter for code selection, 15-29 minutes total time is required.',
  '99203': 'Office or other outpatient visit for a new patient, which requires a medically appropriate history and/or examination and low level of medical decision making. When using total time on the date of the encounter for code selection, 30-44 minutes total time is required.',
  '99204': 'Office or other outpatient visit for a new patient, which requires a medically appropriate history and/or examination and moderate level of medical decision making. When using total time on the date of the encounter for code selection, 45-59 minutes total time is required.',
  '99205': 'Office or other outpatient visit for a new patient, which requires a medically appropriate history and/or examination and high level of medical decision making. When using total time on the date of the encounter for code selection, 60-74 minutes total time is required.',
  '99211': 'Office or other outpatient visit for an established patient that may not require the presence of a physician or other qualified health care professional.',
  '99212': 'Office or other outpatient visit for an established patient, which requires a medically appropriate history and/or examination and straightforward medical decision making. When using total time on the date of the encounter for code selection, 10-19 minutes total time is required.',
  '99213': 'Office or other outpatient visit for an established patient, which requires a medically appropriate history and/or examination and low level of medical decision making. When using total time on the date of the encounter for code selection, 20-29 minutes total time is required.',
  '99214': 'Office or other outpatient visit for an established patient, which requires a medically appropriate history and/or examination and moderate level of medical decision making. When using total time on the date of the encounter for code selection, 30-39 minutes total time is required.',
  '99215': 'Office or other outpatient visit for an established patient, which requires a medically appropriate history and/or examination and high level of medical decision making. When using total time on the date of the encounter for code selection, 40-54 minutes total time is required.',
}

// AMA MDM table definitions — exact from 2021 guidelines (still current)
const AMA_MDM_DEFINITIONS = {
  unique_source: '"A unique source is defined as a medical record from a different individual or entity." — independent test result or external record qualifies; physician review of their own prior note does not.',
  prescription_drug_management: '"Prescription drug management includes: prescribing a new medication, changing an existing medication (dose, route, formulation), stopping a medication, or reviewing and deciding to continue a current medication."',
  independent_historian: '"An independent historian is an individual who provides a history in addition to a history provided by the patient who is unable to provide a complete or reliable history (e.g., a patient with dementia, cognitive impairment, or a minor)."',
  independent_interpretation: '"The independent interpretation of a test that has been performed by another physician or other qualified health care professional... means interpreting the test independently." Reviewing results from a reference lab qualifies if the provider forms an independent interpretation.',
  discussion_management: '"Discussion of management or test interpretation with external physician, other qualified health care professional, or appropriate source requires direct communication." Real-time communication — cannot be documented retroactively.',
}

async function scrapeAmaCpt(pool) {
  const counter = makeCounter()

  let text = null
  try {
    const raw = await fetchPDF(SOURCE_URL)
    text = raw ? cleanText(raw) : null
  } catch (err) {
    counter.notes = [`AMA PDF fetch failed: ${err.message} — seeding from embedded AMA descriptors`]
  }

  // ── cpt_knowledge: AMA official descriptors ───────────────────────────────
  for (const [cpt, descriptor] of Object.entries(AMA_DESCRIPTORS)) {
    // Check if existing CMS description differs — flag conflict if so
    let existing = null
    try {
      const res = await pool.query('SELECT full_description, consistency_score FROM cpt_knowledge WHERE cpt_code = $1', [cpt])
      existing = res.rows[0] || null
    } catch (err) { /* non-fatal */ }

    if (existing) {
      const cmsFull = (existing.full_description || '').toLowerCase().trim()
      const amaFull = descriptor.toLowerCase().trim()
      const matches = cmsFull.length > 20 && (cmsFull.includes(amaFull.slice(0, 50)) || amaFull.includes(cmsFull.slice(0, 50)))

      if (matches) {
        // AMA and CMS agree — increment consistency score
        try {
          await pool.query(`
            UPDATE cpt_knowledge
            SET consistency_score = LEAST(COALESCE(consistency_score,1) + 1, 5),
                confidence_score  = LEAST(COALESCE(confidence_score,5) + 1, 15),
                updated_at = NOW()
            WHERE cpt_code = $1
          `, [cpt])
          counter.updated++
        } catch (err) { /* non-fatal */ }
      } else if (cmsFull.length > 20) {
        // Conflict — flag but don't overwrite
        try {
          await pool.query(`
            UPDATE cpt_knowledge
            SET stated_behavioral_conflict = true,
                conflict_notes = COALESCE(conflict_notes,'') || $1,
                updated_at = NOW()
            WHERE cpt_code = $2
          `, [`AMA descriptor differs from CMS: AMA="${descriptor.slice(0,100)}"`, cpt])
          counter.updated++
        } catch (err) { /* non-fatal */ }
      }
    }

    // Upsert AMA descriptor as full_description if not set
    const data = {
      cpt_code:         cpt,
      full_description: descriptor,
      em_key_components: [
        AMA_MDM_DEFINITIONS.unique_source,
        AMA_MDM_DEFINITIONS.prescription_drug_management,
        AMA_MDM_DEFINITIONS.independent_historian,
        AMA_MDM_DEFINITIONS.independent_interpretation,
        AMA_MDM_DEFINITIONS.discussion_management,
      ].join('\n\n'),
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'cpt_knowledge', { cpt_code: cpt }, data))
  }

  await logScraperRun(pool, 'amaCpt', {
    ...counter,
    notes: Array.isArray(counter.notes) ? counter.notes.join('; ') : null,
  })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapeAmaCpt }
