require('dotenv').config()
const db = require('../db')
const { getPayerPolicy } = require('./payerPolicyScraper')

// Returns complete coding context for a given payer + CPT combination.
// Used by claimScrubAgent and eraAgent to ground GPT-4o prompts in real policy.
async function getCodingContext({ payerCode, cptCode, diagnosisCodes }) {
  const [policyRow, guidelineResult] = await Promise.all([
    getPayerPolicy(payerCode, cptCode),
    db.query(
      `SELECT guideline_type, title, content, source
       FROM coding_guidelines
       WHERE cpt_code = $1
       ORDER BY guideline_type`,
      [cptCode]
    ).catch(() => ({ rows: [] })),
  ])

  const guidelines = guidelineResult.rows
  const bundlingRules = guidelines.filter(g => g.guideline_type === 'bundling_rules')
  const mdmCriteria   = guidelines.find(g => g.guideline_type === 'mdm_criteria')
  const timeCriteria  = guidelines.find(g => g.guideline_type === 'time_criteria')
  const docElements   = guidelines.find(g => g.guideline_type === 'documentation_elements')
  const medNecessity  = guidelines.find(g => g.guideline_type === 'medical_necessity')
  const modifierRules = guidelines.filter(g => g.guideline_type === 'modifier_rules')
  const preventive    = guidelines.find(g => g.guideline_type === 'preventive_rules')

  return {
    payerRequirements: policyRow,
    amaGuidelines:     guidelines,
    bundlingRules,
    summary: buildContextSummary({
      payerCode, cptCode,
      payerPolicy: policyRow,
      mdmCriteria, timeCriteria, docElements,
      medNecessity, bundlingRules, modifierRules, preventive,
    }),
  }
}

function buildContextSummary({
  payerCode, cptCode, payerPolicy,
  mdmCriteria, timeCriteria, docElements,
  medNecessity, bundlingRules, modifierRules, preventive,
}) {
  const parts = [`Coding context for ${payerCode} billing ${cptCode}:`]

  if (mdmCriteria) {
    parts.push(`\nAMA 2021 MDM requirements:\n${mdmCriteria.content}`)
  }
  if (timeCriteria) {
    parts.push(`\nTime-based selection:\n${timeCriteria.content}`)
  }
  if (docElements) {
    parts.push(`\nDocumentation must include:\n${docElements.content}`)
  }
  if (preventive) {
    parts.push(`\nPreventive visit rules:\n${preventive.content}`)
  }
  if (medNecessity) {
    parts.push(`\nMedicare/CMS medical necessity:\n${medNecessity.content}`)
  }
  if (payerPolicy?.coverage_criteria) {
    parts.push(`\n${payerCode} coverage criteria:\n${payerPolicy.coverage_criteria}`)
  }
  if (payerPolicy?.documentation_required) {
    parts.push(`\n${payerCode} documentation required:\n${payerPolicy.documentation_required}`)
  }
  if (payerPolicy?.common_denial_reasons) {
    parts.push(`\nCommon ${payerCode} denial triggers:\n${payerPolicy.common_denial_reasons}`)
  }
  if (bundlingRules.length) {
    parts.push(`\nNCCI bundling rules:\n${bundlingRules.map(b => b.content).join('\n')}`)
  }
  if (modifierRules.length) {
    parts.push(`\nModifier rules:\n${modifierRules.map(m => m.content).join('\n')}`)
  }

  return parts.join('\n')
}

// Look up a CARC denial code for actionable fix/appeal info.
async function getCARCContext(carcCode) {
  try {
    const result = await db.query(
      `SELECT description, category, fix_action, appeal_angle, related_codes
       FROM carc_rarc_codes WHERE code_type = 'CARC' AND code = $1 LIMIT 1`,
      [String(carcCode)]
    )
    return result.rows[0] || null
  } catch {
    return null
  }
}

module.exports = { getCodingContext, getCARCContext }
