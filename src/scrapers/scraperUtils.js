'use strict'
require('dotenv').config()

const axios    = require('axios')
const pdfParse = require('pdf-parse')
const Papa     = require('papaparse')

const RETRY_COUNT  = 3
const RETRY_DELAY  = 2000

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchPage(url) {
  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const res = await axios.get(url, {
        timeout: 30000,
        headers: { 'User-Agent': 'ClearpathHealthBot/1.0 (healthcare billing research)' },
      })
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    } catch (err) {
      console.warn(`[SCRAPER] fetchPage attempt ${i + 1} failed for ${url}: ${err.message}`)
      if (i < RETRY_COUNT - 1) await sleep(RETRY_DELAY)
    }
  }
  return null
}

async function fetchPDF(url) {
  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: { 'User-Agent': 'ClearpathHealthBot/1.0 (healthcare billing research)' },
      })
      const data = await pdfParse(Buffer.from(res.data))
      return data.text
    } catch (err) {
      console.warn(`[SCRAPER] fetchPDF attempt ${i + 1} failed for ${url}: ${err.message}`)
      if (i < RETRY_COUNT - 1) await sleep(RETRY_DELAY)
    }
  }
  return null
}

async function fetchCSV(url) {
  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const res = await axios.get(url, {
        timeout: 60000,
        headers: { 'User-Agent': 'ClearpathHealthBot/1.0 (healthcare billing research)' },
      })
      const result = Papa.parse(res.data, { header: true, skipEmptyLines: true })
      return result.data
    } catch (err) {
      console.warn(`[SCRAPER] fetchCSV attempt ${i + 1} failed for ${url}: ${err.message}`)
      if (i < RETRY_COUNT - 1) await sleep(RETRY_DELAY)
    }
  }
  return null
}

// ── Upsert with field change tracking ─────────────────────────────────────────

async function upsertRecord(pool, table, uniqueKey, data) {
  const keyCol = Object.keys(uniqueKey)[0]
  const keyVal = Object.values(uniqueKey)[0]

  // For composite keys
  const keyEntries = Object.entries(uniqueKey)
  const whereClause = keyEntries.map((e, i) => `${e[0]} = $${i + 1}`).join(' AND ')
  const whereVals   = keyEntries.map(e => e[1])

  let existing
  try {
    const res = await pool.query(
      `SELECT * FROM ${table} WHERE ${whereClause} LIMIT 1`,
      whereVals
    )
    existing = res.rows[0] || null
  } catch (err) {
    console.error(`[SCRAPER] upsertRecord select failed on ${table}:`, err.message)
    return 'error'
  }

  if (!existing) {
    const cols = Object.keys(data).join(', ')
    const vals = Object.values(data)
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ')
    try {
      await pool.query(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`, vals)
      return 'inserted'
    } catch (err) {
      console.error(`[SCRAPER] insert failed on ${table}:`, err.message)
      return 'error'
    }
  }

  // Detect changed fields and update
  const changed = {}
  for (const [field, newVal] of Object.entries(data)) {
    const oldVal = existing[field]
    const oldStr = oldVal === null || oldVal === undefined ? null : String(oldVal)
    const newStr = newVal === null || newVal === undefined ? null : String(newVal)
    if (oldStr !== newStr) changed[field] = { old: oldStr, new: newStr }
  }

  if (!Object.keys(changed).length) return 'skipped'

  const setCols = Object.keys(changed).map((c, i) => `${c} = $${i + 1}`).join(', ')
  const setVals = Object.values(changed).map(c => c.new)
  const idxOffset = setVals.length + 1
  const whereWithId = keyEntries.map((e, i) => `${e[0]} = $${idxOffset + i}`).join(' AND ')

  try {
    await pool.query(
      `UPDATE ${table} SET ${setCols}, updated_at = NOW() WHERE ${whereWithId}`,
      [...setVals, ...whereVals]
    )

    // Record each changed field
    for (const [field, vals] of Object.entries(changed)) {
      await pool.query(
        `INSERT INTO field_change_history
           (table_name, record_id, field_name, old_value, new_value, change_source)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [table, existing.id, field, vals.old, vals.new, 'scraper']
      ).catch(() => {}) // non-fatal
    }

    return 'updated'
  } catch (err) {
    console.error(`[SCRAPER] update failed on ${table}:`, err.message)
    return 'error'
  }
}

// ── Logging ───────────────────────────────────────────────────────────────────

async function ensureScraperLog(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scraper_log (
      id               SERIAL PRIMARY KEY,
      scraper_name     VARCHAR(100),
      run_date         TIMESTAMP DEFAULT NOW(),
      records_inserted INTEGER DEFAULT 0,
      records_updated  INTEGER DEFAULT 0,
      records_skipped  INTEGER DEFAULT 0,
      errors           INTEGER DEFAULT 0,
      error_details    JSONB,
      duration_ms      INTEGER,
      notes            TEXT
    )
  `)
}

async function logScraperRun(pool, scraperName, results) {
  try {
    await ensureScraperLog(pool)
    await pool.query(
      `INSERT INTO scraper_log
         (scraper_name, records_inserted, records_updated, records_skipped,
          errors, error_details, duration_ms, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        scraperName,
        results.inserted    || 0,
        results.updated     || 0,
        results.skipped     || 0,
        results.errors      || 0,
        results.error_details ? JSON.stringify(results.error_details) : null,
        results.duration_ms || null,
        results.notes       || null,
      ]
    )
  } catch (err) {
    console.error(`[SCRAPER] logScraperRun failed:`, err.message)
  }
}

// ── Text extraction helpers ───────────────────────────────────────────────────

function extractCPTCodes(text) {
  if (!text) return []
  const matches = text.match(/\b(9[0-9]{4}|G[0-9]{4}|[A-Z][0-9]{4})\b/g) || []
  return [...new Set(matches)]
}

function extractICD10Codes(text) {
  if (!text) return []
  const matches = text.match(/\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)\b/g) || []
  return [...new Set(matches)]
}

function extractCARCCodes(text) {
  if (!text) return []
  const matches = text.match(/\b(?:CO|PR|OA|PI)-?\d+\b/gi) || []
  return [...new Set(matches.map(c => c.toUpperCase()))]
}

function cleanText(text) {
  if (!text) return ''
  return text
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .trim()
}

function detectPolicyChange(text) {
  if (!text) return { isChange: false, effectiveDate: null }
  const cutoff = new Date('2025-01-20')

  // Look for dates in text
  const datePatterns = [
    /(?:effective|on|as of|beginning|starting)\s+([A-Z][a-z]+ \d{1,2},?\s+202[5-9])/gi,
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(202[5-9])\b/gi,
    /\b(202[5-9])-(\d{2})-(\d{2})\b/g,
  ]

  for (const pattern of datePatterns) {
    const match = pattern.exec(text)
    if (match) {
      const parsed = new Date(match[0].replace(/effective|on|as of|beginning|starting/gi, '').trim())
      if (!isNaN(parsed) && parsed >= cutoff) {
        return { isChange: true, effectiveDate: parsed }
      }
    }
  }

  return { isChange: false, effectiveDate: null }
}

// ── Accumulator helper ────────────────────────────────────────────────────────
// Passed into each scraper to track insert/update/skip/error counts

function makeCounter() {
  const c = { inserted: 0, updated: 0, skipped: 0, errors: 0, notes: [] }
  c.tally = (result) => {
    if (result === 'inserted') c.inserted++
    else if (result === 'updated') c.updated++
    else if (result === 'skipped') c.skipped++
    else c.errors++
  }
  return c
}

const fetchPDFRaw = fetchPDF

module.exports = {
  fetchPage,
  fetchPDF,
  fetchPDFRaw,
  fetchCSV,
  upsertRecord,
  logScraperRun,
  extractCPTCodes,
  extractICD10Codes,
  extractCARCCodes,
  cleanText,
  detectPolicyChange,
  makeCounter,
}
