require('dotenv').config()
const { Router }    = require('express')
const Joi           = require('joi')
const { verifyJWT } = require('../middleware/auth')
const db            = require('../../db')
const { runEligibilityAgent } = require('../../agents/eligibilityAgent')

const router = Router()

const apptSchema = Joi.object({
  patientId:        Joi.number().integer().positive().required(),
  date:             Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  visitType:        Joi.string().min(2).max(100).required(),
  insuranceMemberId: Joi.string().optional().allow(''),
  payerCode:        Joi.string().optional().allow('')
})

router.post('/appointments', verifyJWT, async (req, res, next) => {
  try {
    const { error, value } = apptSchema.validate(req.body)
    if (error) return res.status(400).json({ error: error.details[0].message })

    const { patientId, date, visitType, insuranceMemberId, payerCode } = value
    const providerId = req.user.providerId

    const patientRes = await db.query(
      'SELECT * FROM patients WHERE id = $1 AND provider_id = $2',
      [patientId, providerId]
    )
    if (!patientRes.rows.length) {
      return res.status(404).json({ error: 'Patient not found' })
    }
    const patient = patientRes.rows[0]

    const apptRes = await db.query(
      `INSERT INTO appointments (provider_id, patient_id, date, visit_type)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [providerId, patientId, date, visitType]
    )
    const appt = apptRes.rows[0]

    // Run eligibility inline — wait for result before responding
    let eligibility = null
    try {
      eligibility = await runEligibilityAgent({
        id:                   appt.id,
        patient_token:        patient.token,
        insurance_member_id:  insuranceMemberId || patient.insurance_member_id,
        payer_code:           payerCode || patient.payer_code,
        patient_phone:        patient.phone || null,
        visit_type:           visitType,
        date
      })
    } catch (err) {
      console.error('[API] Eligibility agent error:', err.message)
    }

    // Re-fetch to get eligibility columns written back by the agent
    const updatedRes = await db.query('SELECT * FROM appointments WHERE id = $1', [appt.id])
    const updated    = updatedRes.rows[0]

    return res.status(201).json({
      appointment: {
        id:                updated.id,
        patientId:         updated.patient_id,
        date:              updated.date,
        visitType:         updated.visit_type,
        eligibilityStatus: updated.eligibility_status,
        eligibilitySummary: updated.eligibility_summary,
        copay:             updated.copay,
        deductibleRemaining: updated.deductible_remaining
      },
      eligibility
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
