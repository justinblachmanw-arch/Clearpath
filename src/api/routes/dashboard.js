require('dotenv').config()
const { Router }  = require('express')
const { verifyJWT } = require('../middleware/auth')
const db          = require('../../db')

const router = Router()

// Strip the dev-mode ENC: prefix to get the display name
const nameExpr = `
  TRIM(COALESCE(REPLACE(p.first_name_encrypted, 'ENC:', ''), '')) || ' ' ||
  TRIM(COALESCE(REPLACE(p.last_name_encrypted,  'ENC:', ''), ''))
`

router.get('/dashboard', verifyJWT, async (req, res, next) => {
  try {
    const pid = req.user.providerId

    const [
      providerRes,
      metricsRes,
      todayApptRes,
      actionRes,
      credRes,
      payerRes
    ] = await Promise.all([

      db.query('SELECT name, specialty FROM providers WHERE id = $1', [pid]),

      db.query(`
        SELECT
          (SELECT COALESCE(SUM(billed_amount), 0)
             FROM claims WHERE provider_id = $1 AND DATE(date_of_service) = CURRENT_DATE
          ) AS today_revenue,
          (SELECT COUNT(*)
             FROM claims WHERE provider_id = $1 AND status IN ('needs_action','denied')
          ) AS claims_needing_action,
          (SELECT COALESCE(SUM(billed_amount - COALESCE(paid_amount,0)), 0)
             FROM claims WHERE provider_id = $1 AND status <> 'paid'
          ) AS outstanding_ar,
          (SELECT ROUND(
               COUNT(*) FILTER (WHERE status NOT IN ('denied','needs_action')) * 100.0
               / NULLIF(COUNT(*), 0), 1)
             FROM claims
             WHERE provider_id = $1 AND created_at > NOW() - INTERVAL '30 days'
          ) AS clean_claim_rate
      `, [pid]),

      db.query(`
        SELECT a.id, a.visit_type, a.eligibility_status, a.copay,
               ${nameExpr} AS patient_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.provider_id = $1 AND DATE(a.date) = CURRENT_DATE
        ORDER BY a.id
      `, [pid]),

      db.query(`
        SELECT id, priority, title, description, ai_instruction, source_agent, created_at
        FROM action_items
        WHERE provider_id = $1 AND resolved = FALSE
        ORDER BY priority ASC, created_at DESC
        LIMIT 20
      `, [pid]),

      db.query(`
        SELECT credential_type AS type,
               (expiry_date - CURRENT_DATE)::INTEGER AS days_remaining,
               expiry_date,
               CASE
                 WHEN expiry_date <  CURRENT_DATE       THEN 1
                 WHEN expiry_date <= CURRENT_DATE + 30  THEN 1
                 WHEN expiry_date <= CURRENT_DATE + 60  THEN 5
                 ELSE 6 END AS priority
        FROM credentials
        WHERE provider_id = $1
          AND expiry_date IS NOT NULL
          AND expiry_date <= CURRENT_DATE + 90
        ORDER BY expiry_date ASC
      `, [pid]),

      db.query(`
        SELECT payer_name AS payer, payer_code,
               COUNT(*) AS total_claims,
               COUNT(*) FILTER (WHERE status = 'denied') AS denied_claims,
               ROUND(COUNT(*) FILTER (WHERE status='denied') * 100.0
                     / NULLIF(COUNT(*), 0), 1) AS denial_rate
        FROM claims
        WHERE provider_id = $1
        GROUP BY payer_name, payer_code
        HAVING COUNT(*) FILTER (WHERE status = 'denied') > 0
        ORDER BY denial_rate DESC
        LIMIT 5
      `, [pid])
    ])

    // Top denial code per payer — one small query each
    const payerPatterns = await Promise.all(
      payerRes.rows.map(async row => {
        const codeRes = await db.query(`
          SELECT adj.code, COUNT(*) AS cnt
          FROM claims c
          JOIN claim_lines cl  ON cl.claim_id       = c.id
          JOIN adjustments adj ON adj.claim_line_id  = cl.id
          WHERE c.provider_id = $1 AND c.payer_code = $2 AND c.status = 'denied'
          GROUP BY adj.code ORDER BY cnt DESC LIMIT 1
        `, [pid, row.payer_code])
        const topCode = codeRes.rows[0]?.code || null
        return {
          payer:       row.payer,
          denialRate:  parseFloat(row.denial_rate),
          topCode,
          message: `${row.payer} denial rate is ${row.denial_rate}% `
            + `(${row.denied_claims}/${row.total_claims} claims)`
            + (topCode ? ` — most common: ${topCode}` : '')
        }
      })
    )

    const prov = providerRes.rows[0] || {}
    const m    = metricsRes.rows[0]  || {}

    return res.json({
      provider: { name: prov.name, specialty: prov.specialty },
      metrics: {
        todayRevenue:        parseFloat(m.today_revenue)         || 0,
        claimsNeedingAction: parseInt(m.claims_needing_action)   || 0,
        outstandingAR:       parseFloat(m.outstanding_ar)        || 0,
        cleanClaimRate:      parseFloat(m.clean_claim_rate)      || 0
      },
      todayAppointments: todayApptRes.rows.map(a => ({
        id:               a.id,
        patientName:      a.patient_name.trim(),
        time:             null,
        visitType:        a.visit_type,
        eligibilityStatus: a.eligibility_status,
        copay:            a.copay
      })),
      actionItems: actionRes.rows.map(i => ({
        id:           i.id,
        priority:     i.priority,
        title:        i.title,
        description:  i.description,
        aiInstruction: i.ai_instruction,
        sourceAgent:  i.source_agent,
        createdAt:    i.created_at
      })),
      credentialAlerts: credRes.rows.map(c => ({
        type:          c.type,
        daysRemaining: c.days_remaining,
        expiryDate:    c.expiry_date,
        priority:      c.priority
      })),
      payerPatterns
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
