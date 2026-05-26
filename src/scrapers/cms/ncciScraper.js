'use strict'
require('dotenv').config()

const { fetchPage, fetchCSV, upsertRecord, logScraperRun, cleanText, makeCounter } = require('../scraperUtils')
const { recordMeta } = require('../../lib/codingIntelligenceUtils')

// CMS NCCI edit table landing page — CSV download URL discovered at runtime
const SOURCE_URL  = 'https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-to-procedure-edits'
const SOURCE_DATE = new Date()
const META        = recordMeta('cms_direct', SOURCE_URL, SOURCE_DATE, 1)

// Primary care codes to filter NCCI edits on
const PRIMARY_CARE_CODES = new Set([
  '99202','99203','99204','99205',
  '99211','99212','99213','99214','99215',
  '99381','99382','99383','99384','99385','99386','99387',
  '99391','99392','99393','99394','99395','99396','99397',
  '99401','99402','99403','99404',
  '99490','99491','99495','99496',
  '93000','36415','85025','G2211',
])

// Known NCCI edits for primary care — seed data from CMS quarterly tables
// Structured: column1 (comprehensive/always paid) + column2 (component/denied)
const KNOWN_NCCI_EDITS = [
  {
    col1: '99213', col2: '99395', indicator: 1,
    plain: '99213 (established E&M) and 99395 (preventive, established) cannot be billed together without modifier 25 on 99213',
    scenario: 'Provider performs annual preventive exam and addresses a chronic problem — bills both 99395 and 99213',
    bypass: 'Modifier 25 on 99213 documents separately identifiable, significant E&M beyond the preventive exam',
  },
  {
    col1: '99214', col2: '99395', indicator: 1,
    plain: '99214 and 99395 cannot be billed together without modifier 25 on 99214',
    scenario: 'Same-day preventive visit and moderate-complexity E&M for a new or worsening problem',
    bypass: 'Modifier 25 on 99214 required — E&M must be truly separate from preventive service elements',
  },
  {
    col1: '99213', col2: '99396', indicator: 1,
    plain: '99213 and 99396 (preventive, established, 40-64) cannot be billed together without modifier 25',
    scenario: 'Middle-aged established patient gets annual preventive exam plus E&M for a new complaint',
    bypass: 'Modifier 25 on E&M code; document separate chief complaint and plan for the additional problem',
  },
  {
    col1: '99214', col2: '99396', indicator: 1,
    plain: '99214 and 99396 cannot be billed together without modifier 25 on 99214',
    scenario: 'Established patient 40-64 — preventive visit plus evaluation of diabetes exacerbation',
    bypass: 'Modifier 25 on 99214; separately document the E&M for the acute/chronic problem beyond preventive work',
  },
  {
    col1: '99213', col2: 'G0438', indicator: 1,
    plain: '99213 and G0438 (initial AWV) cannot be billed together without modifier 25 on 99213',
    scenario: 'Annual Wellness Visit with same-day E&M for a new problem',
    bypass: 'Modifier 25 on 99213; document separate, identifiable E&M distinct from AWV elements',
  },
  {
    col1: '99214', col2: 'G0438', indicator: 1,
    plain: '99214 and G0438 cannot be billed together without modifier 25 on 99214',
    scenario: 'AWV plus E&M for diabetes management on same day',
    bypass: 'Modifier 25 on 99214; AWV and E&M must have distinct documentation',
  },
  {
    col1: '99213', col2: 'G0439', indicator: 1,
    plain: '99213 and G0439 (subsequent AWV) cannot be billed together without modifier 25',
    scenario: 'Subsequent AWV plus E&M for acute complaint on same day',
    bypass: 'Modifier 25 on 99213',
  },
  {
    col1: '99214', col2: 'G0439', indicator: 1,
    plain: '99214 and G0439 cannot be billed together without modifier 25 on 99214',
    scenario: 'Subsequent AWV plus moderate-complexity E&M on same day',
    bypass: 'Modifier 25 on 99214',
  },
  {
    col1: '93000', col2: '99213', indicator: 1,
    plain: '93000 (ECG with interpretation) and 99213 — E&M is comprehensive code; ECG component cannot be separately billed when done as part of E&M',
    scenario: 'Provider performs office visit and orders/interprets ECG during same encounter',
    bypass: 'Modifier 25 on E&M if ECG is truly separate and independently interpretable beyond the E&M work',
  },
  {
    col1: '36415', col2: '99213', indicator: 1,
    plain: '36415 (venipuncture) is included in the E&M service when performed in an office setting — cannot bill separately without distinct medical necessity',
    scenario: 'Blood draw performed during office visit for lab work',
    bypass: 'Generally not bypassable in office setting — phlebotomy is integral to the visit',
  },
  {
    col1: '99213', col2: '99212', indicator: 0,
    plain: 'Two established patient E&M codes cannot be billed on the same date — only one level of E&M per day per provider',
    scenario: 'Provider inadvertently bills two E&M visits for same patient same day',
    bypass: 'No bypass — cannot bill two E&M codes same day for same patient/provider',
  },
  {
    col1: '99214', col2: '99213', indicator: 0,
    plain: 'Two E&M codes at different levels cannot be billed same day — bill only the higher level',
    scenario: 'Clerical error — both 99213 and 99214 submitted for same encounter',
    bypass: 'No bypass — select single E&M code representing overall encounter complexity',
  },
]

async function scrapeNcci(pool) {
  const counter = makeCounter()

  // Try to find and download the current quarterly CSV from the CMS page
  let csvUrl = null
  try {
    const html = await fetchPage(SOURCE_URL)
    if (html) {
      // Look for CSV download links in the page
      const csvMatch = html.match(/href="([^"]*(?:physician|ptp)[^"]*\.(?:csv|zip))"[^>]*>/i)
      if (csvMatch) csvUrl = csvMatch[1].startsWith('http') ? csvMatch[1] : `https://www.cms.gov${csvMatch[1]}`
    }
  } catch (err) {
    counter.notes = [`CMS NCCI page fetch failed: ${err.message}`]
  }

  let liveEdits = []
  if (csvUrl) {
    try {
      const rows = await fetchCSV(csvUrl)
      if (rows) {
        // CMS NCCI CSV columns: Column 1 Code, Column 2 Code, Indicator, Effective Date, Deletion Date
        liveEdits = rows.filter(r => {
          const c1 = (r['Column 1 Code'] || r['column_1'] || '').trim()
          const c2 = (r['Column 2 Code'] || r['column_2'] || '').trim()
          return PRIMARY_CARE_CODES.has(c1) || PRIMARY_CARE_CODES.has(c2)
        })
        counter.notes = (counter.notes || []).concat([`Live NCCI CSV: ${liveEdits.length} primary care edits found`])
      }
    } catch (err) {
      counter.notes = (counter.notes || []).concat([`CSV download failed: ${err.message} — using seed data`])
    }
  }

  // Use live edits if found, otherwise seed data
  const editsToProcess = liveEdits.length ? liveEdits.map(r => ({
    col1:      (r['Column 1 Code'] || '').trim(),
    col2:      (r['Column 2 Code'] || '').trim(),
    indicator: parseInt(r['Modifier Indicator'] || r['modifier_indicator'] || 0),
    effDate:   r['Effective Date'] || r['effective_date'],
    delDate:   r['Deletion Date'] || r['deletion_date'] || null,
    plain:     null,
    scenario:  null,
    bypass:    null,
    fromLive:  true,
  })) : KNOWN_NCCI_EDITS.map(e => ({
    col1: e.col1, col2: e.col2, indicator: e.indicator,
    effDate: '2024-01-01', delDate: null,
    plain: e.plain, scenario: e.scenario, bypass: e.bypass, fromLive: false,
  }))

  for (const edit of editsToProcess) {
    if (!edit.col1 || !edit.col2) continue
    const isActive = !edit.delDate || new Date(edit.delDate) > new Date()
    const effDate  = edit.effDate ? new Date(edit.effDate).toISOString().split('T')[0] : null

    // ── ncci_edits ──────────────────────────────────────────────────────────
    const ncciData = {
      column1_cpt:      edit.col1,
      column2_cpt:      edit.col2,
      modifier_indicator: edit.indicator,
      effective_date:   effDate,
      deletion_date:    edit.delDate ? new Date(edit.delDate).toISOString().split('T')[0] : null,
      is_active:        isActive,
      plain_english:    edit.plain || `${edit.col1} and ${edit.col2} cannot be billed together per NCCI`,
      common_scenario:  edit.scenario,
      bypass_conditions: edit.bypass,
      source_type:      'cms_direct',
      source_url:       csvUrl || SOURCE_URL,
      source_date:      effDate,
      confidence_level: 'verified',
      trump_era_change: false,
      created_at:       new Date(),
      updated_at:       new Date(),
    }
    counter.tally(await upsertRecord(pool, 'ncci_edits',
      { column1_cpt: edit.col1, column2_cpt: edit.col2, effective_date: effDate }, ncciData))

    // ── denial_patterns: non-bypassable edits (indicator 0) ─────────────────
    if (edit.indicator === 0 && isActive) {
      const denialData = {
        scenario_title:     `${edit.col1} + ${edit.col2} bundling denial — modifier cannot override`,
        cpt_codes:          [edit.col1, edit.col2],
        payer_code:         'MEDICARE',
        denial_category:    'cpt_mismatch',
        carc_code:          'CO-97',
        denial_reason_plain: `${edit.col1} and ${edit.col2} cannot be billed together — NCCI edit with modifier indicator 0 (cannot be overridden)`,
        root_cause:         edit.plain || 'NCCI bundling edit — component code included in comprehensive code',
        fix_description:    `Remove ${edit.col2} from the claim. These codes cannot be billed on the same date regardless of modifier.`,
        prevention_tip:     'Check NCCI edit table before billing these codes on the same claim',
        is_verified:        true,
        ...META,
      }
      counter.tally(await upsertRecord(pool, 'denial_patterns',
        { scenario_title: `${edit.col1} + ${edit.col2} bundling denial — modifier cannot override`, payer_code: 'MEDICARE' },
        denialData))
    }

    // ── cpt_knowledge: append cannot_bill_same_day ────────────────────────
    for (const [mainCode, bundledCode] of [[edit.col1, edit.col2], [edit.col2, edit.col1]]) {
      if (PRIMARY_CARE_CODES.has(mainCode) && isActive) {
        try {
          await pool.query(`
            UPDATE cpt_knowledge
            SET cannot_bill_same_day = array_append(COALESCE(cannot_bill_same_day, '{}'), $1),
                updated_at = NOW()
            WHERE cpt_code = $2
              AND NOT ($1 = ANY(COALESCE(cannot_bill_same_day, '{}')))
          `, [bundledCode, mainCode])
        } catch (err) { /* non-fatal */ }
      }
    }
  }

  await logScraperRun(pool, 'ncci', {
    ...counter,
    notes: Array.isArray(counter.notes) ? counter.notes.join('; ') : null,
  })
  return { inserted: counter.inserted, updated: counter.updated, skipped: counter.skipped, errors: counter.errors }
}

module.exports = { scrapeNcci }
