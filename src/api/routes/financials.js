require('dotenv').config()
const { Router }    = require('express')
const { verifyJWT } = require('../middleware/auth')
const db            = require('../../db')

const router = Router()

router.get('/financials/summary', verifyJWT, async (req, res, next) => {
  try {
    const pid = req.user.providerId

    const [revenueRes, payerRes] = await Promise.all([
      db.query(`
        SELECT
          COALESCE(SUM(paid_amount), 0)                       AS revenue_collected,
          COALESCE(SUM(billed_amount), 0)                     AS total_billed,
          COALESCE(SUM(billed_amount - COALESCE(paid_amount,0))
            FILTER (WHERE status <> 'paid'), 0)               AS outstanding_ar
        FROM claims WHERE provider_id = $1
      `, [pid]),

      db.query(`
        SELECT
          COALESCE(payer_name, payer_code, 'Unknown') AS payer,
          COALESCE(SUM(billed_amount), 0)             AS billed,
          COALESCE(SUM(paid_amount), 0)               AS collected
        FROM claims
        WHERE provider_id = $1
        GROUP BY payer_name, payer_code
        ORDER BY billed DESC
        LIMIT 6
      `, [pid])
    ])

    const m = revenueRes.rows[0]

    // Fixed monthly expense estimates (no expenses table yet)
    const expenses = [
      { category: 'Office Rent',           amount: 3500, type: 'fixed'    },
      { category: 'Malpractice Insurance', amount: 800,  type: 'fixed'    },
      { category: 'EHR Subscription',      amount: 299,  type: 'fixed'    },
      { category: 'Medical Supplies',      amount: 1200, type: 'variable' },
      { category: 'Staff (1 FTE)',         amount: 5500, type: 'fixed'    },
      { category: 'Billing Software',      amount: 199,  type: 'fixed'    },
    ]

    const totalExpenses    = expenses.reduce((s, e) => s + e.amount, 0)
    const revenueCollected = parseFloat(m.revenue_collected) || 0
    const netIncome        = revenueCollected - totalExpenses

    return res.json({
      revenueCollected,
      totalBilled:    parseFloat(m.total_billed)    || 0,
      outstandingAR:  parseFloat(m.outstanding_ar)  || 0,
      totalExpenses,
      netIncome,
      revenueByPayer: payerRes.rows.map(r => ({
        payer:     r.payer,
        billed:    parseFloat(r.billed)    || 0,
        collected: parseFloat(r.collected) || 0,
      })),
      expenses
    })
  } catch (err) {
    next(err)
  }
})

router.get('/financials/monthly-trend', verifyJWT, async (req, res, next) => {
  try {
    const pid = req.user.providerId
    const MONTHLY_EXPENSES = 11498

    const [revenueRes, visitsRes] = await Promise.all([
      db.query(`
        SELECT
          DATE_TRUNC('month', date_of_service)                  AS month,
          TO_CHAR(DATE_TRUNC('month', date_of_service), 'Mon')  AS label,
          COALESCE(SUM(paid_amount), 0)                         AS revenue
        FROM claims
        WHERE provider_id = $1
          AND date_of_service >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', date_of_service)
        ORDER BY month ASC
      `, [pid]),

      db.query(`
        SELECT
          DATE_TRUNC('month', date) AS month,
          COUNT(*)                  AS visits
        FROM appointments
        WHERE provider_id = $1
          AND date >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', date)
        ORDER BY month ASC
      `, [pid])
    ])

    const visitsMap = {}
    visitsRes.rows.forEach(r => {
      visitsMap[r.month.toISOString()] = parseInt(r.visits)
    })

    return res.json(revenueRes.rows.map(r => {
      const revenue = parseFloat(r.revenue) || 0
      return {
        month:    r.label,
        revenue,
        expenses: MONTHLY_EXPENSES,
        net:      revenue - MONTHLY_EXPENSES,
        visits:   visitsMap[r.month.toISOString()] || 0
      }
    }))
  } catch (err) {
    next(err)
  }
})

router.get('/financials/payer-trend', verifyJWT, async (req, res, next) => {
  try {
    const pid = req.user.providerId

    const result = await db.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', date_of_service), 'Mon') AS month,
        DATE_TRUNC('month', date_of_service)                  AS month_ts,
        COALESCE(payer_name, payer_code, 'Unknown')           AS payer,
        COALESCE(SUM(paid_amount), 0)                         AS revenue
      FROM claims
      WHERE provider_id = $1
        AND date_of_service >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', date_of_service), payer_name, payer_code
      ORDER BY month_ts ASC
    `, [pid])

    const monthOrder = []
    const monthsSeen = new Set()
    result.rows.forEach(r => {
      if (!monthsSeen.has(r.month)) {
        monthsSeen.add(r.month)
        monthOrder.push(r.month)
      }
    })

    const payerMap = {}
    result.rows.forEach(r => {
      if (!payerMap[r.payer]) payerMap[r.payer] = {}
      payerMap[r.payer][r.month] = parseFloat(r.revenue) || 0
    })

    const series = Object.entries(payerMap).map(([payer, monthData]) => ({
      payer,
      data: monthOrder.map(m => monthData[m] || 0)
    }))

    return res.json({ months: monthOrder, series })
  } catch (err) {
    next(err)
  }
})

module.exports = router
