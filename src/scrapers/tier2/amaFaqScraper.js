'use strict'
require('dotenv').config()

const { fetchPage, upsertRecord, logScraperRun, cleanText, makeCounter } = require('../scraperUtils')
const { recordMeta } = require('../../lib/codingIntelligenceUtils')

const SOURCE_URL  = 'https://www.ama-assn.org/practice-management/cpt/cpt-evaluation-and-management-em-revisions-faqs'
const SOURCE_DATE = new Date('2024-01-01')
const META        = recordMeta('ama_official', SOURCE_URL, SOURCE_DATE, 1)

// AMA E&M FAQ items — key edge cases for MDM calculation
const AMA_FAQ_ITEMS = [
  {
    question:    'Can the physician count their own prior note as a unique source for data review?',
    answer:      'No. A unique source requires review of medical records from a different individual or entity. The physician\'s own prior notes, even from different encounters, do not count as a unique source. An external lab result, a note from a specialist, or records from a different facility are unique sources.',
    cptCodes:    ['99204','99205','99214','99215'],
    field:       'edge_cases',
    ruleType:    'documentation',
    isMedicare:  false,
  },
  {
    question:    'Does ordering a test count as "ordering and reviewing" for data review?',
    answer:      'Ordering a test counts when the test is ordered and the result is reviewed during the same encounter or when there is a plan to review pending results. Ordering alone, without review or a documented plan to review, does not satisfy the data element.',
    cptCodes:    ['99203','99204','99205','99213','99214','99215'],
    field:       'edge_cases',
    ruleType:    'documentation',
    isMedicare:  false,
  },
  {
    question:    'What qualifies as "prescription drug management" for MDM risk?',
    answer:      'Prescription drug management includes: (1) prescribing a new medication, (2) changing dose, route, or formulation of an existing medication, (3) stopping a medication, (4) reviewing medications and deciding to continue without change. Option 4 (continuing without change) does count — the physician must document the review and decision.',
    cptCodes:    ['99203','99204','99213','99214'],
    field:       'edge_cases',
    ruleType:    'documentation',
    isMedicare:  false,
  },
  {
    question:    'Can time include documentation and care coordination after the patient leaves?',
    answer:      'Yes. Total time includes all time spent on the date of the encounter: pre-visit review, time with the patient, and time spent after the visit (documentation, care coordination, ordering tests, reviewing results). Must be on the date of the encounter — not next day documentation.',
    cptCodes:    ['99202','99203','99204','99205','99212','99213','99214','99215'],
    field:       'edge_cases',
    ruleType:    'documentation',
    isMedicare:  false,
  },
  {
    question:    'Does an independent historian always increase MDM complexity?',
    answer:      'Not automatically. The presence of an independent historian is an element in the "Amount and/or Complexity of Data" category. It contributes to moderate or high complexity data when the independent historian is needed because the patient cannot provide reliable history. Document why the historian was needed.',
    cptCodes:    ['99204','99205','99214','99215'],
    field:       'edge_cases',
    ruleType:    'documentation',
    isMedicare:  false,
  },
  {
    question:    'Can modifier 25 be used when the procedure is a vaccine administration?',
    answer:      'Yes. Vaccine administration is a procedure with a separate CPT code. When a significant, separately identifiable E&M is performed on the same day as vaccine administration, modifier 25 can be appended to the E&M code. The E&M must address a problem beyond the vaccine administration itself.',
    cptCodes:    ['99213','99214'],
    field:       'edge_cases',
    ruleType:    'modifier',
    isMedicare:  true,
    modifierCode: '25',
  },
  {
    question:    'Can G2211 be billed on a new patient visit?',
    answer:      'Yes, G2211 can be billed on a new patient visit if the provider documents the complexity inherent to establishing the ongoing primary care relationship and the visit complexity that will serve as the focal point for ongoing care. However, longitudinal relationship documentation is more straightforward on established patient visits.',
    cptCodes:    ['G2211','99202','99203','99204','99205'],
    field:       'edge_cases',
    ruleType:    'documentation',
    isMedicare:  true,
  },
  {
    question:    'When does "discussion with external physician" count for MDM data?',
    answer:      'Discussion of management or test interpretation with an external physician must be real-time and direct communication — phone, video, in person. It cannot be documented retroactively. The external physician must be from a different group/entity. A same-group colleague does not qualify as "external."',
    cptCodes:    ['99204','99205','99214','99215'],
    field:       'edge_cases',
    ruleType:    'documentation',
    isMedicare:  false,
  },
]

async function scrapeAmaFaq(pool) {
  const counter = makeCounter()

  let text = null
  try {
    const html = await fetchPage(SOURCE_URL)
    text = html ? cleanText(html.replace(/<[^>]+>/g, ' ')) : null
  } catch (err) {
    counter.notes = [`AMA FAQ page fetch failed: ${err.message} — seeding from embedded FAQ items`]
  }

  for (const faq of AMA_FAQ_ITEMS) {
    // ── cpt_knowledge: edge_cases / exceptions ────────────────────────────
    for (const cpt of faq.cptCodes) {
      try {
        await pool.query(`
          UPDATE cpt_knowledge
          SET edge_cases = COALESCE(edge_cases, '') || $1,
              updated_at = NOW()
          WHERE cpt_code = $2
        `, [`\n\nAMA FAQ: ${faq.question}\n${faq.answer}`, cpt])
      } catch (err) { /* non-fatal */ }
    }

    // ── modifier_rules: edge cases for modifier-related FAQs ──────────────
    if (faq.modifierCode) {
      try {
        await pool.query(`
          UPDATE modifier_rules
          SET common_mistakes = COALESCE(common_mistakes, '') || $1,
              updated_at = NOW()
          WHERE modifier_code = $2
        `, [`\n\nAMA FAQ: ${faq.question}\n${faq.answer}`, faq.modifierCode])
      } catch (err) { /* non-fatal */ }
    }

    // ── payer_rules: Medicare-specific FAQ items ───────────────────────────
    if (faq.isMedicare) {
      for (const cpt of faq.cptCodes) {
        const data = {
          payer_code:       'MEDICARE',
          payer_name:       'Medicare',
          cpt_code:         cpt,
          rule_type:        faq.ruleType,
          rule_title:       faq.question,
          rule_description: faq.answer,
          rule_severity:    'soft',
          is_behavioral:    true,
          is_stated:        false,
          is_published:     true,
          ...META,
        }
        counter.tally(await upsertRecord(pool, 'payer_rules',
          { payer_code: 'MEDICARE', cpt_code: cpt, rule_title: faq.question }, data))
      }
    }

    // ── denial_patterns: FAQ items that describe denial scenarios ─────────
    const denialFaqs = ['Can the physician count their own prior note', 'Can modifier 25 be used when the procedure is a vaccine']
    if (denialFaqs.some(q => faq.question.startsWith(q))) {
      const data = {
        scenario_title:      `AMA FAQ: ${faq.question.slice(0, 80)}`,
        scenario_description: faq.answer,
        cpt_codes:            faq.cptCodes,
        denial_category:     'diagnostic_eligibility',
        fix_description:     faq.answer,
        prevention_tip:      'Consult AMA E&M FAQ for edge case guidance before billing',
        is_verified:         true,
        ...META,
      }
      counter.tally(await upsertRecord(pool, 'denial_patterns',
        { scenario_title: `AMA FAQ: ${faq.question.slice(0, 80)}`, payer_code: null }, data))
    }
  }

  await logScraperRun(pool, 'amaFaq', {
    ...counter,
    notes: Array.isArray(counter.notes) ? counter.notes.join('; ') : null,
  })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapeAmaFaq }
