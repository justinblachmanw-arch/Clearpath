'use strict'
require('dotenv').config()

const { fetchTranscript }      = require('./transcriptFetcher')
const { extractDenialPatterns } = require('./patternExtractor')
const { extractKnowledge }      = require('./knowledgeExtractor')
const { getAllTargetVideos }     = require('./channelScraper')
const { upsertRecord, logScraperRun, makeCounter } = require('../scraperUtils')
const { recordMeta }            = require('../../lib/codingIntelligenceUtils')

// Processes one video — fetch transcript, run Mode 1 + Mode 2, return results
// If pool=null, skips all DB writes (test mode)
async function processVideo(videoId, videoMeta = {}, pool = null) {
  console.log(`[YOUTUBE] Processing video: ${videoId} — ${videoMeta.title || ''}`)

  const transcriptResult = await fetchTranscript(videoId)
  if (!transcriptResult) {
    console.warn(`[YOUTUBE] No transcript for ${videoId} — skipping`)
    return { videoId, error: 'no_transcript', patterns: [], knowledge: null }
  }

  const { text } = transcriptResult
  console.log(`[YOUTUBE] Transcript: ${text.length} chars, ${transcriptResult.segmentCount} segments`)

  // Mode 1 — denial patterns
  const patterns = await extractDenialPatterns(text, { ...videoMeta, videoId })
  console.log(`[YOUTUBE] Mode 1: ${patterns.length} denial patterns extracted`)

  // Mode 2 — declarative knowledge
  const knowledge = await extractKnowledge(text, { ...videoMeta, videoId })
  const knowledgeCount = Object.values(knowledge).reduce((s, arr) => s + arr.length, 0)
  console.log(`[YOUTUBE] Mode 2: ${knowledgeCount} knowledge items extracted`)

  if (pool) {
    await writeToDb(pool, videoId, videoMeta, patterns, knowledge)
  }

  return { videoId, transcript: text, patterns, knowledge }
}

async function writeToDb(pool, videoId, videoMeta, patterns, knowledge) {
  const sourceUrl  = `https://www.youtube.com/watch?v=${videoId}`
  const sourceDate = videoMeta.publishedAt ? new Date(videoMeta.publishedAt) : new Date()
  const META       = recordMeta('youtube_community', sourceUrl, sourceDate, 1)

  const counter = makeCounter()

  // Mode 1 — denial_patterns table
  for (const p of patterns) {
    const data = {
      scenario_title:      p.scenario_title,
      scenario_description: p.scenario_description,
      cpt_codes:           p.cpt_codes,
      denial_category:     p.denial_category,
      denial_reason:       p.denial_reason,
      fix_description:     p.fix_description,
      prevention_tip:      p.prevention_tip,
      is_verified:         false,
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'denial_patterns',
      { scenario_title: p.scenario_title, payer_code: null }, data))
  }

  // Mode 2 — payer_rules
  for (const r of knowledge.payer_rules) {
    if (!r.cpt_code || !r.rule_title) continue
    const payerCode = r.payer_name === 'general' ? null : r.payer_name.toUpperCase().replace(/\s+/g, '_')
    const data = {
      payer_code:       payerCode,
      payer_name:       r.payer_name,
      cpt_code:         r.cpt_code,
      rule_type:        r.rule_type || 'documentation',
      rule_title:       r.rule_title,
      rule_description: r.rule_description,
      rule_severity:    r.rule_severity || 'soft',
      is_behavioral:    true,
      is_stated:        false,
      is_published:     false,
      ...META,
    }
    counter.tally(await upsertRecord(pool, 'payer_rules',
      { payer_code: payerCode, cpt_code: r.cpt_code, rule_title: r.rule_title }, data))
  }

  // Mode 2 — cpt_knowledge edge_cases updates
  for (const r of knowledge.cpt_rules) {
    if (!r.cpt_code) continue
    try {
      await pool.query(`
        UPDATE cpt_knowledge
        SET edge_cases = COALESCE(edge_cases, '') || $1,
            updated_at = NOW()
        WHERE cpt_code = $2
      `, [`\n\nYouTube (${videoMeta.channel || 'unknown'}): ${r.rule_summary}`, r.cpt_code])
    } catch (err) { /* non-fatal */ }
  }

  // Mode 2 — modifier_rules updates
  for (const r of knowledge.modifier_rules) {
    if (!r.modifier_code) continue
    try {
      await pool.query(`
        UPDATE modifier_rules
        SET common_mistakes = COALESCE(common_mistakes, '') || $1,
            updated_at = NOW()
        WHERE modifier_code = $2
      `, [`\n\nYouTube (${videoMeta.channel || 'unknown'}): ${r.rule_summary}`, r.modifier_code])
    } catch (err) { /* non-fatal */ }
  }

  await logScraperRun(pool, `youtube_${videoId}`, counter)
  return counter
}

// Test mode — single video, no DB writes, prints full output
async function runTestMode(videoId = 'cWAZ6Dr1vsM') {
  console.log('\n[YOUTUBE TEST MODE] =============================================')
  console.log(`[YOUTUBE TEST MODE] Video: ${videoId}`)
  console.log('[YOUTUBE TEST MODE] NO DB WRITES')
  console.log('[YOUTUBE TEST MODE] =============================================\n')

  const videoMeta = {
    videoId,
    title:   '6 MORE Examples of Super Common Claim Denials',
    channel: 'CCO Academy',
  }

  const result = await processVideo(videoId, videoMeta, null) // null = no DB

  console.log('\n[YOUTUBE TEST MODE] ===== RESULTS =====')
  console.log(`Transcript length: ${result.transcript ? result.transcript.length : 0} chars`)

  if (result.error) {
    console.log(`ERROR: ${result.error}`)
    return result
  }

  console.log(`\nMode 1 — Denial Patterns (${result.patterns.length} found):`)
  result.patterns.forEach((p, i) => {
    console.log(`\n  [${i + 1}] ${p.scenario_title}`)
    console.log(`       CPT: ${p.cpt_code}  |  Category: ${p.denial_category}  |  Confidence: ${p.confidence}`)
    console.log(`       Reason: ${p.denial_reason}`)
    console.log(`       Fix: ${p.fix_description}`)
    if (p.source_quote) console.log(`       Quote: "${p.source_quote.slice(0, 120)}..."`)
  })

  const k = result.knowledge
  const total = Object.values(k).reduce((s, arr) => s + arr.length, 0)
  console.log(`\nMode 2 — Knowledge Items (${total} total):`)
  console.log(`  CPT rules:      ${k.cpt_rules.length}`)
  console.log(`  Modifier rules: ${k.modifier_rules.length}`)
  console.log(`  Payer rules:    ${k.payer_rules.length}`)
  console.log(`  Context rules:  ${k.context_rules.length}`)
  console.log(`  ICD-10 rules:   ${k.icd10_rules.length}`)
  console.log(`  Policy changes: ${k.policy_changes.length}`)

  if (k.cpt_rules.length) {
    console.log('\n  Sample CPT rules:')
    k.cpt_rules.slice(0, 3).forEach(r => console.log(`    [${r.cpt_code}] ${r.rule_summary}`))
  }
  if (k.payer_rules.length) {
    console.log('\n  Sample payer rules:')
    k.payer_rules.slice(0, 3).forEach(r => console.log(`    [${r.payer_name}/${r.cpt_code}] ${r.rule_title}`))
  }

  console.log('\n[YOUTUBE TEST MODE] ==========================================\n')
  return result
}

// Full run — disabled until test verified
async function runYoutubeScraper(pool) {
  throw new Error('[YOUTUBE] Full scraper run is DISABLED — run test mode first and verify output before enabling')
  // Uncomment when ready:
  // const videos  = await getAllTargetVideos()
  // const counter = makeCounter()
  // for (const v of videos) {
  //   try {
  //     await processVideo(v.videoId, v, pool)
  //   } catch (err) {
  //     console.error(`[YOUTUBE] processVideo failed for ${v.videoId}: ${err.message}`)
  //   }
  // }
  // return counter
}

module.exports = { processVideo, runTestMode, runYoutubeScraper }
