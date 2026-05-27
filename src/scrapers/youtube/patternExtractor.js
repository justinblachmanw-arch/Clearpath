'use strict'
require('dotenv').config()

const OpenAI = require('openai')

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const DENIAL_CATEGORIES = [
  'diagnostic_eligibility',
  'intensity_justification',
  'likely_scope_violation',
  'cpt_mismatch',
]

// Mode 1 — extract concrete denial scenarios from transcript
// Requires CPT + outcome + reason (all three or skip)
async function extractDenialPatterns(transcript, videoMeta = {}) {
  if (!transcript || transcript.length < 200) return []

  const prompt = `You are analyzing a medical billing / coding YouTube video transcript to extract denial pattern examples.

Video: ${videoMeta.title || 'Unknown'}
Channel: ${videoMeta.channel || 'Unknown'}

Transcript (excerpt):
${transcript.slice(0, 6000)}

Extract ONLY concrete denial scenarios that include ALL THREE of:
1. A specific CPT code (or code range)
2. A clear outcome (denied, flagged, downcoded, etc.)
3. A clear reason (what caused the denial)

Skip vague or incomplete examples.

Return a JSON array. Each item:
{
  "cpt_code": "string — specific CPT or G-code (e.g. 99214)",
  "cpt_codes": ["array if multiple CPTs mentioned"],
  "scenario_title": "short title under 80 chars",
  "scenario_description": "what happened — 1-3 sentences",
  "denial_category": one of ${JSON.stringify(DENIAL_CATEGORIES)},
  "denial_reason": "the specific reason for denial",
  "fix_description": "how to fix or avoid this denial",
  "prevention_tip": "one actionable prevention tip",
  "confidence": "high|medium|low",
  "source_quote": "exact or near-exact quote from transcript that supports this"
}

Return [] if no complete examples found. Return only valid JSON, no markdown.`

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 2000,
    })

    const raw = res.choices[0].message.content.trim()
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)

    if (!Array.isArray(parsed)) return []

    // Filter: must have cpt_code + denial_category + scenario_description
    return parsed.filter(p =>
      p.cpt_code &&
      p.scenario_description &&
      DENIAL_CATEGORIES.includes(p.denial_category)
    ).map(p => ({
      ...p,
      cpt_codes: p.cpt_codes || [p.cpt_code],
      source_type: 'youtube_community',
      source_url: `https://www.youtube.com/watch?v=${videoMeta.videoId || ''}`,
      source_date: videoMeta.publishedAt ? new Date(videoMeta.publishedAt) : new Date(),
      channel: videoMeta.channel || null,
      is_verified: false,
    }))
  } catch (err) {
    console.warn(`[YOUTUBE:PATTERN] extractDenialPatterns failed: ${err.message}`)
    return []
  }
}

module.exports = { extractDenialPatterns, DENIAL_CATEGORIES }
