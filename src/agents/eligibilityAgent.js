require('dotenv').config()
const { pseudonymize } = require('../lib/pseudonymize')
const { checkEligibility } = require('../lib/availity')
const { notifyPatient, buildEligibilityMessage } = require('../lib/notify')
const OpenAI = require('openai')
const db = require('../db')

async function runEligibilityAgent(appointment) {
  // Normalize DB row (snake_case fields) vs legacy test object (camelCase)
  const apptId       = appointment.id
  const isDbRow      = typeof apptId === 'number'
  const patientToken = appointment.patient_token || null
  const patientId    = appointment.patientId || String(appointment.patient_id || '')
  const memberId     = (appointment.insurance && appointment.insurance.memberId)
                       || appointment.insurance_member_id
  const dateOfBirth  = (appointment.insurance && appointment.insurance.dateOfBirth) || null
  const payerCode    = (appointment.insurance && appointment.insurance.payerCode)
                       || appointment.payer_code
  const visitType    = appointment.visitType || appointment.visit_type
  const apptDate     = appointment.date
  const patientPhone = appointment.patientPhone || appointment.patient_phone || null
  // DB names are stored encrypted — never send to AI; use 'Patient' in SMS
  const patientName  = appointment.patientName || 'Patient'

  console.log(`\n[ELIGIBILITY AGENT] Starting for appointment ${apptId}`)

  const token = patientToken || pseudonymize(patientId)
  console.log(`[ELIGIBILITY AGENT] Patient pseudonymized as ${token}`)

  let eligibility
  try {
    eligibility = await checkEligibility({
      memberId,
      dateOfBirth,
      appointmentDate: apptDate,
      payerCode
    })
    console.log(`[ELIGIBILITY AGENT] Eligibility result: ${eligibility.status}`)
  } catch (err) {
    console.error(`[ELIGIBILITY AGENT] Eligibility check failed:`, err.message)
    return { success: false, error: err.message }
  }

  const summary = await generateSummary({ token, eligibility, visitType })
  console.log(`[ELIGIBILITY AGENT] AI summary generated`)

  const message = buildEligibilityMessage({
    status: eligibility.status,
    patientName,
    appointmentDate: apptDate,
    copay: eligibility.copay,
    deductibleRemaining: eligibility.deductibleRemaining,
    error: eligibility.error
  })

  if (patientPhone) {
    await notifyPatient({ to: patientPhone, message })
    console.log(`[ELIGIBILITY AGENT] Patient notified`)
  }

  // Persist result back to appointments table when processing a real DB row
  if (isDbRow) {
    try {
      await db.saveEligibilityResult(
        apptId,
        eligibility.status,
        summary,
        eligibility.copay || null,
        eligibility.deductibleRemaining || null
      )
      console.log(`[ELIGIBILITY AGENT] Result saved to DB — appointment ${apptId}`)
    } catch (err) {
      console.error(`[ELIGIBILITY AGENT] DB write failed:`, err.message)
    }
  }

  const result = {
    appointmentId: apptId,
    token,
    status: eligibility.status,
    summary,
    eligibility,
    notified: !!patientPhone,
    processedAt: new Date().toISOString()
  }

  console.log(`[ELIGIBILITY AGENT] Complete`)
  return result
}

// DB-based entry point: reads today's appointments and runs eligibility for each.
// Falls back to next 5 upcoming appointments if none exist for today.
async function runEligibilityAgentForDate(providerId, date) {
  const targetDate = date || new Date().toISOString().split('T')[0]
  console.log(`\n[ELIGIBILITY AGENT] Fetching appointments for provider ${providerId} on ${targetDate}`)

  let appts = []
  try {
    const result = await db.query(
      `SELECT a.*, p.token AS patient_token, p.insurance_member_id, p.payer_code,
              p.phone AS patient_phone
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       WHERE a.provider_id = $1 AND DATE(a.date) = $2::date
       ORDER BY a.id`,
      [providerId, targetDate]
    )
    appts = result.rows
  } catch (err) {
    console.error(`[ELIGIBILITY AGENT] Failed to fetch appointments:`, err.message)
    return []
  }

  if (appts.length === 0) {
    console.log(`[ELIGIBILITY AGENT] No appointments for ${targetDate} — falling back to next 5 upcoming`)
    try {
      const upcoming = await db.query(
        `SELECT a.*, p.token AS patient_token, p.insurance_member_id, p.payer_code,
                p.phone AS patient_phone
         FROM appointments a
         JOIN patients p ON a.patient_id = p.id
         WHERE a.provider_id = $1 AND a.date >= CURRENT_DATE
         ORDER BY a.date, a.id
         LIMIT 5`,
        [providerId]
      )
      appts = upcoming.rows
    } catch (err) {
      console.error(`[ELIGIBILITY AGENT] Upcoming fallback query failed:`, err.message)
    }
  }

  // Second fallback: most recent 5 past appointments when no future ones exist
  if (appts.length === 0) {
    console.log(`[ELIGIBILITY AGENT] No upcoming appointments — using 5 most recent`)
    try {
      const recent = await db.query(
        `SELECT a.*, p.token AS patient_token, p.insurance_member_id, p.payer_code,
                p.phone AS patient_phone
         FROM appointments a
         JOIN patients p ON a.patient_id = p.id
         WHERE a.provider_id = $1
         ORDER BY a.date DESC, a.id DESC
         LIMIT 5`,
        [providerId]
      )
      appts = recent.rows
    } catch (err) {
      console.error(`[ELIGIBILITY AGENT] Recent fallback query failed:`, err.message)
    }
  }

  console.log(`[ELIGIBILITY AGENT] Processing ${appts.length} appointment(s)`)

  const results = []
  for (const appt of appts) {
    try {
      const result = await runEligibilityAgent(appt)
      results.push(result)
    } catch (err) {
      console.error(`[ELIGIBILITY AGENT] Failed for appointment ${appt.id}:`, err.message)
    }
  }
  return results
}

async function generateSummary({ token, eligibility, visitType }) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  if (eligibility.status !== 'active') {
    return eligibility.error || 'Coverage could not be verified'
  }

  const prompt = `
You are a healthcare billing assistant. A patient (ID: ${token}) has verified insurance coverage for a ${visitType} visit.

Insurance details:
- Plan: ${eligibility.planName}
- Status: ${eligibility.status}
- Copay: $${eligibility.copay}
- Deductible: $${eligibility.deductible}
- Deductible met: $${eligibility.deductibleMet}
- Deductible remaining: $${eligibility.deductibleRemaining}
- Requires referral: ${eligibility.requiresReferral}

Write a single plain-English sentence summarizing this for the provider to see on their dashboard before the appointment.
Do not include the patient ID. Do not include any PHI. Just the coverage summary.
`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 100
  })

  return response.choices[0].message.content.trim()
}

module.exports = { runEligibilityAgent, runEligibilityAgentForDate }
