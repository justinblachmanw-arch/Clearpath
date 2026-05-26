'use strict'
require('dotenv').config()

const { fetchPage, upsertRecord, logScraperRun, cleanText, extractCPTCodes, makeCounter } = require('../scraperUtils')
const { recordMeta, isTrumpEraChange } = require('../../lib/codingIntelligenceUtils')

const SOURCE_URL  = 'https://oig.hhs.gov/reports-and-publications/workplan/'
const SOURCE_DATE = new Date('2025-01-01')
const META        = recordMeta('cms_direct', SOURCE_URL, SOURCE_DATE, 1)

// OIG Work Plan items relevant to primary care — 2025
const OIG_ITEMS = [
  {
    title:       'Evaluation and Management Services — Medical Necessity and Documentation',
    description: 'OIG is reviewing Medicare payments for evaluation and management services to determine whether they were medically necessary and supported by medical record documentation. Focus on high-complexity codes (99214, 99215) and upcoding patterns.',
    cptCodes:    ['99214','99215'],
    addedDate:   '2025-01-01',
    riskLevel:   'very_high',
  },
  {
    title:       'Annual Wellness Visits — Improper Payments',
    description: 'OIG is reviewing AWV claims due to the 24.5% improper payment rate identified in the CERT report. Focus: missing required elements, frequency violations, billing G0439 when G0438 should be used.',
    cptCodes:    ['G0438','G0439'],
    addedDate:   '2024-10-01',
    riskLevel:   'very_high',
  },
  {
    title:       'Chronic Care Management — Documentation and Time Requirements',
    description: 'OIG reviewing CCM claims (99490, 99491) for compliance with 20-minute clinical staff time requirement, presence of comprehensive care plan, and patient consent documentation.',
    cptCodes:    ['99490','99491'],
    addedDate:   '2025-01-01',
    riskLevel:   'high',
  },
  {
    title:       'G2211 — Longitudinal Relationship Documentation',
    description: 'OIG monitoring G2211 add-on code claims for appropriate use. Reviewing whether providers are billing G2211 without documentation of ongoing primary care relationship and visit complexity.',
    cptCodes:    ['G2211'],
    addedDate:   '2025-01-01',
    riskLevel:   'high',
  },
  {
    title:       'Telehealth Services — Post-COVID Compliance',
    description: 'OIG reviewing telehealth claims for compliance with post-COVID flexibility sunset requirements. Focus: correct POS codes (02 vs 10), modifier requirements, audio-only coverage restrictions.',
    cptCodes:    ['99213','99214','99215'],
    addedDate:   '2025-10-01',
    riskLevel:   'high',
  },
  {
    title:       'Modifier 25 — Overuse in Primary Care',
    description: 'OIG reviewing modifier 25 use patterns. Providers with high rates of modifier 25 on preventive + E&M same-day claims are flagged for ADR requests. Focus on systematic use without documentation.',
    cptCodes:    ['99213','99214','99395','99396','G0438','G0439'],
    addedDate:   '2024-10-01',
    riskLevel:   'high',
  },
  {
    title:       'Split/Shared Visits — Documentation of Substantive Portion',
    description: 'OIG reviewing split/shared visit claims where the billing provider (physician) did not document performing the substantive portion of the visit as required by CMS 2022 guidelines.',
    cptCodes:    ['99213','99214','99215'],
    addedDate:   '2025-01-01',
    riskLevel:   'medium',
  },
]

async function scrapeOigWorkPlan(pool) {
  const counter = makeCounter()

  let pageText = null
  try {
    const html = await fetchPage(SOURCE_URL)
    pageText = html ? cleanText(html.replace(/<[^>]+>/g, ' ')) : null
  } catch (err) {
    counter.notes = [`OIG page fetch failed: ${err.message} — seeding from embedded 2025 work plan items`]
  }

  // If page loaded, try to find additional relevant items
  let liveCPTs = []
  if (pageText) {
    liveCPTs = extractCPTCodes(pageText)
    counter.notes = (counter.notes || []).concat([`Live OIG page loaded. CPTs mentioned: ${liveCPTs.slice(0,10).join(',')}. Manual review recommended for new items.`])
  }

  for (const item of OIG_ITEMS) {
    const isNew2025 = isTrumpEraChange(item.addedDate)

    // ── payer_rules: OIG investigation trigger ────────────────────────────
    for (const cpt of item.cptCodes) {
      const data = {
        payer_code:       'MEDICARE',
        payer_name:       'Medicare OIG',
        cpt_code:         cpt,
        rule_type:        'known_adr_trigger',
        rule_title:       item.title,
        rule_description: item.description,
        rule_severity:    'soft',
        is_published:     true,
        is_stated:        true,
        effective_date:   item.addedDate,
        is_new_change:    isNew2025,
        trump_era_change: isNew2025,
        ...META,
        source_url: SOURCE_URL,
      }
      counter.tally(await upsertRecord(pool, 'payer_rules',
        { payer_code: 'MEDICARE', cpt_code: cpt, rule_type: 'known_adr_trigger', rule_title: item.title }, data))
    }

    // ── cpt_knowledge: audit risk flags ──────────────────────────────────
    for (const cpt of item.cptCodes) {
      try {
        await pool.query(`
          UPDATE cpt_knowledge
          SET audit_risk_level = $1,
              audit_risk_notes = COALESCE(audit_risk_notes, '') || $2,
              updated_at = NOW()
          WHERE cpt_code = $3
            AND (audit_risk_level IS NULL OR audit_risk_level != 'very_high')
        `, [
          item.riskLevel,
          ` OIG Work Plan 2025: ${item.title}.`,
          cpt,
        ])
      } catch (err) { /* non-fatal */ }
    }

    // ── policy_change_log: new 2025 OIG items ─────────────────────────────
    if (isNew2025) {
      const changeData = {
        change_date:        item.addedDate,
        payer_code:         'MEDICARE',
        cpt_code:           item.cptCodes[0] || null,
        change_type:        'new_requirement',
        change_title:       `OIG Work Plan 2025: ${item.title}`,
        change_description: item.description,
        impact_level:       item.riskLevel === 'very_high' ? 'critical' : 'high',
        action_required:    'Review documentation practices for this service type. Ensure records support billed codes.',
        effective_date:     item.addedDate,
        trump_era_change:   true,
        source_url:         SOURCE_URL,
        verified:           true,
      }
      counter.tally(await upsertRecord(pool, 'policy_change_log',
        { change_title: `OIG Work Plan 2025: ${item.title}` }, changeData))
    }
  }

  await logScraperRun(pool, 'oigWorkPlan', {
    ...counter,
    notes: Array.isArray(counter.notes) ? counter.notes.join('; ') : null,
  })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapeOigWorkPlan }
