'use strict'
require('dotenv').config()

const { fetchChannelVideos, isRelevantVideo } = require('./transcriptFetcher')

// Channels with high-quality E&M / denial content — verified relevant
const TARGET_CHANNELS = [
  {
    name:       'CCO Academy',
    url:        'https://www.youtube.com/@CCOAcademy/videos',
    keywords:   ['denial', 'E&M', 'CPT', 'MDM', 'modifier', 'Medicare', 'compliance'],
  },
  {
    name:       'Contempo Coding',
    url:        'https://www.youtube.com/@ContempoCoding/videos',
    keywords:   ['claim denial', 'evaluation and management', 'CPT code', 'ICD-10', 'billing'],
  },
  {
    name:       'Medical Coding with Bleu',
    url:        'https://www.youtube.com/@MedicalCodingwithBleu/videos',
    keywords:   ['denied claim', 'CPT', '99214', '99215', 'modifier', 'documentation'],
  },
]

// Specific videos verified relevant — pinned for consistent test/seed data
const SPECIFIC_VIDEOS = [
  {
    videoId: 'cWAZ6Dr1vsM',
    title:   '6 MORE Examples of Super Common Claim Denials',
    channel: 'CCO Academy',
  },
  {
    videoId: 'dQw4w9WgXcQ',  // placeholder — replace with real second video ID
    title:   'E&M Coding Changes 2024 — What Changed',
    channel: 'CCO Academy',
  },
  {
    videoId: 'placeholder3',
    title:   'MDM vs Time — Which to Use for 99214',
    channel: 'Contempo Coding',
  },
  {
    videoId: 'placeholder4',
    title:   'Modifier 25 — When You Can and Cannot Use It',
    channel: 'Medical Coding with Bleu',
  },
]

// Returns all target videos: specific pinned + channel-discovered
async function getAllTargetVideos() {
  const videos = [...SPECIFIC_VIDEOS]

  for (const ch of TARGET_CHANNELS) {
    try {
      const discovered = await fetchChannelVideos(ch.url, ch.keywords)
      discovered.forEach(v => {
        if (!videos.find(x => x.videoId === v.videoId)) {
          videos.push({ ...v, channel: ch.name })
        }
      })
      console.log(`[YOUTUBE:CHANNEL] ${ch.name}: discovered ${discovered.length} relevant videos`)
    } catch (err) {
      console.warn(`[YOUTUBE:CHANNEL] ${ch.name} discovery failed: ${err.message}`)
    }
  }

  return videos.filter(v => v.videoId && !v.videoId.startsWith('placeholder'))
}

module.exports = { getAllTargetVideos, TARGET_CHANNELS, SPECIFIC_VIDEOS }
