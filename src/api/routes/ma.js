require('dotenv').config()
const { Router } = require('express')
const jwt        = require('jsonwebtoken')
const db         = require('../../db')

const router = Router()

function verifyMAJWT(req, res, next) {
  const header = req.headers['authorization']
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'clearpath_jwt_secret_dev')
    if (payload.role !== 'ma') return res.status(403).json({ error: 'MA credentials required' })
    req.ma = payload
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ─── MA Login ─────────────────────────────────────────────────────────────────

router.post('/ma/login', async (req, res, next) => {
  try {
    const { pin } = req.body
    if (!pin) return res.status(400).json({ error: 'PIN required' })

    const result = await db.query(
      'SELECT id, name, provider_id FROM ma_users WHERE pin = $1', [pin]
    )
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid PIN' })

    const ma = result.rows[0]
    const token = jwt.sign(
      { maId: ma.id, name: ma.name, maProviderId: ma.provider_id, role: 'ma' },
      process.env.JWT_SECRET || 'clearpath_jwt_secret_dev',
      { expiresIn: '8h' }
    )

    console.log(`[MA] ${ma.name} logged in`)
    return res.json({ token, ma: { id: ma.id, name: ma.name, providerId: ma.provider_id } })
  } catch (err) {
    next(err)
  }
})

// ─── MA Schedule — Today's Patients ───────────────────────────────────────────

router.get('/ma/schedule', verifyMAJWT, async (req, res, next) => {
  try {
    const providerId = req.ma.maProviderId

    const result = await db.query(`
      SELECT
        a.id,
        a.date,
        a.visit_type,
        a.scheduled_time,
        a.eligibility_status,
        a.copay,
        a.deductible_remaining,
        COALESCE(a.status, 'booked')     AS appointment_status,
        a.check_in_time,
        a.intake_completed_at,
        TRIM(
          COALESCE(REPLACE(p.first_name_encrypted, 'ENC:', ''), '') || ' ' ||
          COALESCE(REPLACE(p.last_name_encrypted,  'ENC:', ''), '')
        )                                AS patient_name,
        REPLACE(p.dob_encrypted, 'ENC:', '') AS dob,
        p.payer_name,
        p.payer_code,
        (SELECT COUNT(*) > 0 FROM patient_intake pi WHERE pi.appointment_id = a.id) AS has_intake,
        (SELECT COUNT(*) > 0 FROM vitals v        WHERE v.appointment_id = a.id)    AS has_vitals
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE a.provider_id = $1 AND a.date = CURRENT_DATE
      ORDER BY a.scheduled_time ASC NULLS LAST
    `, [providerId])

    return res.json({
      schedule: result.rows.map(r => ({
        id:                r.id,
        patientName:       r.patient_name.trim(),
        dob:               r.dob,
        visitType:         r.visit_type,
        scheduledTime:     r.scheduled_time,
        eligibilityStatus: r.eligibility_status,
        copay:             r.copay != null ? parseFloat(r.copay) : null,
        payerName:         r.payer_name,
        payerCode:         r.payer_code,
        status:            r.appointment_status,
        checkInTime:       r.check_in_time,
        intakeCompletedAt: r.intake_completed_at,
        hasIntake:         r.has_intake,
        hasVitals:         r.has_vitals
      }))
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
