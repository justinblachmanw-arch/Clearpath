require('dotenv').config()
const { Router } = require('express')
const jwt        = require('jsonwebtoken')
const OpenAI     = require('openai')
const { verifyJWT } = require('../middleware/auth')
const db         = require('../../db')
const fhir       = require('../../lib/fhirHelpers')

const router = Router()

function verifyAnyJWT(req, res, next) {
  const header = req.headers['authorization']
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'clearpath_jwt_secret_dev')
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ─── Patient Lookup (public) ───────────────────────────────────────────────────

router.get('/patients/lookup', async (req, res, next) => {
  try {
    const { firstName, lastName, dob, phoneLastFour } = req.query
    if (!firstName || !lastName || !dob) {
      return res.status(400).json({ error: 'firstName, lastName, and dob required' })
    }

    const result = await db.query(`
      SELECT
        p.id, p.first_name_encrypted, p.last_name_encrypted, p.dob_encrypted,
        p.payer_name, p.payer_code, p.insurance_member_id, p.phone, p.provider_id,
        p.medplum_patient_id,
        a.id AS appointment_id, a.date, a.visit_type, a.scheduled_time,
        a.eligibility_status, a.copay, a.status AS appointment_status,
        a.medplum_appointment_id, a.medplum_encounter_id
      FROM patients p
      LEFT JOIN appointments a ON a.patient_id = p.id AND a.date = CURRENT_DATE
      WHERE LOWER(REPLACE(p.first_name_encrypted, 'ENC:', '')) = LOWER($1)
        AND LOWER(REPLACE(p.last_name_encrypted, 'ENC:', '')) = LOWER($2)
        AND REPLACE(p.dob_encrypted, 'ENC:', '') = $3
      ORDER BY a.scheduled_time ASC NULLS LAST
      LIMIT 1
    `, [firstName.trim(), lastName.trim(), dob])

    if (!result.rows.length) return res.json({ found: false })

    const r = result.rows[0]

    if (phoneLastFour && r.phone) {
      const stored = r.phone.replace(/\D/g, '').slice(-4)
      if (stored !== phoneLastFour) return res.json({ found: false })
    }

    return res.json({
      found: true,
      patient: {
        id:              r.id,
        firstName:       r.first_name_encrypted.replace('ENC:', ''),
        lastName:        r.last_name_encrypted.replace('ENC:', ''),
        dob:             r.dob_encrypted.replace('ENC:', ''),
        payerName:       r.payer_name,
        payerCode:       r.payer_code,
        memberId:        r.insurance_member_id,
        phone:           r.phone,
        providerId:      r.provider_id,
        medplumPatientId: r.medplum_patient_id
      },
      appointment: r.appointment_id ? {
        id:                    r.appointment_id,
        date:                  r.date,
        visitType:             r.visit_type,
        scheduledTime:         r.scheduled_time,
        eligibilityStatus:     r.eligibility_status,
        copay:                 r.copay != null ? parseFloat(r.copay) : null,
        status:                r.appointment_status || 'booked',
        medplumAppointmentId:  r.medplum_appointment_id,
        medplumEncounterId:    r.medplum_encounter_id
      } : null
    })
  } catch (err) {
    next(err)
  }
})

// ─── Patient Register (public) ────────────────────────────────────────────────

router.post('/patients/register', async (req, res, next) => {
  try {
    const { firstName, lastName, dob, phone } = req.body
    if (!firstName || !lastName || !dob) {
      return res.status(400).json({ error: 'firstName, lastName, and dob required' })
    }

    const provRes = await db.query(
      'SELECT id, medplum_practitioner_id FROM providers ORDER BY id LIMIT 1'
    )
    if (!provRes.rows.length) return res.status(500).json({ error: 'No provider configured' })
    const { id: providerId, medplum_practitioner_id: practitionerId } = provRes.rows[0]

    const token = `PT-${Buffer.from(firstName + lastName + dob).toString('hex').slice(0, 8).toUpperCase()}`

    // Create FHIR Patient in Medplum
    let medplumPatientId = null
    try {
      const fhirPat = await fhir.createFHIRPatient({ firstName, lastName, birthDate: dob, phone })
      medplumPatientId = fhirPat.medplumId
    } catch (err) {
      console.error('[INTAKE] FHIR patient create failed (continuing):', err.message)
    }

    let patientId
    const patRes = await db.query(`
      INSERT INTO patients
        (provider_id, token, first_name_encrypted, last_name_encrypted, dob_encrypted, phone, medplum_patient_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [providerId, token, `ENC:${firstName}`, `ENC:${lastName}`, `ENC:${dob}`, phone || null, medplumPatientId])

    if (patRes.rows.length) {
      patientId = patRes.rows[0].id
    } else {
      const existing = await db.query('SELECT id FROM patients WHERE token = $1', [token])
      patientId = existing.rows[0]?.id
      if (!patientId) return res.status(500).json({ error: 'Failed to create patient' })
    }

    // Create FHIR Appointment + Encounter in Medplum
    let medplumAppointmentId = null
    let medplumEncounterId   = null
    try {
      if (medplumPatientId && practitionerId) {
        medplumAppointmentId = await fhir.createFHIRAppointment({
          medplumPatientId,
          medplumPractitionerId: practitionerId,
          date: new Date().toISOString(),
          visitType: 'Walk-in'
        })
        medplumEncounterId = await fhir.createFHIREncounter({
          medplumPatientId,
          medplumAppointmentId,
          medplumPractitionerId: practitionerId,
          visitType: 'Walk-in'
        })
      }
    } catch (err) {
      console.error('[INTAKE] FHIR appointment/encounter create failed (continuing):', err.message)
    }

    const apptRes = await db.query(`
      INSERT INTO appointments
        (provider_id, patient_id, date, visit_type,
         eligibility_status, eligibility_summary, status,
         medplum_appointment_id, medplum_encounter_id)
      VALUES ($1,$2,CURRENT_DATE,'Walk-in','not_checked','New walk-in patient','booked',$3,$4)
      RETURNING id, date, visit_type, status
    `, [providerId, patientId, medplumAppointmentId, medplumEncounterId])

    const appt = apptRes.rows[0]
    return res.status(201).json({
      patient:     { id: patientId, firstName, lastName, dob, providerId, medplumPatientId },
      appointment: { id: appt.id, date: appt.date, visitType: appt.visit_type, status: appt.status, medplumAppointmentId, medplumEncounterId }
    })
  } catch (err) {
    next(err)
  }
})

// ─── Insurance Extraction (public — GPT-4o Vision) ────────────────────────────

router.post('/insurance/extract', async (req, res, next) => {
  try {
    const { frontImage, backImage } = req.body
    if (!frontImage) return res.status(400).json({ error: 'frontImage required' })

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const content = [
      {
        type: 'text',
        text: `These are the front and back of a health insurance card. Extract all information and return as JSON only:
{
  "payerName": string or null,
  "memberID": string or null,
  "groupNumber": string or null,
  "planName": string or null,
  "subscriberName": string or null,
  "rxBIN": string or null,
  "rxPCN": string or null,
  "copayOffice": string or null,
  "copaySpecialist": string or null,
  "customerServicePhone": string or null,
  "effectiveDate": string or null
}
Return null for unreadable fields. JSON only, no other text.`
      },
      {
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${frontImage}`, detail: 'high' }
      }
    ]

    if (backImage) {
      content.push({ type: 'text', text: 'Here is the back of the same card:' })
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${backImage}`, detail: 'high' } })
    }

    const response = await openai.chat.completions.create({
      model:           'gpt-4o',
      messages:        [{ role: 'user', content }],
      max_tokens:      400,
      response_format: { type: 'json_object' }
    })

    const extracted = JSON.parse(response.choices[0].message.content)
    console.log('[INTAKE] Insurance extracted via GPT-4o Vision')
    return res.json({ extracted })
  } catch (err) {
    console.error('[INTAKE] Insurance extraction error:', err.message)
    next(err)
  }
})

// ─── Save Intake (public — dual-write PostgreSQL + Medplum) ───────────────────

router.post('/intake/:appointmentId', async (req, res, next) => {
  try {
    const appointmentId = parseInt(req.params.appointmentId, 10)
    if (isNaN(appointmentId)) return res.status(400).json({ error: 'Invalid appointment id' })

    const {
      patientId,
      chiefComplaint, complaintDuration, severity,
      currentMedications, allergies, conditions,
      insuranceCardFront, insuranceCardBack, extractedInsurance,
      hipaaAcknowledged, financialConsent, consentToTreat
    } = req.body

    // Get patient + appointment info including Medplum IDs and on-file insurance
    const apptRes = await db.query(`
      SELECT a.patient_id, a.medplum_encounter_id,
             p.medplum_patient_id,
             p.payer_name AS patient_payer_name,
             p.insurance_member_id AS patient_member_id
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE a.id = $1
    `, [appointmentId])

    const apptRow = apptRes.rows[0]
    const pid     = patientId || apptRow?.patient_id
    const medplumEncounterId = apptRow?.medplum_encounter_id
    const medplumPatientId   = apptRow?.medplum_patient_id

    // PostgreSQL upsert
    const existing = await db.query(
      'SELECT id FROM patient_intake WHERE appointment_id = $1', [appointmentId]
    )

    if (existing.rows.length) {
      await db.query(`
        UPDATE patient_intake SET
          chief_complaint = $1, complaint_duration = $2, severity = $3,
          current_medications = $4, allergies = $5, conditions = $6,
          insurance_card_front = $7, insurance_card_back = $8, extracted_insurance = $9,
          hipaa_acknowledged = $10, financial_consent = $11, consent_to_treat = $12,
          submitted_at = NOW()
        WHERE appointment_id = $13
      `, [chiefComplaint, complaintDuration, severity || null,
          JSON.stringify(currentMedications || []),
          JSON.stringify(allergies || []),
          JSON.stringify(conditions || []),
          insuranceCardFront ? 'captured' : null,
          insuranceCardBack  ? 'captured' : null,
          extractedInsurance ? JSON.stringify(extractedInsurance) : null,
          hipaaAcknowledged || false, financialConsent || false,
          consentToTreat || false, appointmentId])
    } else {
      await db.query(`
        INSERT INTO patient_intake (
          patient_id, appointment_id, chief_complaint, complaint_duration, severity,
          current_medications, allergies, conditions,
          insurance_card_front, insurance_card_back, extracted_insurance,
          hipaa_acknowledged, financial_consent, consent_to_treat, submitted_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
      `, [pid, appointmentId, chiefComplaint, complaintDuration, severity || null,
          JSON.stringify(currentMedications || []),
          JSON.stringify(allergies || []),
          JSON.stringify(conditions || []),
          insuranceCardFront ? 'captured' : null,
          insuranceCardBack  ? 'captured' : null,
          extractedInsurance ? JSON.stringify(extractedInsurance) : null,
          hipaaAcknowledged || false, financialConsent || false,
          consentToTreat || false])
    }

    await db.query(`
      UPDATE appointments
      SET status = 'intake_complete', intake_completed_at = NOW()
      WHERE id = $1
    `, [appointmentId])

    // FHIR dual-write (non-blocking — don't fail intake if FHIR write fails)
    if (medplumPatientId) {
      // Always run saveFHIRIntake — consents must be saved even when allergies/conditions are empty
      fhir.saveFHIRIntake({
        medplumPatientId,
        medplumEncounterId,
        chiefComplaint,
        medications: (currentMedications || []).map(m => typeof m === 'string' ? m : m.name || m),
        allergies:   (allergies || []).map(a => typeof a === 'string' ? a : a.name || a),
        conditions:  (conditions || []).map(c => typeof c === 'string' ? c : c.name || c),
        consents:    { hipaa: hipaaAcknowledged, treatment: consentToTreat, financial: financialConsent }
      }).catch(err => console.error('[INTAKE] FHIR intake save failed (non-blocking):', err.message))

      // Save Coverage — prefer submitted insurance data, fall back to patient's on-file insurance
      const insurancePayerName = extractedInsurance?.payerName || apptRow?.patient_payer_name
      const insuranceMemberId  = extractedInsurance?.memberID  || apptRow?.patient_member_id
      if (insurancePayerName) {
        fhir.savePatientInsurance(medplumPatientId, {
          payerName:   insurancePayerName,
          memberId:    insuranceMemberId  || null,
          groupNumber: extractedInsurance?.groupNumber || null,
          planName:    extractedInsurance?.planName    || null
        }).catch(err => console.error('[INTAKE] FHIR coverage save failed (non-blocking):', err.message))
      }
    }

    console.log(`[INTAKE] Intake saved for appointment ${appointmentId}`)
    return res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// ─── Get Intake ───────────────────────────────────────────────────────────────

router.get('/intake/:appointmentId', verifyAnyJWT, async (req, res, next) => {
  try {
    const appointmentId = parseInt(req.params.appointmentId, 10)
    const result = await db.query(
      'SELECT * FROM patient_intake WHERE appointment_id = $1', [appointmentId]
    )
    if (!result.rows.length) return res.json({ intake: null })
    const r = result.rows[0]
    return res.json({
      intake: {
        id:                 r.id,
        chiefComplaint:     r.chief_complaint,
        complaintDuration:  r.complaint_duration,
        severity:           r.severity,
        currentMedications: r.current_medications || [],
        allergies:          r.allergies || [],
        conditions:         r.conditions || [],
        extractedInsurance: r.extracted_insurance,
        cardCaptured:       !!r.insurance_card_front,
        hipaaAcknowledged:  r.hipaa_acknowledged,
        financialConsent:   r.financial_consent,
        consentToTreat:     r.consent_to_treat,
        submittedAt:        r.submitted_at
      }
    })
  } catch (err) {
    next(err)
  }
})

// ─── Save Vitals (dual-write) ─────────────────────────────────────────────────

router.post('/vitals', verifyAnyJWT, async (req, res, next) => {
  try {
    const {
      appointmentId, patientId,
      bpSystolic, bpDiastolic, heartRate, temperature,
      weightLbs, heightInches, o2Saturation, recordedBy
    } = req.body

    if (!appointmentId) return res.status(400).json({ error: 'appointmentId required' })

    const apptRes = await db.query(`
      SELECT a.patient_id, a.provider_id, a.medplum_encounter_id,
             p.medplum_patient_id
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE a.id = $1
    `, [appointmentId])

    const apptRow = apptRes.rows[0]
    const pid     = patientId || apptRow?.patient_id
    const medplumEncounterId = apptRow?.medplum_encounter_id
    const medplumPatientId   = apptRow?.medplum_patient_id
    const providerId = req.user.providerId || req.user.maProviderId || apptRow?.provider_id || 1

    // PostgreSQL upsert
    const existing = await db.query('SELECT id FROM vitals WHERE appointment_id = $1', [appointmentId])
    if (existing.rows.length) {
      await db.query(`
        UPDATE vitals SET
          bp_systolic=$1, bp_diastolic=$2, heart_rate=$3, temperature=$4,
          weight_lbs=$5, height_inches=$6, o2_saturation=$7,
          recorded_by=$8, recorded_at=NOW()
        WHERE appointment_id=$9
      `, [bpSystolic, bpDiastolic, heartRate, temperature,
          weightLbs, heightInches, o2Saturation, recordedBy || 'MA', appointmentId])
    } else {
      await db.query(`
        INSERT INTO vitals
          (appointment_id, patient_id, provider_id,
           bp_systolic, bp_diastolic, heart_rate, temperature,
           weight_lbs, height_inches, o2_saturation, recorded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [appointmentId, pid, providerId,
          bpSystolic, bpDiastolic, heartRate, temperature,
          weightLbs, heightInches, o2Saturation, recordedBy || 'MA'])
    }

    await db.query(`UPDATE appointments SET status = 'vitals_done' WHERE id = $1`, [appointmentId])

    // FHIR dual-write (non-blocking)
    if (medplumPatientId) {
      fhir.saveFHIRVitals({
        medplumPatientId,
        medplumEncounterId,
        bpSystolic, bpDiastolic, heartRate, temperature,
        weightLbs, o2Saturation
      }).catch(err => console.error('[INTAKE] FHIR vitals save failed (non-blocking):', err.message))
    }

    console.log(`[INTAKE] Vitals saved for appointment ${appointmentId}`)
    return res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// ─── Get Vitals ───────────────────────────────────────────────────────────────

router.get('/vitals/:appointmentId', verifyAnyJWT, async (req, res, next) => {
  try {
    const appointmentId = parseInt(req.params.appointmentId, 10)
    const result = await db.query('SELECT * FROM vitals WHERE appointment_id = $1', [appointmentId])
    if (!result.rows.length) return res.json({ vitals: null })
    const v = result.rows[0]
    return res.json({
      vitals: {
        bpSystolic:   v.bp_systolic,
        bpDiastolic:  v.bp_diastolic,
        heartRate:    v.heart_rate,
        temperature:  v.temperature   != null ? parseFloat(v.temperature)   : null,
        weightLbs:    v.weight_lbs    != null ? parseFloat(v.weight_lbs)    : null,
        heightInches: v.height_inches != null ? parseFloat(v.height_inches) : null,
        o2Saturation: v.o2_saturation,
        recordedBy:   v.recorded_by,
        recordedAt:   v.recorded_at
      }
    })
  } catch (err) {
    next(err)
  }
})

// ─── Orders ───────────────────────────────────────────────────────────────────

router.post('/orders', verifyJWT, async (req, res, next) => {
  try {
    const { appointmentId, orders } = req.body
    if (!appointmentId || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'appointmentId and orders array required' })
    }

    const providerId = req.user.providerId
    const apptRes = await db.query('SELECT patient_id FROM appointments WHERE id = $1', [appointmentId])
    const patientId = apptRes.rows[0]?.patient_id

    await db.query('DELETE FROM orders WHERE appointment_id = $1', [appointmentId])
    for (const order of orders) {
      await db.query(`
        INSERT INTO orders (appointment_id, patient_id, provider_id, order_type, order_name, order_code, status)
        VALUES ($1,$2,$3,$4,$5,$6,'ordered')
      `, [appointmentId, patientId, providerId,
          order.orderType || 'lab', order.orderName, order.orderCode || null])
    }

    return res.json({ success: true, count: orders.length })
  } catch (err) {
    next(err)
  }
})

router.get('/orders/:appointmentId', verifyAnyJWT, async (req, res, next) => {
  try {
    const appointmentId = parseInt(req.params.appointmentId, 10)
    const result = await db.query(
      'SELECT * FROM orders WHERE appointment_id = $1 ORDER BY ordered_at', [appointmentId]
    )
    return res.json({
      orders: result.rows.map(o => ({
        id:        o.id,
        orderType: o.order_type,
        orderName: o.order_name,
        orderCode: o.order_code,
        status:    o.status,
        orderedAt: o.ordered_at
      }))
    })
  } catch (err) {
    next(err)
  }
})

// ─── Appointment Status Transitions ───────────────────────────────────────────

router.post('/appointments/:id/checkin', verifyAnyJWT, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    await db.query(`UPDATE appointments SET status='checked_in', check_in_time=NOW() WHERE id=$1`, [id])

    // Mirror to FHIR
    const r = await db.query('SELECT medplum_appointment_id FROM appointments WHERE id=$1', [id])
    const mid = r.rows[0]?.medplum_appointment_id
    if (mid) {
      fhir.updateFHIRAppointmentStatus(mid, 'arrived')
        .catch(err => console.error('[INTAKE] FHIR checkin update failed:', err.message))
    }
    return res.json({ success: true })
  } catch (err) { next(err) }
})

router.post('/appointments/:id/vitals-done', verifyAnyJWT, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    await db.query(`UPDATE appointments SET status='vitals_done' WHERE id=$1`, [id])
    return res.json({ success: true })
  } catch (err) { next(err) }
})

router.post('/appointments/:id/ready', verifyAnyJWT, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10)
    await db.query(`UPDATE appointments SET status='provider_ready' WHERE id=$1`, [id])
    return res.json({ success: true })
  } catch (err) { next(err) }
})

// ─── Get Encounter Data (merged PostgreSQL + Medplum) ─────────────────────────

router.get('/encounter/:appointmentId', verifyAnyJWT, async (req, res, next) => {
  try {
    const appointmentId = parseInt(req.params.appointmentId, 10)

    const apptRes = await db.query(`
      SELECT
        a.id, a.date, a.visit_type, a.status,
        a.eligibility_status, a.eligibility_summary,
        a.copay, a.deductible_remaining,
        a.medplum_appointment_id, a.medplum_encounter_id,
        p.id AS patient_id,
        TRIM(
          COALESCE(REPLACE(p.first_name_encrypted,'ENC:',''),'') || ' ' ||
          COALESCE(REPLACE(p.last_name_encrypted, 'ENC:',''),'')
        ) AS patient_name,
        REPLACE(p.dob_encrypted,'ENC:','') AS dob,
        p.payer_name, p.payer_code, p.insurance_member_id AS member_id,
        p.medplum_patient_id,
        pr.medplum_practitioner_id, pr.name AS provider_name
      FROM appointments a
      JOIN patients p  ON p.id = a.patient_id
      JOIN providers pr ON pr.id = a.provider_id
      WHERE a.id = $1
    `, [appointmentId])

    if (!apptRes.rows.length) return res.status(404).json({ error: 'Appointment not found' })
    const appt = apptRes.rows[0]

    // PostgreSQL intake + vitals
    const [intakeRes, vitalsRes, prevVisitsRes] = await Promise.all([
      db.query('SELECT * FROM patient_intake WHERE appointment_id=$1', [appointmentId]),
      db.query('SELECT * FROM vitals WHERE appointment_id=$1', [appointmentId]),
      db.query(`
        SELECT a2.id, a2.date, a2.visit_type,
               cn.soap_subjective, cn.icd10_codes, cn.cpt_code
        FROM appointments a2
        LEFT JOIN clinical_notes cn ON cn.appointment_id = a2.id
        WHERE a2.patient_id = $1 AND a2.id != $2
        ORDER BY a2.date DESC LIMIT 3
      `, [appt.patient_id, appointmentId])
    ])

    const intake = intakeRes.rows[0] || null
    const vitals = vitalsRes.rows[0] || null

    // Medplum enrichment — pull live FHIR data
    let medplumHistory = null
    let fhirVitals     = null
    if (appt.medplum_patient_id) {
      try {
        [medplumHistory, fhirVitals] = await Promise.all([
          fhir.getPatientHistory(appt.medplum_patient_id),
          appt.medplum_encounter_id
            ? fhir.getFHIRVitals(appt.medplum_patient_id, appt.medplum_encounter_id)
            : Promise.resolve(null)
        ])
      } catch (err) {
        console.error('[INTAKE] Medplum history fetch failed (continuing):', err.message)
      }
    }

    // Merge vitals: prefer today's PostgreSQL record, fall back to FHIR
    const mergedVitals = vitals
      ? {
          bpSystolic:   vitals.bp_systolic,
          bpDiastolic:  vitals.bp_diastolic,
          heartRate:    vitals.heart_rate,
          temperature:  vitals.temperature   != null ? parseFloat(vitals.temperature)   : null,
          weightLbs:    vitals.weight_lbs    != null ? parseFloat(vitals.weight_lbs)    : null,
          heightInches: vitals.height_inches != null ? parseFloat(vitals.height_inches) : null,
          o2Saturation: vitals.o2_saturation,
          source:       'today'
        }
      : fhirVitals
        ? { ...fhirVitals, source: 'medplum' }
        : null

    return res.json({
      appointment: {
        id:                   appt.id,
        date:                 appt.date,
        visitType:            appt.visit_type,
        status:               appt.status,
        eligibilityStatus:    appt.eligibility_status,
        eligibilitySummary:   appt.eligibility_summary,
        copay:                appt.copay != null ? parseFloat(appt.copay) : null,
        deductibleRemaining:  appt.deductible_remaining != null ? parseFloat(appt.deductible_remaining) : null,
        medplumEncounterId:   appt.medplum_encounter_id
      },
      patient: {
        id:             appt.patient_id,
        name:           appt.patient_name.trim(),
        dob:            appt.dob,
        payerName:      appt.payer_name,
        payerCode:      appt.payer_code,
        memberId:       appt.member_id,
        medplumPatientId: appt.medplum_patient_id
      },
      provider: {
        name:                 appt.provider_name,
        medplumPractitionerId: appt.medplum_practitioner_id
      },
      intake: intake ? {
        chiefComplaint:     intake.chief_complaint,
        complaintDuration:  intake.complaint_duration,
        severity:           intake.severity,
        currentMedications: intake.current_medications || [],
        allergies:          intake.allergies || [],
        conditions:         intake.conditions || [],
        extractedInsurance: intake.extracted_insurance,
        cardCaptured:       !!intake.insurance_card_front,
        submittedAt:        intake.submitted_at
      } : null,
      vitals:  mergedVitals,
      medplum: medplumHistory
        ? {
            allergies:        medplumHistory.allergies,
            medications:      medplumHistory.medications,
            conditions:       medplumHistory.conditions,
            recentEncounters: medplumHistory.recentEncounters
          }
        : null,
      previousVisits: prevVisitsRes.rows.map(v => ({
        id:         v.id,
        date:       v.date,
        visitType:  v.visit_type,
        subjective: v.soap_subjective,
        icd10Codes: v.icd10_codes || [],
        cptCode:    v.cpt_code
      }))
    })
  } catch (err) {
    next(err)
  }
})

// ─── Sign Note & Generate Claim (dual-write) ──────────────────────────────────

router.post('/encounter/:id/sign', verifyJWT, async (req, res, next) => {
  try {
    const appointmentId = parseInt(req.params.id, 10)
    const providerId    = req.user.providerId
    const { subjective, objective, assessment, plan, icd10Codes, cptCode, cptModifier } = req.body

    if (!icd10Codes?.length) return res.status(400).json({ error: 'At least one ICD-10 code required' })
    if (!cptCode)            return res.status(400).json({ error: 'CPT code required' })

    const apptRes = await db.query(`
      SELECT a.*, p.token, p.payer_code, p.payer_name, p.insurance_member_id,
             p.medplum_patient_id, a.medplum_encounter_id,
             pr.medplum_practitioner_id
      FROM appointments a
      JOIN patients p  ON p.id = a.patient_id
      JOIN providers pr ON pr.id = a.provider_id
      WHERE a.id = $1 AND a.provider_id = $2
    `, [appointmentId, providerId])

    if (!apptRes.rows.length) return res.status(404).json({ error: 'Appointment not found' })
    const appt = apptRes.rows[0]

    // Save/update PostgreSQL clinical note
    const existNote = await db.query('SELECT id FROM clinical_notes WHERE appointment_id=$1', [appointmentId])
    if (existNote.rows.length) {
      await db.query(`
        UPDATE clinical_notes SET
          soap_subjective=$1, soap_objective=$2, soap_assessment=$3, soap_plan=$4,
          icd10_codes=$5, cpt_code=$6, cpt_modifier=$7,
          signed_at=NOW(), signed_by=$8, updated_at=NOW()
        WHERE appointment_id=$9
      `, [subjective, objective, assessment, plan,
          JSON.stringify(icd10Codes), cptCode, cptModifier || null,
          req.user.name || 'Provider', appointmentId])
    } else {
      await db.query(`
        INSERT INTO clinical_notes
          (appointment_id, patient_id, provider_id,
           soap_subjective, soap_objective, soap_assessment, soap_plan,
           icd10_codes, cpt_code, cpt_modifier, signed_at, signed_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
      `, [appointmentId, appt.patient_id, providerId,
          subjective, objective, assessment, plan,
          JSON.stringify(icd10Codes), cptCode, cptModifier || null,
          req.user.name || 'Provider'])
    }

    // FHIR dual-write for note (non-blocking)
    if (appt.medplum_patient_id && appt.medplum_encounter_id) {
      fhir.saveFHIRNote({
        medplumPatientId:      appt.medplum_patient_id,
        medplumEncounterId:    appt.medplum_encounter_id,
        medplumPractitionerId: appt.medplum_practitioner_id,
        subjective, objective, assessment, plan, icd10Codes, cptCode
      }).then(compositionId => {
        console.log(`[INTAKE] FHIR Composition saved: ${compositionId}`)
      }).catch(err => console.error('[INTAKE] FHIR note save failed (non-blocking):', err.message))
    }

    // Run claim scrub
    const { runClaimScrubAgent } = require('../../agents/claimScrubAgent')
    const provRes = await db.query('SELECT npi, tax_id FROM providers WHERE id=$1', [providerId])
    const provider = provRes.rows[0]

    const CPT_AMOUNTS = {
      '99202': 180, '99203': 200, '99204': 250, '99205': 320,
      '99211': 75,  '99212': 110, '99213': 150, '99214': 220, '99215': 280,
      '99395': 280, '99396': 280
    }
    const billedAmount = CPT_AMOUNTS[cptCode] || 200
    const dosStr = appt.date instanceof Date
      ? appt.date.toISOString().split('T')[0]
      : String(appt.date).split('T')[0]

    const scrubResult = await runClaimScrubAgent({
      claimId:        `CLM-ENC-${appointmentId}`,
      providerNPI:    provider?.npi || process.env.PROVIDER_NPI,
      providerTaxId:  provider?.tax_id || process.env.PROVIDER_TAX_ID,
      patientToken:   appt.token,
      payerCode:      appt.payer_code,
      dateOfService:  dosStr,
      placeOfService: '11',
      diagnosisCodes: icd10Codes,
      serviceLines:   [{ procedureCode: cptCode, modifiers: cptModifier ? [cptModifier] : [], billedAmount, units: 1 }],
      complexity:     'moderate',
      noteDocumented: true
    })

    let claimId = null
    let claimNumber = null

    if (scrubResult.passed) {
      claimNumber = `CLM-${String(appointmentId).padStart(5, '0')}-${(appt.payer_code || 'UNK').slice(0, 3)}`
      const claimRes = await db.query(`
        INSERT INTO claims
          (provider_id, patient_id, appointment_id, claim_number,
           status, billed_amount, payer_code, payer_name, date_of_service, submitted_at)
        VALUES ($1,$2,$3,$4,'ready_to_submit',$5,$6,$7,$8,NOW())
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [providerId, appt.patient_id, appointmentId, claimNumber,
          billedAmount, appt.payer_code, appt.payer_name, appt.date])

      if (claimRes.rows.length) {
        claimId = claimRes.rows[0].id
        await db.query(
          `INSERT INTO claim_lines (claim_id, procedure_code, billed_amount, units) VALUES ($1,$2,$3,1)`,
          [claimId, cptCode, billedAmount]
        )
      }
    }

    await db.query(`UPDATE appointments SET status='complete' WHERE id=$1`, [appointmentId])
    console.log(`[INTAKE] Note signed for appointment ${appointmentId}`)

    return res.json({
      scrub: scrubResult,
      claim: scrubResult.passed ? {
        id:           claimId,
        claimNumber,
        cptCode,
        icd10Codes,
        billedAmount,
        payer:        appt.payer_name,
        status:       'ready_to_submit'
      } : null
    })
  } catch (err) {
    next(err)
  }
})

// ─── Get Clinical Note ────────────────────────────────────────────────────────

router.get('/encounter/:id/note', verifyAnyJWT, async (req, res, next) => {
  try {
    const appointmentId = parseInt(req.params.id, 10)
    const result = await db.query(
      'SELECT * FROM clinical_notes WHERE appointment_id=$1', [appointmentId]
    )
    if (!result.rows.length) return res.json({ note: null })
    const n = result.rows[0]
    return res.json({
      note: {
        subjective:  n.soap_subjective,
        objective:   n.soap_objective,
        assessment:  n.soap_assessment,
        plan:        n.soap_plan,
        icd10Codes:  n.icd10_codes || [],
        cptCode:     n.cpt_code,
        cptModifier: n.cpt_modifier,
        signedAt:    n.signed_at,
        signedBy:    n.signed_by
      }
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
