require('dotenv').config()
const OpenAI = require('openai')
const db = require('../db')

// Mock specialist directory — in production this is a credentialed specialist DB table + payer network API
const SPECIALIST_DIRECTORY = [
  {
    id: 'SPEC-001',
    name: 'Dr. Sarah Chen',
    specialty: 'cardiology',
    npi: '9876543210',
    acceptedPayers: ['AETNA', 'MEDICARE', 'BCBS', 'UHC'],
    fax: '+12125551111',
    directAddress: 'sarah.chen@direct.example.com',
    averageWait: '2 weeks'
  },
  {
    id: 'SPEC-002',
    name: 'Dr. Marcus Williams',
    specialty: 'orthopedics',
    npi: '8765432109',
    acceptedPayers: ['AETNA', 'MEDICARE', 'UHC'],
    fax: '+12125552222',
    directAddress: 'marcus.williams@direct.example.com',
    averageWait: '3 weeks'
  },
  {
    id: 'SPEC-003',
    name: 'Dr. Priya Nair',
    specialty: 'neurology',
    npi: '7654321098',
    acceptedPayers: ['MEDICARE', 'BCBS'],
    fax: '+12125553333',
    directAddress: 'priya.nair@direct.example.com',
    averageWait: '4 weeks'
  },
  {
    id: 'SPEC-004',
    name: 'Dr. James Park',
    specialty: 'gastroenterology',
    npi: '6543210987',
    acceptedPayers: ['AETNA', 'MEDICARE', 'BCBS', 'UHC', 'CIGNA'],
    fax: '+12125554444',
    directAddress: 'james.park@direct.example.com',
    averageWait: '2 weeks'
  }
]

// In-memory referral tracker — fallback when DB is unavailable or providerId is not numeric
const referralTracker = new Map()

async function ensureReferralsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      id                           SERIAL PRIMARY KEY,
      provider_id                  INTEGER       NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      patient_id                   INTEGER       REFERENCES patients(id),
      referral_id                  VARCHAR(100),
      encounter_id                 VARCHAR(100),
      specialist_id                VARCHAR(50),
      specialist_name              VARCHAR(200),
      specialty                    VARCHAR(100),
      urgency                      VARCHAR(50),
      status                       VARCHAR(50)   NOT NULL DEFAULT 'sent',
      sent_at                      TIMESTAMP,
      sent_method                  VARCHAR(50),
      response_deadline            TIMESTAMP,
      patient_scheduled            BOOLEAN       DEFAULT FALSE,
      specialist_response_received BOOLEAN       DEFAULT FALSE,
      clinical_summary             TEXT,
      diagnosis_codes              TEXT[],
      created_at                   TIMESTAMP     NOT NULL DEFAULT NOW(),
      updated_at                   TIMESTAMP     NOT NULL DEFAULT NOW()
    )
  `)
}

function getMockEncounterNote(scenario = 'cardiology_referral') {
  const scenarios = {
    cardiology_referral: {
      encounterId: 'ENC-101',
      providerId: 'PROV-001',
      patientToken: 'PT-B2C3D4E5',
      payerCode: 'AETNA',
      noteText: 'Patient presents with exertional chest pain and dyspnea on exertion for the past 3 weeks. EKG shows ST changes. Blood pressure 148/92. Referring to cardiology for further evaluation and stress testing. Rule out unstable angina.',
      diagnosisCodes: ['R07.9', 'R06.09'],
      encounterDate: '2026-05-13'
    },

    orthopedics_referral: {
      encounterId: 'ENC-102',
      providerId: 'PROV-001',
      patientToken: 'PT-C3D4E5F6',
      payerCode: 'MEDICARE',
      noteText: 'Patient with severe right knee pain, grade 4 osteoarthritis confirmed on imaging. Conservative treatment failed. Referring to orthopedic surgery for surgical evaluation and possible total knee replacement.',
      diagnosisCodes: ['M17.11', 'M25.561'],
      encounterDate: '2026-05-13'
    },

    no_referral: {
      encounterId: 'ENC-103',
      providerId: 'PROV-001',
      patientToken: 'PT-D4E5F6G7',
      payerCode: 'BCBS',
      noteText: 'Patient here for routine blood pressure check. BP 128/82, well controlled on current regimen. Continue lisinopril 10mg. Return in 3 months.',
      diagnosisCodes: ['I10'],
      encounterDate: '2026-05-13'
    }
  }

  return scenarios[scenario] || scenarios.cardiology_referral
}

async function detectReferralIntent(noteText) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  // No PHI — only de-identified clinical note content analyzed
  const prompt = `
Analyze this clinical note for referral intent. Respond in JSON with exactly this shape:
{
  "referralDetected": true or false,
  "specialtyNeeded": "cardiology" or "orthopedics" or "neurology" or "gastroenterology" or "endocrinology" or "nephrology" or "pulmonology" or null,
  "urgency": "routine" or "urgent" or "emergent",
  "clinicalReason": "one sentence summary of why referral is needed"
}

Clinical note: ${noteText}

Do not include any patient identifiers in your response. Respond only with the JSON object.
`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 150,
    response_format: { type: 'json_object' }
  })

  return JSON.parse(response.choices[0].message.content)
}

async function generateClinicalSummary(noteText, diagnosisCodes, specialtyNeeded) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  // No PHI — only clinical codes and de-identified note content
  const prompt = `
You are a primary care physician writing a referral summary for a ${specialtyNeeded} specialist.

Diagnosis codes: ${diagnosisCodes.join(', ')}
Clinical notes: ${noteText}

Write a 3-sentence clinical referral summary for the specialist. Include the relevant findings, what was tried, and what you need from the specialist.
Do not include any patient names, dates of birth, addresses, or identifiable information.
`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 200
  })

  return response.choices[0].message.content.trim()
}

function findCompatibleSpecialists(specialtyNeeded, payerCode) {
  return SPECIALIST_DIRECTORY.filter(
    s => s.specialty === specialtyNeeded && s.acceptedPayers.includes(payerCode)
  )
}

async function sendReferral(specialist, referralPacket) {
  if (process.env.REFERRAL_SANDBOX === 'true' || !process.env.DIRECT_MESSAGING_URL) {
    // Mock send — in production uses Direct secure messaging API or eFax
    const method = specialist.directAddress ? 'Direct secure messaging' : 'eFax'
    console.log(`[REFERRAL AGENT] [MOCK] Referral sent via ${method} to ${specialist.name} (${specialist.id})`)
    return {
      sent: true,
      method,
      sentAt: new Date().toISOString(),
      recipient: specialist.directAddress || specialist.fax
    }
  }

  // Production: POST to Direct messaging API
  const axios = require('axios')
  try {
    const response = await axios.post(process.env.DIRECT_MESSAGING_URL, {
      to: specialist.directAddress || specialist.fax,
      subject: `Referral — ${referralPacket.specialtyNeeded}`,
      body: referralPacket.clinicalSummary,
      attachments: []
    })
    return { sent: true, method: 'Direct', sentAt: new Date().toISOString(), messageId: response.data.messageId }
  } catch (err) {
    throw new Error(`Referral send failed: ${err.message}`)
  }
}

async function runReferralAgent(encounterNote, providerId = null) {
  console.log(`\n[REFERRAL AGENT] Starting for encounter ${encounterNote.encounterId}`)

  const numericProviderId = typeof providerId === 'number' ? providerId : null
  if (numericProviderId) {
    try { await ensureReferralsTable() } catch (err) {
      console.error('[REFERRAL AGENT] Table ensure failed:', err.message)
    }
  }

  // Detect referral intent in note
  let detection = null
  try {
    detection = await detectReferralIntent(encounterNote.noteText)
    console.log(`[REFERRAL AGENT] Referral detected: ${detection.referralDetected} — specialty: ${detection.specialtyNeeded} — urgency: ${detection.urgency}`)
  } catch (err) {
    console.error(`[REFERRAL AGENT] Referral detection failed:`, err.message)
    return {
      encounterId: encounterNote.encounterId,
      referralDetected: false,
      error: err.message,
      processedAt: new Date().toISOString()
    }
  }

  if (!detection.referralDetected) {
    console.log(`[REFERRAL AGENT] No referral intent found — no action taken`)
    return {
      encounterId: encounterNote.encounterId,
      referralDetected: false,
      processedAt: new Date().toISOString()
    }
  }

  // Find compatible specialists (specialty + payer network match)
  const compatibleSpecialists = findCompatibleSpecialists(detection.specialtyNeeded, encounterNote.payerCode)
  console.log(`[REFERRAL AGENT] Found ${compatibleSpecialists.length} compatible ${detection.specialtyNeeded} specialist(s) in network`)

  if (compatibleSpecialists.length === 0) {
    console.warn(`[REFERRAL AGENT] No in-network ${detection.specialtyNeeded} specialists found for payer ${encounterNote.payerCode}`)
  }

  // Generate clinical summary for referral packet
  let clinicalSummary = null
  try {
    clinicalSummary = await generateClinicalSummary(
      encounterNote.noteText,
      encounterNote.diagnosisCodes,
      detection.specialtyNeeded
    )
    console.log(`[REFERRAL AGENT] Clinical summary generated`)
  } catch (err) {
    console.error(`[REFERRAL AGENT] Summary generation failed:`, err.message)
    clinicalSummary = detection.clinicalReason
  }

  const referralPacket = {
    specialtyNeeded: detection.specialtyNeeded,
    urgency: detection.urgency,
    clinicalReason: detection.clinicalReason,
    clinicalSummary,
    diagnosisCodes: encounterNote.diagnosisCodes,
    patientToken: encounterNote.patientToken,
    payerCode: encounterNote.payerCode
  }

  // Send to first compatible specialist; in production provider chooses from a list
  const sendResults = []
  for (const specialist of compatibleSpecialists.slice(0, 1)) {
    let send = null
    try {
      send = await sendReferral(specialist, referralPacket)
    } catch (err) {
      console.error(`[REFERRAL AGENT] Send failed to ${specialist.name}:`, err.message)
      send = { sent: false, error: err.message }
    }

    const referralId = `REF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

    const record = {
      referralId,
      encounterId: encounterNote.encounterId,
      patientToken: encounterNote.patientToken,
      specialistId: specialist.id,
      specialistName: specialist.name,
      specialty: detection.specialtyNeeded,
      urgency: detection.urgency,
      status: send.sent ? 'sent' : 'send_failed',
      sentAt: send.sentAt || null,
      sentMethod: send.method || null,
      responseDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      patientScheduled: false,
      specialistResponseReceived: false,
      clinicalSummary,
      diagnosisCodes: encounterNote.diagnosisCodes
    }

    referralTracker.set(referralId, record)

    if (numericProviderId) {
      try {
        await db.query(
          `INSERT INTO referrals
             (provider_id, patient_id, referral_id, encounter_id,
              specialist_id, specialist_name, specialty, urgency, status,
              sent_at, sent_method, response_deadline, patient_scheduled,
              specialist_response_received, clinical_summary, diagnosis_codes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            numericProviderId,
            encounterNote.patientId || null,
            record.referralId,
            record.encounterId,
            record.specialistId,
            record.specialistName,
            record.specialty,
            record.urgency,
            record.status,
            record.sentAt    ? new Date(record.sentAt)             : null,
            record.sentMethod || null,
            record.responseDeadline ? new Date(record.responseDeadline) : null,
            record.patientScheduled,
            record.specialistResponseReceived,
            record.clinicalSummary,
            encounterNote.diagnosisCodes || []
          ]
        )
        console.log(`[REFERRAL AGENT] Referral ${referralId} saved to DB`)
      } catch (err) {
        console.error(`[REFERRAL AGENT] DB save failed:`, err.message)
      }
    }

    sendResults.push(record)
    console.log(`[REFERRAL AGENT] Referral ${referralId} — ${record.status} to ${specialist.name}`)
  }

  const result = {
    encounterId: encounterNote.encounterId,
    referralDetected: true,
    specialtyNeeded: detection.specialtyNeeded,
    urgency: detection.urgency,
    compatibleSpecialistsFound: compatibleSpecialists.length,
    referrals: sendResults,
    referralsSent: sendResults.filter(r => r.status === 'sent').length,
    processedAt: new Date().toISOString()
  }

  console.log(`[REFERRAL AGENT] Complete — ${result.referralsSent} referral(s) sent`)
  return result
}

function getReferralStatus(referralId) {
  return referralTracker.get(referralId) || null
}

async function updateReferralStatus(referralId, updates) {
  const record = referralTracker.get(referralId)
  if (record) {
    Object.assign(record, updates, { updatedAt: new Date().toISOString() })
    referralTracker.set(referralId, record)
  }
  try {
    const setClauses = Object.entries(updates)
      .map(([k, _], i) => `${k} = $${i + 2}`)
      .join(', ')
    await db.query(
      `UPDATE referrals SET ${setClauses}, updated_at = NOW() WHERE referral_id = $1`,
      [referralId, ...Object.values(updates)]
    )
  } catch (err) {
    console.error(`[REFERRAL AGENT] DB update failed for ${referralId}:`, err.message)
  }
  console.log(`[REFERRAL AGENT] Referral ${referralId} updated:`, JSON.stringify(updates))
  return record || null
}

async function getOpenReferrals(providerId = null) {
  if (typeof providerId === 'number') {
    try {
      await ensureReferralsTable()
      const rows = await db.query(
        `SELECT * FROM referrals
         WHERE provider_id = $1 AND status = 'sent' AND specialist_response_received = false
         ORDER BY created_at`,
        [providerId]
      )
      return rows.rows.map(r => ({
        referralId:                  r.referral_id,
        encounterId:                 r.encounter_id,
        specialistId:                r.specialist_id,
        specialistName:              r.specialist_name,
        specialty:                   r.specialty,
        urgency:                     r.urgency,
        status:                      r.status,
        sentAt:                      r.sent_at     ? r.sent_at.toISOString()              : null,
        sentMethod:                  r.sent_method,
        responseDeadline:            r.response_deadline ? r.response_deadline.toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        patientScheduled:            r.patient_scheduled,
        specialistResponseReceived:  r.specialist_response_received,
        clinicalSummary:             r.clinical_summary
      }))
    } catch (err) {
      console.error('[REFERRAL AGENT] getOpenReferrals DB query failed:', err.message)
    }
  }
  return Array.from(referralTracker.values()).filter(
    r => r.status === 'sent' && !r.specialistResponseReceived
  )
}

module.exports = {
  runReferralAgent,
  getMockEncounterNote,
  findCompatibleSpecialists,
  getReferralStatus,
  updateReferralStatus,
  getOpenReferrals,
  detectReferralIntent
}
