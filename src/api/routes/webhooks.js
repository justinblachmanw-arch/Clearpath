require('dotenv').config()
const { Router } = require('express')
const { readERA835 } = require('../../lib/ediReader')
const { runERAAgent } = require('../../agents/eraAgent')

const router = Router()

router.post('/webhooks/era', async (req, res, next) => {
  try {
    const secret = req.headers['x-webhook-secret']
    if (secret !== (process.env.WEBHOOK_SECRET || 'clearpath_webhook_secret_dev')) {
      return res.status(403).json({ error: 'Invalid webhook secret' })
    }

    let rawEdi, payerName = null, payerId = null

    if (typeof req.body === 'string') {
      rawEdi = req.body
    } else if (req.body && typeof req.body === 'object') {
      rawEdi    = req.body.ediContent
      payerName = req.body.payerName || null
      payerId   = req.body.payerId   || null
    }

    if (!rawEdi || !String(rawEdi).trim()) {
      return res.status(400).json({ error: 'Missing EDI content' })
    }

    const era = readERA835(rawEdi, { payerName, payerId })
    era.rawEdi = rawEdi

    const result = await runERAAgent([era])

    return res.json({
      claimsProcessed: result.claimsProcessed,
      totalPaid:       result.totalPaid,
      actionItems:     result.actionItems,
      patterns:        result.patterns,
      summary:         result.summary
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
