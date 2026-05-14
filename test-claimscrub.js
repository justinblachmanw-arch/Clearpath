require('dotenv').config()
const {
  runClaimScrubAgent,
  getMockClaim,
  checkRequiredFields,
  checkEMLevel,
  checkModifiers,
  checkTimelyFiling,
  checkCredentialing
} = require('./src/agents/claimScrubAgent')

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
}

async function test() {
  console.log('=== TESTING AGENT 4: CLAIM SCRUBBING AGENT ===\n')

  // --- Unit: required fields ---
  console.log('--- Unit: checkRequiredFields ---')
  const missingNPIClaim = getMockClaim('missing_npi')
  const reqErrors = checkRequiredFields(missingNPIClaim)
  assert(reqErrors.length > 0, 'Should detect missing NPI')
  assert(reqErrors[0].check === 'required_fields', 'Error check field should be required_fields')
  assert(reqErrors[0].field === 'providerNPI', 'Should flag providerNPI specifically')

  const cleanClaim = getMockClaim('clean')
  const cleanReqErrors = checkRequiredFields(cleanClaim)
  assert(cleanReqErrors.length === 0, 'Clean claim should have no required field errors')
  console.log('Required fields check OK')

  // --- Unit: E&M level ---
  console.log('\n--- Unit: checkEMLevel ---')
  const emMismatchClaim = getMockClaim('em_mismatch')
  const emErrors = checkEMLevel(emMismatchClaim)
  assert(emErrors.length > 0, 'Should detect E&M mismatch (99215 with low complexity)')
  assert(emErrors[0].check === 'em_level', 'Error check should be em_level')
  assert(emErrors[0].procedureCode === '99215', 'Should flag 99215')

  const emClean = checkEMLevel(cleanClaim) // 99214 + moderate = match
  assert(emClean.length === 0, '99214 with moderate complexity should pass')
  console.log('E&M level check OK')

  // --- Unit: modifiers ---
  console.log('\n--- Unit: checkModifiers ---')
  const modClaim = getMockClaim('invalid_modifier')
  const modErrors = checkModifiers(modClaim)
  assert(modErrors.length > 0, 'Should detect invalid modifier 57 on 99213')
  assert(modErrors[0].check === 'modifier', 'Error check should be modifier')
  assert(modErrors[0].modifier === '57', 'Should flag modifier 57')

  const cleanModErrors = checkModifiers(cleanClaim)
  assert(cleanModErrors.length === 0, 'Clean claim with no modifiers should pass')
  console.log('Modifier check OK')

  // --- Unit: timely filing ---
  console.log('\n--- Unit: checkTimelyFiling ---')
  const staleClaimObj = getMockClaim('timely_filing') // DOS 2024-01-15, DEFAULT window = 90 days
  const timelyErrors = checkTimelyFiling(staleClaimObj)
  assert(timelyErrors.length > 0, 'Claim from 2024 should fail timely filing')
  assert(timelyErrors[0].check === 'timely_filing', 'Error check should be timely_filing')

  const freshClaim = getMockClaim('clean') // DOS 2026-05-01 = recent
  const freshTimelyErrors = checkTimelyFiling(freshClaim)
  assert(freshTimelyErrors.length === 0, 'Fresh claim should pass timely filing')
  console.log('Timely filing check OK')

  // --- Unit: credentialing ---
  console.log('\n--- Unit: checkCredentialing ---')
  const notCredClaim = getMockClaim('not_credentialed') // payerCode: UHC, not in active list
  const credErrors = checkCredentialing(notCredClaim, ['MEDICARE', 'AETNA', 'BCBS'])
  assert(credErrors.length > 0, 'UHC should fail credentialing check')
  assert(credErrors[0].check === 'credentialing', 'Error check should be credentialing')

  const credClean = checkCredentialing(cleanClaim, ['MEDICARE', 'AETNA', 'BCBS']) // AETNA = active
  assert(credClean.length === 0, 'Aetna claim should pass credentialing check')
  console.log('Credentialing check OK')

  // --- Integration: clean claim passes ---
  console.log('\n--- Integration: clean claim (should PASS) ---')
  const cleanResult = await runClaimScrubAgent(getMockClaim('clean'), ['MEDICARE', 'AETNA', 'BCBS'])
  assert(cleanResult.claimId === 'CLM-TEST-001', 'Wrong claimId')
  assert(typeof cleanResult.passed === 'boolean', 'passed must be boolean')
  assert(cleanResult.passed === true, `Clean claim should pass but got ${cleanResult.errorCount} error(s): ${JSON.stringify(cleanResult.errors)}`)
  assert(cleanResult.autoSubmit === true, 'Clean claim should auto-submit')
  assert(cleanResult.scrubbedAt, 'Missing scrubbedAt')
  console.log('Clean claim PASSED as expected')

  // --- Integration: claim with missing NPI fails ---
  console.log('\n--- Integration: missing NPI claim (should FAIL) ---')
  const npiResult = await runClaimScrubAgent(getMockClaim('missing_npi'), ['MEDICARE', 'AETNA', 'BCBS'])
  assert(npiResult.passed === false, 'Missing NPI claim should fail')
  assert(npiResult.autoSubmit === false, 'Failed claim should not auto-submit')
  const npiError = npiResult.errors.find(e => e.field === 'providerNPI')
  assert(npiError, 'Should include providerNPI error in result')
  console.log('Missing NPI claim FAILED as expected')

  // --- Integration: E&M mismatch fails ---
  console.log('\n--- Integration: E&M mismatch (should FAIL) ---')
  const emResult = await runClaimScrubAgent(getMockClaim('em_mismatch'), ['MEDICARE', 'AETNA', 'BCBS'])
  assert(emResult.passed === false, 'E&M mismatch claim should fail')
  const emError = emResult.errors.find(e => e.check === 'em_level')
  assert(emError, 'Should include em_level error')
  console.log('E&M mismatch FAILED as expected')

  // --- Integration: not credentialed fails ---
  console.log('\n--- Integration: not credentialed with UHC (should FAIL) ---')
  const credResult = await runClaimScrubAgent(getMockClaim('not_credentialed'), ['MEDICARE', 'AETNA', 'BCBS'])
  assert(credResult.passed === false, 'Uncredentialed claim should fail')
  const credError = credResult.errors.find(e => e.check === 'credentialing')
  assert(credError, 'Should include credentialing error')
  console.log('Uncredentialed claim FAILED as expected')

  console.log('\n=== AGENT 4 ALL TESTS PASSED ===')
}

test().catch(err => {
  console.error('\nTEST FAILED:', err.message)
  process.exit(1)
})
