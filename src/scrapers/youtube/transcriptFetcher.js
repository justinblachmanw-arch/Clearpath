'use strict'
require('dotenv').config()

const { YoutubeTranscript } = require('youtube-transcript')

const PRIMARY_CARE_KEYWORDS = [
  'claim denial', 'denial', 'denials', 'E&M', 'evaluation and management',
  'CPT', '99213', '99214', '99215', '99212', '99202', '99203', '99204', '99205',
  'MDM', 'medical decision making', 'modifier', 'CARC', 'RARC',
  'prior authorization', 'prior auth', 'medical necessity',
  'bundling', 'NCCI', 'LCD', 'NCD', 'payer policy',
  'G2211', 'AWV', 'annual wellness', 'CCM', 'chronic care',
  'ICD-10', 'diagnosis code', 'billing', 'coding', 'compliance',
  'upcoding', 'downcoding', 'audit', 'OIG', 'documentation',
]

async function fetchTranscript(videoId) {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId)
    if (!segments || segments.length === 0) return null
    const text = segments.map(s => s.text).join(' ')
    return { videoId, text, segmentCount: segments.length }
  } catch (err) {
    console.warn(`[YOUTUBE] fetchTranscript failed for ${videoId}: ${err.message}`)
    return null
  }
}

// Checks title/description relevance — avoid downloading irrelevant transcripts
function isRelevantVideo(title = '') {
  const lower = title.toLowerCase()
  return PRIMARY_CARE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))
}

// Fetches video IDs from a channel page — basic HTML scrape, no API key
async function fetchChannelVideos(channelUrl, keywords = []) {
  try {
    const axios = require('axios')
    const res = await axios.get(channelUrl, {
      timeout: 30000,
      headers: { 'User-Agent': 'ClearpathHealthBot/1.0 (healthcare billing research)' },
    })
    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)

    // Extract video IDs from YouTube channel page HTML
    const idMatches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)]
    const titleMatches = [...html.matchAll(/"title":\{"runs":\[\{"text":"([^"]+)"/g)]

    const seen = new Set()
    const videos = []

    idMatches.forEach((match, i) => {
      const id = match[1]
      if (seen.has(id)) return
      seen.add(id)

      const title = titleMatches[i] ? titleMatches[i][1] : ''
      const relevantKeywords = keywords.length ? keywords : PRIMARY_CARE_KEYWORDS
      if (!title || isRelevantVideo(title) || relevantKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()))) {
        videos.push({ videoId: id, title })
      }
    })

    return videos
  } catch (err) {
    console.warn(`[YOUTUBE] fetchChannelVideos failed for ${channelUrl}: ${err.message}`)
    return []
  }
}

module.exports = { fetchTranscript, fetchChannelVideos, isRelevantVideo, PRIMARY_CARE_KEYWORDS }
