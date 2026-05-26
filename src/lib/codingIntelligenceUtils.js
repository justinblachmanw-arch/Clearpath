'use strict'

const SOURCE_AUTHORITY = {
  cms_direct:        5,
  hhs_direct:        5,
  ama_official:      4,
  aapc_official:     4,
  idsa_reference:    4,
  payer_published:   3,
  billing_expert:    3,
  youtube_community: 2,
  derived:           1,
}

function recencyScore(sourceDate) {
  if (!sourceDate) return 1
  const days = (Date.now() - new Date(sourceDate)) / 86400000
  if (days <= 90)  return 5
  if (days <= 180) return 4
  if (days <= 365) return 3
  if (days <= 730) return 2
  return 1
}

function confidenceScore(authority, sourceDate, sourcesAgreeing = 1) {
  const consistencyScore = Math.min(sourcesAgreeing, 5)
  return (SOURCE_AUTHORITY[authority] || 1) + recencyScore(sourceDate) + consistencyScore
}

function confidenceLabel(score) {
  if (score >= 12) return 'verified'
  if (score >= 9)  return 'high'
  if (score >= 6)  return 'medium'
  return 'low'
}

function missingField(reason) {
  return { value: null, needs_reverification: true, reverification_reason: reason }
}

function isTrumpEraChange(effectiveDate) {
  if (!effectiveDate) return false
  return new Date(effectiveDate) >= new Date('2025-01-20')
}

function recordMeta(sourceType, sourceUrl, sourceDate, sourcesAgreeing = 1) {
  const score = confidenceScore(sourceType, sourceDate, sourcesAgreeing)
  return {
    source_type:            sourceType,
    source_url:             sourceUrl,
    source_date:            sourceDate,
    source_authority_score: SOURCE_AUTHORITY[sourceType] || 1,
    recency_score:          recencyScore(sourceDate),
    consistency_score:      Math.min(sourcesAgreeing, 5),
    confidence_score:       score,
    confidence_level:       confidenceLabel(score),
    trump_era_change:       isTrumpEraChange(sourceDate),
    last_verified_date:     new Date().toISOString().split('T')[0],
    needs_reverification:   false,
  }
}

module.exports = {
  SOURCE_AUTHORITY,
  recencyScore,
  confidenceScore,
  confidenceLabel,
  missingField,
  isTrumpEraChange,
  recordMeta,
}
