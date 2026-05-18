require('dotenv').config()
const axios   = require('axios')
const OpenAI  = require('openai')
const db      = require('../db')

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// E&M codes in scope
const OFFICE_VISIT_CODES = ['99202','99203','99204','99205','99211','99212','99213','99214','99215']
const PREVENTIVE_CODES   = ['99381','99382','99383','99384','99385','99391','99392','99393','99394','99395','99396']
const ALL_EM_CODES       = [...OFFICE_VISIT_CODES, ...PREVENTIVE_CODES]

// Top 30 CARCs in primary care billing
const TOP_CARCS = ['4','6','15','16','18','22','24','26','27','29','45','49','50','57','58',
                   '59','96','97','109','119','125','133','167','170','177','197','204','236','253','272']

// ── DB helpers ────────────────────────────────────────────────────────────────

async function upsertGuideline({ source, sourceUrl, cptCode, guidelineType, title, content, effectiveDate }) {
  await db.query(`
    INSERT INTO coding_guidelines
      (source, source_url, cpt_code, guideline_type, title, content, effective_date, last_updated)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (source, cpt_code, guideline_type)
    DO UPDATE SET content = EXCLUDED.content, title = EXCLUDED.title, last_updated = NOW()
  `, [source, sourceUrl || null, cptCode || null, guidelineType, title || null, content, effectiveDate || null])
}

async function upsertCarc({ codeType, code, description, category, fixAction, appealAngle, relatedCodes }) {
  await db.query(`
    INSERT INTO carc_rarc_codes
      (code_type, code, description, category, fix_action, appeal_angle, related_codes, last_updated)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (code_type, code)
    DO UPDATE SET description = EXCLUDED.description, category = EXCLUDED.category,
                  fix_action = EXCLUDED.fix_action, appeal_angle = EXCLUDED.appeal_angle,
                  last_updated = NOW()
  `, [codeType, code, description, category || null, fixAction || null, appealAngle || null,
      relatedCodes?.length ? relatedCodes : null])
}

// ── Try to fetch URL, return text or null ─────────────────────────────────────

async function tryFetch(url) {
  try {
    const resp = await axios.get(url, {
      timeout: 12000,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HealthPlatformBot/1.0)' },
    })
    const contentType = resp.headers['content-type'] || ''
    if (contentType.includes('pdf')) return null   // can't parse binary PDF
    return Buffer.from(resp.data).toString('utf-8').replace(/\s+/g, ' ').trim().slice(0, 6000) || null
  } catch {
    return null
  }
}

// ── Part 1: AMA 2021 E&M MDM Criteria ────────────────────────────────────────

async function loadAMAMDMGuidelines() {
  console.log('[CODING SCRAPER] Loading AMA 2021 E&M MDM guidelines via GPT-4o')
  const SOURCE_URL = 'https://www.ama-assn.org/system/files/2019-06/cpt-revised-mdm-grid.pdf'

  const prompt = `You are an expert in AMA CPT coding guidelines. Based on the AMA 2021 E&M guidelines (effective January 1, 2021), provide structured MDM criteria for each office visit CPT code.

Return a JSON array only, no other text:
[
  {
    "cpt_code": "99202",
    "mdm_level": "straightforward",
    "problems_addressed": "...",
    "data_reviewed": "...",
    "risk_of_complications": "...",
    "time_threshold_minutes": "15-29",
    "typical_clinical_scenario": "..."
  }
]

Include codes: 99202, 99203, 99204, 99205, 99211, 99212, 99213, 99214, 99215.
Use the official 2021 AMA MDM table values exactly. For 99211 note it may not require physician presence.`

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  })

  const raw = JSON.parse(resp.choices[0].message.content)
  const codes = Array.isArray(raw) ? raw : (raw.codes || raw.guidelines || Object.values(raw)[0])

  let saved = 0
  for (const c of codes) {
    const mdmContent = [
      `MDM Level: ${c.mdm_level}`,
      `Problems addressed: ${c.problems_addressed}`,
      `Data reviewed: ${c.data_reviewed}`,
      `Risk of complications: ${c.risk_of_complications}`,
    ].join('\n')

    await upsertGuideline({
      source:        'ama_2021',
      sourceUrl:     SOURCE_URL,
      cptCode:       c.cpt_code,
      guidelineType: 'mdm_criteria',
      title:         `${c.cpt_code} MDM — ${c.mdm_level}`,
      content:       mdmContent,
      effectiveDate: '2021-01-01',
    })

    await upsertGuideline({
      source:        'ama_2021',
      sourceUrl:     SOURCE_URL,
      cptCode:       c.cpt_code,
      guidelineType: 'time_criteria',
      title:         `${c.cpt_code} Time — ${c.time_threshold_minutes} min`,
      content:       `Total physician/QHP time on date of encounter: ${c.time_threshold_minutes} minutes. ${c.typical_clinical_scenario || ''}`.trim(),
      effectiveDate: '2021-01-01',
    })
    saved += 2
    process.stdout.write('.')
  }
  console.log(`\n[CODING SCRAPER] AMA MDM — ${saved} records saved`)
}

// ── Part 2: Documentation Elements (AMA + IDSA) ───────────────────────────────

async function loadDocumentationElements() {
  console.log('[CODING SCRAPER] Loading documentation elements (IDSA/AMA) via GPT-4o')
  const SOURCE_URL = 'https://www.idsociety.org/globalassets/idsa/practice-resources/coding-and-payment/2025-em-services-reference-guide_final.pdf'

  const prompt = `You are an expert medical billing consultant. Based on AMA 2021 E&M guidelines and IDSA coding resources, provide specific documentation requirements for each office visit E&M code.

Return JSON only:
{
  "codes": [
    {
      "cpt_code": "99213",
      "note_must_include": ["chief complaint", "relevant history", "physical exam findings", "assessment with diagnosis", "plan of care"],
      "mdm_documentation": "Specific language that should appear in the note to support this level",
      "common_documentation_mistakes": ["Mistake 1 — how to fix it"],
      "example_clinical_scenario": "Brief example of a visit that supports this code level"
    }
  ]
}

Cover codes: 99202, 99203, 99204, 99205, 99212, 99213, 99214, 99215. Be specific and actionable.`

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2500,
    response_format: { type: 'json_object' },
  })

  const raw = JSON.parse(resp.choices[0].message.content)
  const codes = raw.codes || raw.guidelines || (Array.isArray(raw) ? raw : [])

  let saved = 0
  for (const c of codes) {
    const content = [
      `Note must include: ${(c.note_must_include || []).join('; ')}`,
      `MDM documentation: ${c.mdm_documentation || ''}`,
      `Common mistakes: ${(c.common_documentation_mistakes || []).join('; ')}`,
      `Clinical scenario: ${c.example_clinical_scenario || ''}`,
    ].filter(s => !s.endsWith(': ')).join('\n')

    await upsertGuideline({
      source:        'ama_idsa_2025',
      sourceUrl:     SOURCE_URL,
      cptCode:       c.cpt_code,
      guidelineType: 'documentation_elements',
      title:         `${c.cpt_code} Documentation Requirements`,
      content,
      effectiveDate: '2021-01-01',
    })
    saved++
    process.stdout.write('.')
  }
  console.log(`\n[CODING SCRAPER] Documentation elements — ${saved} records saved`)
}

// ── Part 3: CMS Medical Necessity + Preventive Rules ─────────────────────────

async function loadCMSGuidelines() {
  console.log('[CODING SCRAPER] Loading CMS E&M medical necessity guidelines via GPT-4o')
  const SOURCE_URL = 'https://www.cms.gov/outreach-and-education/medicare-learning-network-mln/mlnproducts/downloads/eval-mgmt-serv-guide-icn006764.pdf'

  // Try direct fetch first
  let rawContent = await tryFetch(SOURCE_URL)

  const prompt = rawContent
    ? `Extract Medicare E&M medical necessity requirements from this CMS document. ${rawContent}`
    : `You are a Medicare billing expert. Based on CMS published guidelines for E&M services, provide medical necessity requirements for each office visit code.`

  const medNecPrompt = `${prompt}

Return JSON only:
{
  "codes": [
    {
      "cpt_code": "99213",
      "medical_necessity_criteria": "What clinical conditions / complexity justify this code under Medicare",
      "documentation_requirements": "What Medicare specifically requires in the note",
      "frequency_limitations": "Any Medicare limitations on how often this can be billed",
      "medicare_specific_denials": "Reasons Medicare specifically denies this code"
    }
  ]
}

Cover codes: 99202, 99203, 99204, 99205, 99212, 99213, 99214, 99215.`

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: medNecPrompt }],
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  })

  const raw = JSON.parse(resp.choices[0].message.content)
  const codes = raw.codes || (Array.isArray(raw) ? raw : [])

  let saved = 0
  for (const c of codes) {
    const content = [
      `Medical necessity: ${c.medical_necessity_criteria || ''}`,
      `Documentation required: ${c.documentation_requirements || ''}`,
      `Frequency limitations: ${c.frequency_limitations || 'None specified'}`,
      `Medicare-specific denial triggers: ${c.medicare_specific_denials || ''}`,
    ].join('\n')

    await upsertGuideline({
      source:        'cms_mlm',
      sourceUrl:     SOURCE_URL,
      cptCode:       c.cpt_code,
      guidelineType: 'medical_necessity',
      title:         `${c.cpt_code} Medicare Medical Necessity`,
      content,
      effectiveDate: '2021-01-01',
    })
    saved++
    process.stdout.write('.')
  }
  console.log(`\n[CODING SCRAPER] CMS medical necessity — ${saved} records saved`)

  // Preventive visit rules (99381-99396)
  console.log('[CODING SCRAPER] Loading preventive visit rules')
  const prevPrompt = `You are an expert in preventive medicine coding. Based on AMA 2021 guidelines and Medicare coverage policies for preventive E&M visits, provide coding rules.

Return JSON only:
{
  "codes": [
    {
      "cpt_code": "99395",
      "description": "Preventive visit — established patient, age 18-39",
      "age_range": "18-39",
      "required_components": ["comprehensive history", "comprehensive exam", "age-appropriate preventive counseling"],
      "icd10_diagnosis_codes": ["Z00.00", "Z00.01"],
      "cannot_bill_same_day_with": "When a significant new problem is addressed, split billing rules apply",
      "modifier_25_rule": "When to use modifier 25 for same-day problem-oriented visit"
    }
  ]
}

Cover codes: 99381, 99382, 99383, 99384, 99385, 99391, 99392, 99393, 99394, 99395, 99396.`

  const prevResp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prevPrompt }],
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  })

  const prevRaw = JSON.parse(prevResp.choices[0].message.content)
  const prevCodes = prevRaw.codes || (Array.isArray(prevRaw) ? prevRaw : [])

  let prevSaved = 0
  for (const c of prevCodes) {
    const content = [
      `Description: ${c.description || ''}`,
      `Age range: ${c.age_range || ''}`,
      `Required components: ${(c.required_components || []).join('; ')}`,
      `Supported ICD-10 codes: ${(c.icd10_diagnosis_codes || []).join(', ')}`,
      `Same-day billing: ${c.cannot_bill_same_day_with || ''}`,
      `Modifier 25 rule: ${c.modifier_25_rule || ''}`,
    ].filter(s => !s.endsWith(': ')).join('\n')

    await upsertGuideline({
      source:        'ama_cms_preventive',
      sourceUrl:     SOURCE_URL,
      cptCode:       c.cpt_code,
      guidelineType: 'preventive_rules',
      title:         `${c.cpt_code} Preventive Visit Rules`,
      content,
      effectiveDate: '2021-01-01',
    })
    prevSaved++
    process.stdout.write('.')
  }
  console.log(`\n[CODING SCRAPER] Preventive rules — ${prevSaved} records saved`)
}

// ── Part 4: NCCI Bundling Rules ───────────────────────────────────────────────

async function loadNCCIBundlingRules() {
  console.log('[CODING SCRAPER] Loading NCCI bundling rules for E&M codes via GPT-4o')
  const SOURCE_URL = 'https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-edits'

  // Try to fetch NCCI page for any useful text
  const rawContent = await tryFetch(SOURCE_URL)

  const prompt = `You are an expert in CMS National Correct Coding Initiative (NCCI) edits for primary care billing. Based on published NCCI policy manuals and CMS guidelines, provide bundling rules for E&M codes.

Return JSON only:
{
  "bundling_rules": [
    {
      "cpt_code": "99213",
      "cannot_bill_with": ["CPT code", "..."],
      "reason": "Why these cannot be billed together",
      "denial_code": "CO-97 or other typical denial code",
      "exception": "When modifier 25 or other modifier allows separate billing"
    }
  ]
}

Cover: 99202-99215 plus common ancillary codes that get bundled.
Include rules about: same-day preventive + problem-oriented visit, telephone/online consults, care management codes.
${rawContent ? `CMS page content for context: ${rawContent.slice(0, 2000)}` : ''}`

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  })

  const raw = JSON.parse(resp.choices[0].message.content)
  const rules = raw.bundling_rules || raw.rules || (Array.isArray(raw) ? raw : [])

  let saved = 0
  for (const r of rules) {
    const content = [
      `Cannot bill with: ${(r.cannot_bill_with || []).join(', ')}`,
      `Reason: ${r.reason || ''}`,
      `Denial code: ${r.denial_code || 'CO-97'}`,
      `Exception: ${r.exception || 'None'}`,
    ].join('\n')

    await upsertGuideline({
      source:        'cms_ncci',
      sourceUrl:     SOURCE_URL,
      cptCode:       r.cpt_code,
      guidelineType: 'bundling_rules',
      title:         `${r.cpt_code} NCCI Bundling Rules`,
      content,
    })
    saved++
    process.stdout.write('.')
  }
  console.log(`\n[CODING SCRAPER] NCCI bundling rules — ${saved} records saved`)
}

// ── Part 5: Modifier Rules ────────────────────────────────────────────────────

async function loadModifierRules() {
  console.log('[CODING SCRAPER] Loading E&M modifier rules via GPT-4o')

  const prompt = `You are an expert in CPT modifier rules for E&M billing. Based on AMA and CMS published guidelines, provide modifier rules relevant to office visit E&M codes.

Return JSON only:
{
  "modifier_rules": [
    {
      "cpt_code": "99213",
      "modifier": "25",
      "when_required": "When a significant, separately identifiable E&M service is provided on the same day as a procedure",
      "documentation_required": "What the note must show to support modifier 25",
      "common_denial_when_missing": "What denial code results when modifier is missing"
    }
  ]
}

Cover these modifiers for E&M codes: 25, 57, 59, 24, 26, TC, GT, 95, AI.
For each code/modifier combination that commonly appears in primary care.`

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  })

  const raw = JSON.parse(resp.choices[0].message.content)
  const rules = raw.modifier_rules || raw.rules || (Array.isArray(raw) ? raw : [])

  let saved = 0
  for (const r of rules) {
    const cptCode = r.cpt_code || null
    const content = [
      `Modifier: ${r.modifier}`,
      `When required: ${r.when_required || ''}`,
      `Documentation required: ${r.documentation_required || ''}`,
      `Denial when missing: ${r.common_denial_when_missing || ''}`,
    ].join('\n')

    await upsertGuideline({
      source:        'ama_cms_modifiers',
      sourceUrl:     'https://www.ama-assn.org/practice-management/cpt/cpt-overview-and-code-approval',
      cptCode,
      guidelineType: 'modifier_rules',
      title:         `${cptCode || 'E&M'} Modifier ${r.modifier} Rules`,
      content,
    })
    saved++
    process.stdout.write('.')
  }
  console.log(`\n[CODING SCRAPER] Modifier rules — ${saved} records saved`)
}

// ── Part 6: CARC/RARC Library ─────────────────────────────────────────────────

async function loadCARCLibrary() {
  console.log('[CODING SCRAPER] Loading CARC/RARC library via GPT-4o')
  const SOURCE_URL = 'https://x12.org/codes/claim-adjustment-reason-codes'

  // Batch CARCs into groups of 10 for efficiency
  const batches = []
  for (let i = 0; i < TOP_CARCS.length; i += 10) batches.push(TOP_CARCS.slice(i, i + 10))

  let totalSaved = 0
  for (const batch of batches) {
    const prompt = `You are a healthcare billing expert. Provide detailed information for these CARC (Claim Adjustment Reason Codes): ${batch.join(', ')}.

Based on the official X12 CARC list and primary care billing practice, return JSON only:
{
  "codes": [
    {
      "code": "4",
      "description": "Official X12 description",
      "category": "one of: data_error, coverage_policy, bundling, authorization, timely_filing, other",
      "fix_action": "Specific step-by-step action for the billing team to resolve this",
      "appeal_angle": "How to write an effective appeal for this denial type",
      "related_codes": ["other CARC codes often seen with this one"]
    }
  ]
}`

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    })

    const raw = JSON.parse(resp.choices[0].message.content)
    const codes = raw.codes || (Array.isArray(raw) ? raw : [])

    for (const c of codes) {
      await upsertCarc({
        codeType:    'CARC',
        code:        c.code,
        description: c.description || '',
        category:    c.category || 'other',
        fixAction:   c.fix_action || null,
        appealAngle: c.appeal_angle || null,
        relatedCodes: c.related_codes || [],
      })
      totalSaved++
      process.stdout.write('.')
    }
  }
  console.log(`\n[CODING SCRAPER] CARC codes — ${totalSaved} records saved`)
}

// ── Main entry point ──────────────────────────────────────────────────────────

async function runCodingGuidelinesScraper() {
  console.log('[CODING SCRAPER] Starting — AMA E&M guidelines, NCCI edits, CARC library')

  await loadAMAMDMGuidelines()
  await loadDocumentationElements()
  await loadCMSGuidelines()
  await loadNCCIBundlingRules()
  await loadModifierRules()
  await loadCARCLibrary()

  // Verify counts
  const counts = await db.query(`
    SELECT guideline_type, COUNT(*) as n
    FROM coding_guidelines GROUP BY guideline_type ORDER BY guideline_type
  `)
  const carcCount = await db.query(`SELECT COUNT(*) FROM carc_rarc_codes`)

  console.log('\n[CODING SCRAPER] Complete. Summary:')
  for (const row of counts.rows) console.log(`  ${row.guideline_type}: ${row.n}`)
  console.log(`  CARC codes: ${carcCount.rows[0].count}`)

  return { guidelineRows: counts.rows, carcCount: parseInt(carcCount.rows[0].count) }
}

module.exports = { runCodingGuidelinesScraper }

// Run directly: node src/lib/codingGuidelinesScraper.js
if (require.main === module) {
  runCodingGuidelinesScraper()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1) })
}
