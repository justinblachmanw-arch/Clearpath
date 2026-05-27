'use strict'
require('dotenv').config()

const OpenAI = require('openai')

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Mode 2 — extract declarative billing rules from transcript
// is_behavioral: true always (community source, not CMS/AMA official)
async function extractKnowledge(transcript, videoMeta = {}) {
  if (!transcript || transcript.length < 200) {
    return { cpt_rules: [], modifier_rules: [], payer_rules: [], context_rules: [], icd10_rules: [], policy_changes: [] }
  }

  const prompt = `You are analyzing a medical billing / coding YouTube video transcript to extract declarative billing rules and knowledge.

Video: ${videoMeta.title || 'Unknown'}
Channel: ${videoMeta.channel || 'Unknown'}

Transcript (excerpt):
${transcript.slice(0, 6000)}

Extract ONLY clear, actionable billing rules stated in the video. Skip opinions, anecdotes, and promotional content.

Return a JSON object with these keys (each is an array, can be empty):

"cpt_rules": [{
  "cpt_code": "string",
  "rule_type": "documentation|time|mdm|billing_frequency|place_of_service|other",
  "rule_summary": "one sentence rule",
  "detail": "fuller explanation if given",
  "confidence": "high|medium|low"
}],

"modifier_rules": [{
  "modifier_code": "string e.g. 25",
  "cpt_code": "string or null if general",
  "rule_summary": "one sentence rule",
  "use_case": "when to use",
  "common_mistake": "common error if mentioned",
  "confidence": "high|medium|low"
}],

"payer_rules": [{
  "payer_name": "Medicare|Medicaid|Aetna|UnitedHealthcare|BCBS|Cigna|general",
  "cpt_code": "string or null",
  "rule_title": "short title",
  "rule_description": "what the rule is",
  "rule_severity": "hard|soft",
  "confidence": "high|medium|low"
}],

"context_rules": [{
  "rule_type": "appointment_type|place_of_service|patient_demographics|other",
  "cpt_code": "string or null",
  "rule_summary": "one sentence",
  "detail": "fuller explanation if given",
  "confidence": "high|medium|low"
}],

"icd10_rules": [{
  "icd10_code": "string or null if general",
  "cpt_code": "string or null",
  "rule_summary": "one sentence — when this dx does/doesn't support this CPT",
  "confidence": "high|medium|low"
}],

"policy_changes": [{
  "change_title": "short title",
  "change_description": "what changed",
  "effective_date": "YYYY-MM-DD or null",
  "confidence": "high|medium|low"
}]

Return only valid JSON, no markdown.`

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 2500,
    })

    const raw = res.choices[0].message.content.trim()
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)

    const sourceUrl  = `https://www.youtube.com/watch?v=${videoMeta.videoId || ''}`
    const sourceDate = videoMeta.publishedAt ? new Date(videoMeta.publishedAt) : new Date()

    // Tag everything as behavioral + youtube_community — never CMS official
    const tag = item => ({
      ...item,
      is_behavioral:  true,
      source_type:    'youtube_community',
      source_url:     sourceUrl,
      source_date:    sourceDate,
      channel:        videoMeta.channel || null,
      is_verified:    false,
    })

    return {
      cpt_rules:      (parsed.cpt_rules      || []).map(tag),
      modifier_rules: (parsed.modifier_rules || []).map(tag),
      payer_rules:    (parsed.payer_rules    || []).map(tag),
      context_rules:  (parsed.context_rules  || []).map(tag),
      icd10_rules:    (parsed.icd10_rules    || []).map(tag),
      policy_changes: (parsed.policy_changes || []).map(tag),
    }
  } catch (err) {
    console.warn(`[YOUTUBE:KNOWLEDGE] extractKnowledge failed: ${err.message}`)
    return { cpt_rules: [], modifier_rules: [], payer_rules: [], context_rules: [], icd10_rules: [], policy_changes: [] }
  }
}

module.exports = { extractKnowledge }
