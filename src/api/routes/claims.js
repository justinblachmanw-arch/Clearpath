require('dotenv').config()
const { Router }    = require('express')
const { verifyJWT } = require('../middleware/auth')
const db            = require('../../db')

const router = Router()

const ALLOWED_STATUSES = new Set(['denied', 'needs_action', 'pending'])

router.get('/claims/action-items', verifyJWT, async (req, res, next) => {
  try {
    const pid            = req.user.providerId
    const { status, payer } = req.query

    const params = [pid]

    // Base status filter — caller can narrow to one status
    let statusFilter
    if (status && ALLOWED_STATUSES.has(status)) {
      params.push(status)
      statusFilter = `c.status = $${params.length}`
    } else {
      statusFilter = `c.status IN ('denied','needs_action')`
    }

    let payerFilter = ''
    if (payer) {
      params.push(payer.toUpperCase())
      payerFilter = `AND c.payer_code = $${params.length}`
    }

    // DISTINCT ON keeps one row per claim (highest-value adjustment first)
    const result = await db.query(`
      SELECT DISTINCT ON (c.id)
        c.id,
        c.claim_number,
        c.date_of_service,
        c.billed_amount,
        c.paid_amount,
        c.status,
        c.payer_code,
        c.payer_name,
        TRIM(
          COALESCE(REPLACE(p.first_name_encrypted,'ENC:',''),'') || ' ' ||
          COALESCE(REPLACE(p.last_name_encrypted, 'ENC:',''),'')
        ) AS patient_name,
        cl.procedure_code,
        adj.code          AS denial_code,
        adj.plain_english AS denial_plain,
        adj.fix_instruction AS ai_instruction,
        CASE
          WHEN c.billed_amount >= 500 THEN 2
          WHEN c.billed_amount >= 200 THEN 3
          ELSE 4 END AS priority
      FROM claims c
      JOIN patients p    ON p.id          = c.patient_id
      LEFT JOIN claim_lines cl ON cl.claim_id  = c.id
      LEFT JOIN adjustments adj ON adj.claim_line_id = cl.id
      WHERE c.provider_id = $1
        AND ${statusFilter}
        ${payerFilter}
      ORDER BY c.id, adj.amount DESC NULLS LAST
    `, params)

    const claims        = result.rows
    const revenueAtRisk = claims.reduce((s, c) => s + (parseFloat(c.billed_amount) || 0), 0)

    return res.json({
      total:        claims.length,
      revenueAtRisk,
      claims: claims.map(c => ({
        id:           c.id,
        claimId:      c.claim_number,
        patientName:  c.patient_name.trim(),
        dateOfService: c.date_of_service,
        procedureCode: c.procedure_code,
        billedAmount: parseFloat(c.billed_amount),
        paidAmount:   parseFloat(c.paid_amount) || 0,
        status:       c.status,
        denialCode:   c.denial_code,
        denialPlain:  c.denial_plain,
        aiInstruction: c.ai_instruction,
        priority:     c.priority
      }))
    })
  } catch (err) {
    next(err)
  }
})

router.get('/claims/denial-trend', verifyJWT, async (req, res, next) => {
  try {
    const pid = req.user.providerId

    const [trendRes, topCodesRes] = await Promise.all([
      db.query(`
        SELECT
          DATE_TRUNC('month', date_of_service)                  AS month,
          TO_CHAR(DATE_TRUNC('month', date_of_service), 'Mon')  AS label,
          COUNT(*)                                               AS total,
          COUNT(*) FILTER (WHERE status = 'denied')             AS denied,
          ROUND(COUNT(*) FILTER (WHERE status = 'denied') * 100.0
            / NULLIF(COUNT(*), 0), 1)                           AS denial_rate
        FROM claims
        WHERE provider_id = $1
          AND date_of_service >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', date_of_service)
        ORDER BY month ASC
      `, [pid]),

      db.query(`
        SELECT adj.code, adj.plain_english, COUNT(*) AS cnt
        FROM claims c
        JOIN claim_lines cl  ON cl.claim_id      = c.id
        JOIN adjustments adj ON adj.claim_line_id = cl.id
        WHERE c.provider_id = $1 AND c.status = 'denied'
          AND c.date_of_service >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY adj.code, adj.plain_english
        ORDER BY cnt DESC
        LIMIT 3
      `, [pid])
    ])

    return res.json({
      trend: trendRes.rows.map(r => ({
        month:      r.label,
        total:      parseInt(r.total),
        denied:     parseInt(r.denied),
        denialRate: parseFloat(r.denial_rate) || 0
      })),
      topCodes: topCodesRes.rows.map(r => ({
        code:        r.code,
        description: r.plain_english,
        count:       parseInt(r.cnt)
      }))
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
