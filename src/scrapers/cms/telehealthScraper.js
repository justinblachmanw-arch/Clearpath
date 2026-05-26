'use strict'
require('dotenv').config()

const { fetchPage, upsertRecord, logScraperRun, cleanText, makeCounter } = require('../scraperUtils')
const { recordMeta, isTrumpEraChange } = require('../../lib/codingIntelligenceUtils')

const SOURCE_URL  = 'https://telehealth.hhs.gov/providers/billing-and-reimbursement/billing-and-coding-medicare-fee-for-service-claims'
const SOURCE_DATE = new Date('2025-10-01')
const META        = recordMeta('hhs_direct', SOURCE_URL, SOURCE_DATE, 1)

const EM_CODES = ['99202','99203','99204','99205','99211','99212','99213','99214','99215']

const TELEHEALTH_MODIFIERS = [
  {
    code: '95',
    name: 'Synchronous Telemedicine Service Rendered via Real-Time Interactive Audio and Video Telecommunications System',
    description: 'Identifies services rendered via real-time interactive audio and video telecommunications. Required for most Medicare telehealth visits.',
    use_case: 'Append to E&M codes when service delivered via real-time audio AND video. Patient may be in any location post-2025.',
    when_required: 'Required on all Medicare telehealth E&M claims using POS 02 or POS 10',
    telehealth_specific: true,
    telehealth_guidance: 'CMS requires modifier 95 on telehealth claims to identify real-time audio-video services. Do not use for audio-only.',
    medicare_guidance: 'HHS/CMS: Modifier 95 required on Medicare FFS telehealth claims for synchronous audio-video services.',
  },
  {
    code: 'GT',
    name: 'Via Interactive Audio and Video Telecommunication Systems',
    description: 'Legacy telehealth modifier — via interactive audio and video telecommunications systems. Use modifier 95 for Medicare FFS; GT still used for some Medicaid programs.',
    use_case: 'Primarily used in Medicaid and some commercial. Medicare FFS prefers modifier 95.',
    when_required: 'Check payer-specific guidance. Medicare FFS: use 95 not GT.',
    telehealth_specific: true,
    telehealth_guidance: 'HHS: For Medicare FFS telehealth, modifier 95 is preferred over GT. GT may still apply for certain Medicaid programs.',
    medicare_guidance: 'Medicare FFS: use modifier 95. GT acceptable but verify with specific MAC.',
  },
  {
    code: '93',
    name: 'Synchronous Telemedicine Service Rendered via Telephone or Other Real-Time Interactive Audio-Only Telecommunications System',
    description: 'Audio-only telehealth modifier. Required when the patient cannot or does not consent to video. COVID flexibilities sunset — verify current Medicare coverage.',
    use_case: 'Use when telehealth service delivered via audio-only (telephone). Patient unable or unwilling to use video.',
    when_required: 'Audio-only visits require modifier 93 AND modifier FQ for Medicare behavioral health services.',
    telehealth_specific: true,
    audio_only_specific: true,
    telehealth_guidance: 'HHS: Audio-only (modifier 93) has limited Medicare coverage post-COVID flexibilities. Behavioral health audio-only (with FQ) has broader coverage.',
    medicare_guidance: 'CMS: Audio-only E&M coverage restricted after September 30 2025. Verify current LCD/NCD before billing.',
  },
  {
    code: 'FQ',
    name: 'Service Furnished Using Audio-Only Communication Technology',
    description: 'Required with modifier 93 for behavioral health audio-only telehealth services under Medicare.',
    use_case: 'Behavioral health audio-only services. Must be appended with modifier 93.',
    when_required: 'Required for behavioral health telehealth services delivered via audio-only under Medicare when patient is in the home.',
    telehealth_specific: true,
    audio_only_specific: true,
    telehealth_guidance: 'HHS: FQ required with 93 for behavioral health audio-only Medicare services. Not for general E&M audio-only.',
    medicare_guidance: 'CMS: Modifier FQ indicates audio-only technology used. Required companion to modifier 93 for behavioral health.',
  },
  {
    code: 'GQ',
    name: 'Via Asynchronous Telecommunications System',
    description: 'Store-and-forward telehealth. Used in federal telemedicine demonstration projects. Limited Medicare FFS applicability.',
    use_case: 'Asynchronous (store-and-forward) telehealth — image review, remote monitoring data review.',
    when_required: 'Federal demonstration projects only for Medicare. Verify coverage before use.',
    telehealth_specific: true,
    medicare_guidance: 'CMS: GQ applies to asynchronous telehealth in demonstration programs. Not broadly covered under Medicare FFS.',
  },
]

const POS_RULES = [
  {
    pos_code: '02',
    pos_description: 'Telehealth Provided Other than in Patient\'s Home',
    rule_description: 'Use POS 02 when the patient receives telehealth services at a location other than their home — clinic, hospital, skilled nursing facility, etc.',
    common_errors: 'Using POS 02 when patient is at home (should be POS 10); using POS 11 (office) for telehealth visits',
    required_modifiers: ['95'],
  },
  {
    pos_code: '10',
    pos_description: 'Telehealth Provided in Patient\'s Home',
    rule_description: 'Use POS 10 when the patient receives telehealth services in their home. Effective January 1 2022. Reimbursement may differ from POS 02 — verify current rates.',
    common_errors: 'Using POS 02 when patient is at home; confusing POS 10 with POS 12 (patient\'s home for non-telehealth)',
    required_modifiers: ['95'],
  },
]

async function scrapeTelehealth(pool) {
  const counter = makeCounter()

  let text = null
  try {
    const html = await fetchPage(SOURCE_URL)
    text = html ? cleanText(html.replace(/<[^>]+>/g, ' ')) : null
  } catch (err) {
    counter.notes = [`Fetch failed: ${err.message} — seeding from embedded telehealth rules`]
  }

  // ── modifier_rules: telehealth modifiers ──────────────────────────────────
  for (const mod of TELEHEALTH_MODIFIERS) {
    const data = {
      modifier_code:          mod.code,
      modifier_name:          mod.name,
      description:            mod.description,
      use_case:               mod.use_case,
      when_required:          mod.when_required,
      telehealth_specific:    true,
      telehealth_guidance:    mod.telehealth_guidance,
      medicare_guidance:      mod.medicare_guidance,
      common_cpt_codes:       EM_CODES,
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'modifier_rules', { modifier_code: mod.code }, data))
  }

  // ── place_of_service_rules ────────────────────────────────────────────────
  for (const pos of POS_RULES) {
    for (const cpt of EM_CODES) {
      const data = {
        pos_code:            pos.pos_code,
        pos_description:     pos.pos_description,
        cpt_code:            cpt,
        rule_description:    pos.rule_description,
        common_errors:       pos.common_errors,
        required_modifiers:  pos.required_modifiers,
        telehealth_specific: true,
        ...META,
      }
      counter.tally(await upsertRecord(pool, 'place_of_service_rules',
        { pos_code: pos.pos_code, cpt_code: cpt }, data))
    }
  }

  // ── cpt_knowledge: telehealth fields for E&M codes ────────────────────────
  for (const cpt of EM_CODES) {
    const data = {
      cpt_code:             cpt,
      telehealth_allowed:   true,
      telehealth_modifiers: ['95','GT'],
      telehealth_pos_codes: ['02','10'],
      telehealth_notes:     'Covered under Medicare telehealth. Append modifier 95 and use POS 02 (non-home) or POS 10 (home). COVID geographic restrictions reinstated October 1 2025.',
      audio_only_allowed:   false,
      audio_only_modifiers: ['93','FQ'],
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'cpt_knowledge', { cpt_code: cpt }, data))
  }

  // ── policy_change_log: COVID telehealth sunset ────────────────────────────
  const covidSunsetData = {
    change_date:        '2025-09-30',
    payer_code:         'MEDICARE',
    cpt_code:           null,
    change_type:        'telehealth_change',
    change_title:       'COVID telehealth flexibilities sunset September 30 2025',
    change_description: 'CMS COVID-era telehealth flexibilities expired September 30 2025. Geographic restrictions on originating site reinstated. Audio-only E&M coverage significantly restricted. POS 10 (patient home) remains permanent.',
    impact_level:       'high',
    old_rule:           'During COVID PHE: any geographic location; expanded audio-only; no originating site requirement',
    new_rule:           'Post-sunset: geographic restrictions reinstated for most services; audio-only E&M restricted; behavioral health audio-only retained with FQ modifier; POS 10 permanent',
    action_required:    'Audit telehealth billing workflows. Remove any COVID-era blanket audio-only billing. Verify each service has proper POS and modifier.',
    effective_date:     '2025-10-01',
    is_temporary:       false,
    administration:     'trump_2025',
    trump_era_change:   true,
    source_url:         SOURCE_URL,
    verified:           true,
  }
  counter.tally(await upsertRecord(pool, 'policy_change_log',
    { change_title: 'COVID telehealth flexibilities sunset September 30 2025' }, covidSunsetData))

  // ── appointment_type_rules: audio-only ────────────────────────────────────
  const audioOnlyData = {
    appointment_type:           'audio_only',
    cpt_code:                   null,
    rule_description:           'Audio-only telehealth (modifier 93) has restricted Medicare coverage after COVID flexibilities sunset. Behavioral health services retain audio-only coverage with FQ modifier.',
    required_modifiers:         ['93','FQ'],
    documentation_requirements: 'Must document: patient unable or unwilling to use video; clinical appropriateness of audio-only; patient consent. Behavioral health only post-October 2025.',
    common_errors:              'Billing audio-only for general E&M after COVID sunset. Using 93 without FQ for behavioral health.',
    ...META,
  }
  counter.tally(await upsertRecord(pool, 'appointment_type_rules',
    { appointment_type: 'audio_only', cpt_code: null }, audioOnlyData))

  await logScraperRun(pool, 'telehealth', {
    ...counter,
    notes: Array.isArray(counter.notes) ? counter.notes.join('; ') : null,
  })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapeTelehealth }
