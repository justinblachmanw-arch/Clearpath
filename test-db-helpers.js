require('dotenv').config()
const db = require('./src/db/index')

async function run() {
  console.log('\n=== TESTING DB HELPER FUNCTIONS ===\n')
  let passed = 0
  let failed = 0

  function ok(label, value) {
    if (value) {
      console.log(`  ✓  ${label}`)
      passed++
    } else {
      console.log(`  ✗  ${label}`)
      failed++
    }
  }

  // ── getProvider ──────────────────────────────────────────────────────
  console.log('[1] getProvider')
  const provider = await db.getProvider(1)
  ok('returns provider object',    !!provider)
  ok('name is Dr. Anjali Patel',   provider?.name === 'Dr. Anjali Patel')
  ok('npi present',                !!provider?.npi)
  const missing = await db.getProvider(9999)
  ok('returns null for unknown id', missing === null)

  // ── getAppointmentsByDate ────────────────────────────────────────────
  console.log('\n[2] getAppointmentsByDate')
  const appts = await db.getAppointmentsByDate(1, '2026-05-14')
  ok('returns array',              Array.isArray(appts))
  ok('has appointments on 5/14',   appts.length > 0)
  ok('includes patient_token',     !!appts[0]?.patient_token)
  ok('includes payer_code',        appts[0]?.payer_code !== undefined)
  const none = await db.getAppointmentsByDate(1, '2000-01-01')
  ok('returns [] for empty date',  Array.isArray(none) && none.length === 0)

  // ── saveEligibilityResult ────────────────────────────────────────────
  console.log('\n[3] saveEligibilityResult')
  const updated = await db.saveEligibilityResult(1, 'active', 'Test eligibility summary', 25.00, 150.00)
  ok('returns updated row',        !!updated)
  ok('returns correct id',         updated?.id === 1)

  // ── saveERAFile ──────────────────────────────────────────────────────
  console.log('\n[4] saveERAFile')
  const era = await db.saveERAFile({
    providerId: 1, payerName: 'Test Payer', payerId: 'TP001',
    checkNumber: 'CHK-TEST-001', checkDate: '2026-05-14',
    totalPaid: 999.99, claimsCount: 5, parseWarning: null, rawEdi: null
  })
  ok('returns era row with id',    !!era?.id)

  // ── saveClaim ────────────────────────────────────────────────────────
  console.log('\n[5] saveClaim')
  const claim = await db.saveClaim({
    providerId: 1, patientId: 1, appointmentId: null,
    claimNumber: 'CLM-TEST-9999', status: 'pending',
    billedAmount: 250.00, paidAmount: 0, patientResponsibility: 0,
    contractualAdjustment: 0, payerCode: 'AET', payerName: 'Aetna',
    dateOfService: '2026-05-14'
  })
  ok('returns claim row with id',  !!claim?.id)

  // ── saveActionItem ───────────────────────────────────────────────────
  console.log('\n[6] saveActionItem')
  const item = await db.saveActionItem({
    providerId: 1, type: 'test_type', priority: 5,
    title: 'Test action item', description: 'Test description',
    aiInstruction: 'Test instruction', sourceAgent: 'test-agent', sourceId: 'test-123'
  })
  ok('returns action item with id', !!item?.id)

  // ── getOpenActionItems ───────────────────────────────────────────────
  console.log('\n[7] getOpenActionItems')
  const openItems = await db.getOpenActionItems(1)
  ok('returns array',              Array.isArray(openItems))
  ok('has open items',             openItems.length > 0)
  ok('all items are unresolved',   openItems.every(i => i.resolved === false))
  ok('sorted by priority asc',     openItems[0].priority <= openItems[openItems.length - 1].priority)

  // ── updateActionItemResolved ─────────────────────────────────────────
  console.log('\n[8] updateActionItemResolved')
  const resolved = await db.updateActionItemResolved(item.id)
  ok('returns resolved row',       !!resolved)
  ok('returns correct id',         resolved?.id === item.id)
  const openAfter = await db.getOpenActionItems(1)
  ok('item no longer in open list', !openAfter.find(i => i.id === item.id))

  // ── getCredentials ───────────────────────────────────────────────────
  console.log('\n[9] getCredentials')
  const creds = await db.getCredentials(1)
  ok('returns array',              Array.isArray(creds))
  ok('has 6 credentials',          creds.length === 6)
  ok('includes NPI',               creds.some(c => c.credential_type === 'npi'))
  ok('includes DEA',               creds.some(c => c.credential_type === 'dea'))

  // ── getExpiringCredentials ───────────────────────────────────────────
  console.log('\n[10] getExpiringCredentials')
  const expiring90 = await db.getExpiringCredentials(1, 90)
  ok('returns array',              Array.isArray(expiring90))
  ok('finds creds expiring in 90d', expiring90.length > 0)
  ok('all have expiry_date set',   expiring90.every(c => c.expiry_date !== null))
  const expiring5 = await db.getExpiringCredentials(1, 5)
  ok('CAQH expiring in 1d in 5d window', expiring5.some(c => c.credential_type === 'caqh'))

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(err => {
  console.error('Test error:', err.message)
  process.exit(1)
})
