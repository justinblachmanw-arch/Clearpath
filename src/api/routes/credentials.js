require('dotenv').config()
const { Router }    = require('express')
const { verifyJWT } = require('../middleware/auth')
const db            = require('../../db')

const router = Router()

router.get('/credentials', verifyJWT, async (req, res, next) => {
  try {
    const pid = req.user.providerId

    const [credRows, enrollRows] = await Promise.all([
      db.query(`
        SELECT id, credential_type, identifier, issuing_body, state,
               expiry_date, status, renewal_url,
               CASE
                 WHEN expiry_date IS NULL THEN NULL
                 ELSE (expiry_date - CURRENT_DATE)::INTEGER
               END AS days_remaining
        FROM credentials
        WHERE provider_id = $1
        ORDER BY expiry_date ASC NULLS LAST
      `, [pid]),
      db.query(`
        SELECT id, payer_code, payer_name, status, effective_date, expiry_date
        FROM payer_enrollments
        WHERE provider_id = $1
        ORDER BY payer_name
      `, [pid])
    ])

    return res.json({
      credentials: credRows.rows.map(c => ({
        id:             c.id,
        credentialType: c.credential_type,
        identifier:     c.identifier,
        issuingBody:    c.issuing_body,
        state:          c.state,
        expiryDate:     c.expiry_date,
        status:         c.status,
        renewalUrl:     c.renewal_url,
        daysRemaining:  c.days_remaining
      })),
      enrollments: enrollRows.rows.map(e => ({
        id:            e.id,
        payerCode:     e.payer_code,
        payerName:     e.payer_name,
        status:        e.status,
        effectiveDate: e.effective_date,
        expiryDate:    e.expiry_date
      }))
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
