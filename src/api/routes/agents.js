require('dotenv').config()
const express = require('express')
const { runEligibilityAgent } = require('../../agents/eligibilityAgent')
const { runClaimScrubAgent } = require('../../agents/claimScrubAgent')
const { runCredentialingAgent } = require('../../agents/credentialingAgent')
const { runPracticeOpsAgent } = require('../../agents/practiceOpsAgent')

const router = express.Router()

function requireWebhookSecret(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) {
    console.error('[AGENTS] WEBHOOK_SECRET not set — rejecting request')
    return res.status(503).json({ error: 'Agent endpoints not configured' })
  }
  if (req.headers['x-webhook-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// POST /api/agents/eligibility
// Called by eligibilityBot when Appointment status=booked
router.post('/agents/eligibility', requireWebhookSecret, async (req, res) => {
  const {
    medplumAppointmentId,
    medplumPatientId,
    memberId,
    payerCode,
    dateOfBirth,
    appointmentDate
  } = req.body

  console.log(`[AGENTS] Eligibility check triggered by bot — appt ${medplumAppointmentId}`)

  try {
    // Build appointment object matching eligibilityAgent's expected shape
    const appointment = {
      id:                   medplumAppointmentId || 'BOT-APPT',
      patient_token:        medplumPatientId ? `PT-${medplumPatientId.slice(0, 8).toUpperCase()}` : null,
      patient_id:           medplumPatientId || null,
      insurance_member_id:  memberId || null,
      payer_code:           payerCode || 'UNKNOWN',
      insurance: {
        memberId:    memberId || null,
        payerCode:   payerCode || 'UNKNOWN',
        dateOfBirth: dateOfBirth || null
      },
      date:       appointmentDate || new Date().toISOString(),
      visit_type: 'Office Visit'
    }

    const result = await runEligibilityAgent(appointment)

    res.json({
      status:               result.eligibilityStatus || result.status || 'unknown',
      summary:              result.summary || result.aiSummary || null,
      copay:                result.copay ?? null,
      deductibleRemaining:  result.deductibleRemaining ?? null,
      error:                result.error || null
    })
  } catch (err) {
    console.error('[AGENTS] Eligibility agent error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agents/claimScrub
// Called by claimScrubBot when Encounter status=finished
router.post('/agents/claimScrub', requireWebhookSecret, async (req, res) => {
  const {
    medplumEncounterId,
    medplumPatientId,
    noteContent,
    icd10Codes,
    cptCode,
    payerCode,
    providerId
  } = req.body

  console.log(`[AGENTS] Claim scrub triggered by bot — encounter ${medplumEncounterId}`)

  try {
    const claim = {
      claimId:         `CLM-${medplumEncounterId || Date.now()}`,
      providerNPI:     process.env.PROVIDER_NPI || '1234567890',
      providerTaxId:   process.env.PROVIDER_TAX_ID || '123456789',
      patientToken:    medplumPatientId ? `PT-${medplumPatientId.slice(0, 8).toUpperCase()}` : 'PT-UNKNOWN',
      payerCode:       payerCode || 'AETNA',
      dateOfService:   new Date().toISOString().split('T')[0],
      placeOfService:  '11',
      diagnosisCodes:  icd10Codes || [],
      serviceLines:    [{ procedureCode: cptCode || '99213', modifiers: [], billedAmount: 200.00, units: 1 }],
      complexity:      'moderate',
      noteDocumented:  !!(noteContent?.assessment || noteContent?.plan)
    }

    const result = await runClaimScrubAgent(claim)

    res.json({
      passed: result.passed,
      issues: result.issues || [],
      claim:  result.claim || claim
    })
  } catch (err) {
    console.error('[AGENTS] Claim scrub agent error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agents/credentialing
// Called by credentialingBot on daily cron
router.post('/agents/credentialing', requireWebhookSecret, async (req, res) => {
  const { providerId = 1 } = req.body

  console.log(`[AGENTS] Credentialing check triggered by bot — provider ${providerId}`)

  try {
    const result = await runCredentialingAgent(Number(providerId) || 1)

    res.json({
      alerts:      result.alerts || [],
      actionItems: result.actionItems || result.alerts || []
    })
  } catch (err) {
    console.error('[AGENTS] Credentialing agent error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agents/practiceOps
// Called by practiceOpsBot on daily cron — merges FHIR tasks with PostgreSQL action items
router.post('/agents/practiceOps', requireWebhookSecret, async (req, res) => {
  const { providerId = 1, fhirTasks = [] } = req.body

  console.log(`[AGENTS] Practice ops triggered by bot — provider ${providerId}, ${fhirTasks.length} FHIR tasks`)

  try {
    const result = await runPracticeOpsAgent({
      providerId: Number(providerId) || 1
    })

    // Merge FHIR tasks into action items as info-level items
    const fhirActionItems = fhirTasks.map(t => ({
      source:      'fhir_bot',
      priority:    t.priority === 'stat' ? 1 : t.priority === 'asap' ? 2 : t.priority === 'urgent' ? 2 : 6,
      type:        t.code || 'fhir_task',
      title:       t.description || 'FHIR Task',
      description: t.note || '',
      urgency:     t.priority === 'stat' ? 'critical' : t.priority === 'asap' ? 'high' : 'medium'
    }))

    const allActionItems = [...result.actionItems, ...fhirActionItems]

    const smsBriefing = [
      `Morning briefing — ${allActionItems.length} action items:`,
      ...allActionItems.slice(0, 3).map((item, i) => `${i + 1}. ${item.title}`)
    ].join('\n')

    res.json({
      actionItems:  allActionItems,
      summary:      result.dailySummary || result.summary || '',
      smsBriefing
    })
  } catch (err) {
    console.error('[AGENTS] Practice ops agent error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
