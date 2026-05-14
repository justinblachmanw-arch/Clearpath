require('dotenv').config()
const { runCredentialingAgent, getMockProviderCredentials, getDaysUntilExpiry, getAlertLevel } = require('./src/agents/credentialingAgent')

async function test() {
  console.log('=== TESTING AGENT 3: CREDENTIALING TRACKER ===\n')

  // Unit test helpers
  console.log('--- Unit: getDaysUntilExpiry ---')
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
  const daysToTomorrow = getDaysUntilExpiry(tomorrowStr)
  console.log(`Tomorrow (${tomorrowStr}): ${daysToTomorrow} days`)
  assert(daysToTomorrow === 1, `Expected 1, got ${daysToTomorrow}`)

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]
  const daysToYesterday = getDaysUntilExpiry(yesterdayStr)
  console.log(`Yesterday (${yesterdayStr}): ${daysToYesterday} days`)
  assert(daysToYesterday === -1, `Expected -1, got ${daysToYesterday}`)

  console.log('\n--- Unit: getAlertLevel ---')
  assert(getAlertLevel(-5) === 'expired', 'Negative days should be expired')
  assert(getAlertLevel(15) === 'critical', '15 days should be critical')
  assert(getAlertLevel(45) === 'warning', '45 days should be warning')
  assert(getAlertLevel(80) === 'info', '80 days should be info')
  assert(getAlertLevel(120) === 'ok', '120 days should be ok')
  assert(getAlertLevel(null) === null, 'null should return null')
  console.log('All alert level checks passed')

  // Verify mock data structure
  console.log('\n--- Unit: mock data shape ---')
  const mockData = getMockProviderCredentials()
  assert(mockData.providerId, 'Mock should have providerId')
  assert(Array.isArray(mockData.credentials), 'credentials should be array')
  assert(Array.isArray(mockData.payerEnrollments), 'payerEnrollments should be array')
  const uhcEnrollment = mockData.payerEnrollments.find(e => e.payerCode === 'UHC')
  assert(uhcEnrollment && uhcEnrollment.status === 'pending', 'UHC should be pending')
  const npiCred = mockData.credentials.find(c => c.type === 'npi')
  assert(npiCred && !npiCred.expiryDate, 'NPI should have no expiry')
  console.log('Mock data structure valid')

  // Full agent run
  console.log('\n--- Integration: full agent run ---')
  const result = await runCredentialingAgent()

  assert(result.providerId === 'PROV-001', 'Wrong providerId')
  assert(result.checkedAt, 'Missing checkedAt timestamp')
  assert(Array.isArray(result.alerts), 'alerts must be array')
  assert(Array.isArray(result.pendingEnrollments), 'pendingEnrollments must be array')
  assert(typeof result.criticalCount === 'number', 'criticalCount must be number')
  assert(typeof result.warningCount === 'number', 'warningCount must be number')
  assert(typeof result.infoCount === 'number', 'infoCount must be number')

  // CAQH (2 days) and DEA (19 days) should both be critical
  assert(result.criticalCount >= 2, `Expected >=2 critical alerts, got ${result.criticalCount}`)

  // State license (~48 days) should be warning; malpractice (~79 days) and board cert (~88 days) are info
  assert(result.warningCount >= 1, `Expected >=1 warning alert, got ${result.warningCount}`)

  // Malpractice (79 days) and board cert (88 days) both fall in the 61-90 info band
  assert(result.infoCount >= 2, `Expected >=2 info alerts, got ${result.infoCount}`)

  // UHC must appear in pending enrollments
  const pendingUHC = result.pendingEnrollments.find(e => e.payerCode === 'UHC')
  assert(pendingUHC, 'UHC must be in pending enrollments')

  // Every alert must have an aiInstruction (real or fallback)
  for (const alert of result.alerts) {
    assert(alert.aiInstruction, `Alert "${alert.label}" missing aiInstruction`)
    assert(alert.daysRemaining !== undefined, `Alert "${alert.label}" missing daysRemaining`)
    assert(alert.level, `Alert "${alert.label}" missing level`)
  }

  // NPI (no expiry) must not generate an alert
  const npiAlert = result.alerts.find(a => a.credentialType === 'npi')
  assert(!npiAlert, 'NPI should not generate an alert (no expiry)')

  console.log('\n=== RESULTS ===')
  console.log(`Provider: ${result.providerId}`)
  console.log(`Credentials checked: ${result.totalCredentialsChecked}`)
  console.log(`Critical: ${result.criticalCount} | Warning: ${result.warningCount} | Info: ${result.infoCount}`)
  console.log(`Pending enrollments: ${result.pendingEnrollments.map(e => e.payerName).join(', ')}`)
  console.log('\nAlerts:')
  for (const alert of result.alerts) {
    const days = alert.daysRemaining < 0 ? `EXPIRED ${Math.abs(alert.daysRemaining)}d ago` : `${alert.daysRemaining}d`
    console.log(`  [${alert.level.toUpperCase()}] ${alert.label} (${days}): ${alert.aiInstruction.slice(0, 80)}...`)
  }

  console.log('\n=== AGENT 3 ALL TESTS PASSED ===')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`)
  }
}

test().catch(err => {
  console.error('\nTEST FAILED:', err.message)
  process.exit(1)
})
