'use strict'
require('dotenv').config()

const { fetchPage, upsertRecord, logScraperRun, cleanText, extractCPTCodes, makeCounter } = require('../scraperUtils')
const { recordMeta } = require('../../lib/codingIntelligenceUtils')

const SOURCE_URL  = 'https://medicare.fcso.com/EM/0508199.asp'
const SOURCE_DATE = new Date('2025-01-01')
const META        = recordMeta('cms_direct', SOURCE_URL, SOURCE_DATE, 1)

// FCSO MAC-specific E&M guidance — cross-reference validator
// First Coast Service Options — jurisdiction for FL, PR, USVI
const FCSO_GUIDANCE = [
  {
    title:       'FCSO: MDM complexity must be determined by the highest-level element met in 2 of 3 MDM columns',
    description: 'To select a code based on MDM, two of the three MDM elements (Problems, Data, Risk) must meet or exceed the level. If only one element meets the required level, the code cannot be selected based on MDM — must use a lower code or time-based selection.',
    cptCodes:    ['99202','99203','99204','99205','99212','99213','99214','99215'],
    ruleType:    'documentation',
    severity:    'hard',
    isMacSpecific: false,
  },
  {
    title:       'FCSO: Chief complaint or reason for visit required in every E&M note',
    description: 'FCSO auditors require documentation of the reason for the visit (chief complaint) in every E&M note. Missing chief complaint is a documentation deficiency that can result in downcoding or denial.',
    cptCodes:    ['99212','99213','99214','99215'],
    ruleType:    'documentation',
    severity:    'soft',
    isMacSpecific: true,
  },
  {
    title:       'FCSO: Assessment and plan must be specific to each problem addressed',
    description: 'The assessment and plan must specifically address each problem mentioned in the visit. A generic "follow up in 3 months" without problem-specific plans does not satisfy MDM documentation requirements.',
    cptCodes:    ['99213','99214','99215'],
    ruleType:    'documentation',
    severity:    'soft',
    isMacSpecific: true,
  },
  {
    title:       'FCSO: Cloned documentation triggers medical review',
    description: 'FCSO identifies cloned documentation (identical or near-identical notes across visits) as a significant audit trigger. Each note must reflect the specific encounter. EHR auto-population of prior visit data without physician review is a compliance risk.',
    cptCodes:    ['99213','99214','99215','G0438','G0439'],
    ruleType:    'known_adr_trigger',
    severity:    'soft',
    isMacSpecific: false,
  },
]

async function scrapeFcso(pool) {
  const counter = makeCounter()

  let pageText = null
  let linkedDocUrls = []

  try {
    const html = await fetchPage(SOURCE_URL)
    if (html) {
      pageText = cleanText(html.replace(/<[^>]+>/g, ' '))
      // Find linked documents on the page
      const hrefMatches = html.matchAll(/href="([^"]+\.(?:pdf|asp|aspx)[^"]*)"/gi)
      for (const match of hrefMatches) {
        const href = match[1]
        if (!href.startsWith('http')) {
          linkedDocUrls.push(`https://medicare.fcso.com${href.startsWith('/') ? '' : '/EM/'}${href}`)
        } else {
          linkedDocUrls.push(href)
        }
      }
      counter.notes = [`FCSO page loaded. Found ${linkedDocUrls.length} linked documents. CPTs on page: ${extractCPTCodes(pageText).join(',')}`]
    }
  } catch (err) {
    counter.notes = [`FCSO page fetch failed: ${err.message} — seeding from embedded FCSO guidance`]
  }

  // ── payer_rules: FCSO MAC guidance ────────────────────────────────────────
  for (const guidance of FCSO_GUIDANCE) {
    for (const cpt of guidance.cptCodes) {
      const data = {
        payer_code:       'MEDICARE',
        payer_name:       'Medicare (FCSO MAC)',
        cpt_code:         cpt,
        rule_type:        guidance.ruleType,
        rule_title:       guidance.title,
        rule_description: guidance.description,
        rule_severity:    guidance.severity,
        applies_when:     guidance.isMacSpecific ? 'Jurisdiction of First Coast Service Options (FL, PR, USVI) — verify with your MAC' : 'General Medicare policy',
        is_stated:        true,
        is_published:     true,
        ...META,
      }
      counter.tally(await upsertRecord(pool, 'payer_rules',
        { payer_code: 'MEDICARE', cpt_code: cpt, rule_title: guidance.title }, data))
    }

    // Increment consistency on matching records from other scrapers
    if (!guidance.isMacSpecific) {
      for (const cpt of guidance.cptCodes) {
        try {
          await pool.query(`
            UPDATE cpt_knowledge
            SET consistency_score = LEAST(COALESCE(consistency_score,1) + 1, 5),
                updated_at = NOW()
            WHERE cpt_code = $1
          `, [cpt])
        } catch (err) { /* non-fatal */ }
      }
    }
  }

  // ── Fetch linked documents not yet scraped ────────────────────────────────
  if (linkedDocUrls.length) {
    for (const url of linkedDocUrls.slice(0, 5)) { // cap to avoid runaway fetches
      try {
        const linkedHtml = await fetchPage(url)
        if (linkedHtml) {
          const linkedText = cleanText(linkedHtml.replace(/<[^>]+>/g, ' '))
          const foundCPTs  = extractCPTCodes(linkedText)
          if (foundCPTs.length) {
            counter.notes = (counter.notes || []).concat([`Linked doc ${url}: found CPTs ${foundCPTs.join(',')} — manual extraction recommended`])
          }
        }
      } catch (err) { /* non-fatal — linked doc fetch failures don't block */ }
    }
  }

  await logScraperRun(pool, 'fcso', {
    ...counter,
    notes: Array.isArray(counter.notes) ? counter.notes.join('; ') : null,
  })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapeFcso }
