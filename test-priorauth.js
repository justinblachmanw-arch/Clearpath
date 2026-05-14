require('dotenv').config()
const {
  runPriorAuthAgent,
  getMockEncounter,
  requiresAuth,
  getAuthStatus,
  updateAuthStatus,
  getPendingAuths
} = require('./src/agents/priorAuthAgent')

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
}

async function test() {
  console.log('=== TESTING AGENT 5: PRIOR AUTHORIZATION AGENT ===\n')

  // --- Unit: requiresAuth rules table ---
  console.log('--- Unit: requiresAuth ---')
  assert(requiresAuth('AETNA', '27447') === true, 'Aetna knee replacement should require auth')
  assert(requiresAuth('AETNA', '99214') === false, 'Aetna office visit should not require auth')
  assert(requiresAuth('MEDICARE', '72148') === true, 'Medicare MRI should require auth')
  assert(requiresAuth('MEDICARE', '27447') === false, 'Medicare knee replacement should NOT require auth')
  assert(requiresAuth('UNKNOWN_PAYER', '99214') === false, 'Unknown payer + unknown code should default false')
  assert(requiresAuth('AETNA', '99999') === false, 'Unlisted code should default to false (no auth needed)')
  console.log('requiresAuth rules OK')

  // --- Integration: encounter with auth required ---
  console.log('\n--- Integration: auth required (knee replacement w/ Aetna) ---')
  const encounter = getMockEncounter('auth_required')
  const result = await runPriorAuthAgent(encounter)

  assert(result.encounterId === 'ENC-001', 'Wrong encounterId')
  assert(result.processedAt, 'Missing processedAt')
  assert(Array.isArray(result.results), 'results must be array')
  assert(result.results.length === 1, `Expected 1 procedure result, got ${result.results.length}`)
  assert(result.pendingCount === 1, `Expected 1 pending auth, got ${result.pendingCount}`)
  assert(result.allClear === false, 'allClear should be false with pending auth')

  const authResult = result.results[0]
  assert(authResult.authRequired === true, 'Auth should be required')
  assert(authResult.authId, 'Should have an authId')
  assert(authResult.status === 'pending', `Status should be pending, got ${authResult.status}`)
  assert(authResult.narrative, 'Should have a clinical narrative')
  assert(authResult.followUpDate, 'Should have a 30-day follow-up date')
  assert(authResult.patientToken === 'PT-A1B2C3D4', 'Patient token should be preserved')
  assert(!authResult.narrative.includes('PT-A1B2C3D4'), 'Narrative should not expose patient token')

  console.log(`Auth submitted: ${authResult.authId}`)
  console.log(`Narrative preview: ${authResult.narrative.slice(0, 100)}...`)

  // --- Integration: encounter with no auth needed ---
  console.log('\n--- Integration: no auth needed (office visit) ---')
  const noAuthEncounter = getMockEncounter('no_auth_needed')
  const noAuthResult = await runPriorAuthAgent(noAuthEncounter)

  assert(noAuthResult.pendingCount === 0, 'Should have 0 pending auths')
  assert(noAuthResult.notRequiredCount === 1, 'Should have 1 not_required result')
  assert(noAuthResult.allClear === true, 'allClear should be true')
  const noAuthProcResult = noAuthResult.results[0]
  assert(noAuthProcResult.authRequired === false, 'Auth should not be required')
  assert(noAuthProcResult.status === 'not_required', 'Status should be not_required')
  assert(noAuthProcResult.authId === null, 'Should have no authId')
  console.log('Office visit correctly skipped auth')

  // --- Integration: MRI auth ---
  console.log('\n--- Integration: MRI auth (Aetna) ---')
  const mriEncounter = getMockEncounter('mri_auth')
  const mriResult = await runPriorAuthAgent(mriEncounter)
  assert(mriResult.pendingCount === 1, 'MRI should require auth')
  const mriAuthResult = mriResult.results[0]
  assert(mriAuthResult.procedureCode === '72148', 'Should track MRI code')
  console.log(`MRI auth submitted: ${mriAuthResult.authId}`)

  // --- Unit: status tracking ---
  console.log('\n--- Unit: getAuthStatus / updateAuthStatus ---')
  const trackedAuthId = authResult.authId
  const tracked = getAuthStatus(trackedAuthId)
  assert(tracked, 'Should retrieve tracked auth by ID')
  assert(tracked.status === 'pending', 'Status should still be pending')

  const updated = updateAuthStatus(trackedAuthId, 'approved')
  assert(updated.status === 'approved', 'Status should update to approved')

  const afterUpdate = getAuthStatus(trackedAuthId)
  assert(afterUpdate.status === 'approved', 'Persisted status should be approved')

  // --- Unit: getPendingAuths ---
  console.log('\n--- Unit: getPendingAuths ---')
  const pending = getPendingAuths()
  assert(Array.isArray(pending), 'getPendingAuths should return array')
  // knee replacement auth was approved, so only MRI should still be pending
  const pendingIds = pending.map(p => p.authId)
  assert(!pendingIds.includes(trackedAuthId), 'Approved auth should not appear in pending list')
  console.log(`Pending auths remaining: ${pending.length}`)

  console.log('\n=== AGENT 5 ALL TESTS PASSED ===')
}

test().catch(err => {
  console.error('\nTEST FAILED:', err.message)
  process.exit(1)
})
