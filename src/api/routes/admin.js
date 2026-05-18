const express = require('express')
const router  = express.Router()

function requireWebhookSecret(req, res, next) {
  const secret = req.headers['x-webhook-secret']
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// POST /api/admin/refresh-payer-policies
// Runs the full payer policy scraper on demand.
// Header: X-Webhook-Secret required
router.post('/admin/refresh-payer-policies', requireWebhookSecret, async (req, res) => {
  try {
    const { runPayerPolicyScraper } = require('../../lib/payerPolicyScraper')
    console.log('[ADMIN] Manual payer policy refresh triggered')
    const stats = await runPayerPolicyScraper()
    res.json({
      updated:     stats.updated,
      failed:      stats.failed,
      payers:      stats.payers,
      cptsUpdated: stats.cptsUpdated,
      refreshedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[ADMIN] Payer policy refresh failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
