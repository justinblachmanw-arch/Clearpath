require('dotenv').config()
const axios  = require('axios')
const cheerio = require('cheerio')
const OpenAI = require('openai')
const db     = require('../db')

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const EM_CODES = [
  '99202', '99203', '99204', '99205',
  '99211', '99212', '99213', '99214', '99215',
  '99381', '99382', '99383', '99384', '99385',
  '99391', '99392', '99393', '99394', '99395', '99396',
]

// EM code descriptions for richer GPT prompts
const EM_DESCRIPTIONS = {
  '99202': 'new patient office visit, straightforward medical decision making',
  '99203': 'new patient office visit, low medical decision making',
  '99204': 'new patient office visit, moderate medical decision making',
  '99205': 'new patient office visit, high medical decision making',
  '99211': 'established patient office visit, minimal',
  '99212': 'established patient office visit, straightforward medical decision making',
  '99213': 'established patient office visit, low medical decision making',
  '99214': 'established patient office visit, moderate medical decision making',
  '99215': 'established patient office visit, high medical decision making',
  '99381': 'new patient preventive visit, infant (under 1)',
  '99382': 'new patient preventive visit, early childhood (1-4)',
  '99383': 'new patient preventive visit, late childhood (5-11)',
  '99384': 'new patient preventive visit, adolescent (12-17)',
  '99385': 'new patient preventive visit, adult (18-39)',
  '99391': 'established patient preventive visit, infant (under 1)',
  '99392': 'established patient preventive visit, early childhood (1-4)',
  '99393': 'established patient preventive visit, late childhood (5-11)',
  '99394': 'established patient preventive visit, adolescent (12-17)',
  '99395': 'established patient preventive visit, adult (18-39)',
  '99396': 'established patient preventive visit, adult (40-64)',
}

const PAYERS = [
  {
    name:  'Medicare',
    code:  'MEDICARE',
    mode:  'direct',
    urls:  [
      'https://www.cms.gov/medicare/physician-fee-schedule/search',
      'https://www.cms.gov/medicare/coding-billing/evaluation-management-services',
    ],
  },
  {
    name:  'Aetna',
    code:  'AETNA',
    mode:  'gpt4o_structured',
    urls:  ['https://www.aetna.com/health-care-professionals/clinical-policy-bulletins/medical-clinical-policy-bulletins.html'],
  },
  {
    name:  'UnitedHealthcare',
    code:  'UHC',
    mode:  'gpt4o_structured',
    urls:  ['https://www.uhcprovider.com/en/policies-protocols/commercial-policies/commercial-medical-drug-policies.html'],
  },
  {
    name:  'BlueCross BlueShield',
    code:  'BCBS',
    mode:  'gpt4o_structured',
    urls:  ['https://www.anthem.com/provider/policies/'],
  },
  {
    name:  'Cigna',
    code:  'CIGNA',
    mode:  'gpt4o_structured',
    urls:  ['https://www.cigna.com/healthcare-professionals/coverage-policies'],
  },
]

// ── Direct HTTP scrape ────────────────────────────────────────────────────────

async function scrapeWithAxios(url) {
  try {
    const resp = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HealthPlatformBot/1.0)' },
    })
    const $ = cheerio.load(resp.data)
    // Strip nav, footer, scripts, styles — keep main content text
    $('nav, footer, script, style, iframe').remove()
    const text = $('main, article, .content, #content, body').first().text()
      .replace(/\s+/g, ' ').trim().slice(0, 8000)
    return text.length > 200 ? text : null
  } catch {
    return null
  }
}

// ── GPT-4o structured generation ─────────────────────────────────────────────

async function generateStructuredPolicy(payerName, cptCode) {
  const desc = EM_DESCRIPTIONS[cptCode] || 'evaluation and management service'
  const prompt = `You are a medical billing expert. Based on ${payerName}'s publicly available medical policies and CMS E&M guidelines for CPT code ${cptCode} (${desc}), provide the following. Base your response only on publicly available payer policy information and CMS 2021 E&M guidelines.

Return JSON only, no other text:
{
  "coverage_criteria": "What medical necessity and clinical criteria must be met for ${payerName} to cover ${cptCode}",
  "documentation_required": "Specific note elements required in the medical record to support ${cptCode} under ${payerName} policy (history, exam, MDM or time components, etc.)",
  "common_denial_reasons": "Most common reasons ${payerName} denies ${cptCode} claims, with specific denial codes where known",
  "appeal_strategy": "How to successfully appeal a ${payerName} denial for ${cptCode}, including what additional documentation to submit"
}`

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 600,
    response_format: { type: 'json_object' },
  })

  return JSON.parse(resp.choices[0].message.content)
}

// ── GPT-4o enrichment (for direct-scraped raw content) ───────────────────────

async function enrichRawContent(payerName, cptCode, rawContent) {
  const desc = EM_DESCRIPTIONS[cptCode] || 'evaluation and management service'
  const prompt = `You are a medical billing expert. The following is publicly available policy content from ${payerName}. Extract and structure the relevant information for CPT code ${cptCode} (${desc}).

Policy content:
${rawContent.slice(0, 4000)}

Return JSON only:
{
  "coverage_criteria": "string",
  "documentation_required": "string",
  "common_denial_reasons": "string",
  "appeal_strategy": "string"
}`

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 600,
    response_format: { type: 'json_object' },
  })

  return JSON.parse(resp.choices[0].message.content)
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertPolicy({
  payerName, payerCode, cptCode, policyUrl,
  rawContent, coverageCriteria, documentationRequired,
  commonDenialReasons, appealStrategy, source,
}) {
  await db.query(`
    INSERT INTO payer_policies
      (payer_name, payer_code, cpt_code, policy_url, raw_content,
       coverage_criteria, documentation_required, common_denial_reasons,
       appeal_strategy, source, last_scraped_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
    ON CONFLICT (payer_code, cpt_code)
    DO UPDATE SET
      coverage_criteria      = EXCLUDED.coverage_criteria,
      documentation_required = EXCLUDED.documentation_required,
      common_denial_reasons  = EXCLUDED.common_denial_reasons,
      appeal_strategy        = EXCLUDED.appeal_strategy,
      raw_content            = EXCLUDED.raw_content,
      policy_url             = EXCLUDED.policy_url,
      source                 = EXCLUDED.source,
      last_scraped_at        = NOW(),
      updated_at             = NOW()
  `, [
    payerName, payerCode, cptCode, policyUrl || null,
    rawContent || null, coverageCriteria, documentationRequired,
    commonDenialReasons, appealStrategy, source,
  ])
}

// ── Main entry point ──────────────────────────────────────────────────────────

async function runPayerPolicyScraper() {
  console.log('[PAYER SCRAPER] Starting — 5 payers × 21 E&M codes')

  const stats = { updated: 0, failed: 0, payers: [], cptsUpdated: [] }

  for (const payer of PAYERS) {
    console.log(`\n[PAYER SCRAPER] Processing ${payer.name} (${payer.code})`)
    let payerUpdated = 0

    // Try direct fetch for direct-mode payers
    let rawContent = null
    if (payer.mode === 'direct') {
      for (const url of payer.urls) {
        rawContent = await scrapeWithAxios(url)
        if (rawContent) {
          console.log(`[PAYER SCRAPER] ${payer.name} — fetched ${rawContent.length} chars from ${url}`)
          break
        }
      }
      if (!rawContent) {
        console.log(`[PAYER SCRAPER] ${payer.name} — direct fetch blocked, falling back to GPT-4o structured`)
      }
    }

    for (const cptCode of EM_CODES) {
      try {
        let enriched
        let source

        if (rawContent) {
          // Enrich scraped content
          enriched = await enrichRawContent(payer.name, cptCode, rawContent)
          source = 'cms_direct'
        } else {
          // GPT-4o structured generation
          enriched = await generateStructuredPolicy(payer.name, cptCode)
          source = 'gpt4o_structured'
        }

        await upsertPolicy({
          payerName:             payer.name,
          payerCode:             payer.code,
          cptCode,
          policyUrl:             payer.urls[0],
          rawContent:            rawContent || null,
          coverageCriteria:      enriched.coverage_criteria,
          documentationRequired: enriched.documentation_required,
          commonDenialReasons:   enriched.common_denial_reasons,
          appealStrategy:        enriched.appeal_strategy,
          source,
        })

        payerUpdated++
        stats.updated++
        if (!stats.cptsUpdated.includes(cptCode)) stats.cptsUpdated.push(cptCode)
        process.stdout.write('.')
      } catch (err) {
        console.error(`\n[PAYER SCRAPER] Failed ${payer.name}/${cptCode}:`, err.message)
        stats.failed++
      }
    }

    console.log(`\n[PAYER SCRAPER] ${payer.name} — ${payerUpdated} policies saved`)
    if (payerUpdated > 0) stats.payers.push(payer.code)
  }

  console.log(`\n[PAYER SCRAPER] Complete — ${stats.updated} updated, ${stats.failed} failed`)
  return stats
}

// ── Query helper used by agents ───────────────────────────────────────────────

async function getPayerPolicy(payerCode, cptCode) {
  try {
    const result = await db.query(
      `SELECT coverage_criteria, documentation_required, common_denial_reasons, appeal_strategy
       FROM payer_policies WHERE payer_code = $1 AND cpt_code = $2 LIMIT 1`,
      [payerCode, cptCode]
    )
    return result.rows[0] || null
  } catch {
    return null
  }
}

module.exports = { runPayerPolicyScraper, getPayerPolicy }

// Run directly: node src/lib/payerPolicyScraper.js
if (require.main === module) {
  runPayerPolicyScraper()
    .then(stats => {
      console.log('\nFinal stats:', JSON.stringify(stats, null, 2))
      process.exit(0)
    })
    .catch(err => {
      console.error('Scraper error:', err)
      process.exit(1)
    })
}
