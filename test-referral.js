require('dotenv').config()
const {
  runReferralAgent,
  getMockEncounterNote,
  findCompatibleSpecialists,
  getReferralStatus,
  updateReferralStatus,
  getOpenReferrals
} = require('./src/agents/referralAgent')

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
}

async function test() {
  console.log('=== TESTING AGENT 6: REFERRAL MANAGEMENT AGENT ===\n')

  // --- Unit: findCompatibleSpecialists ---
  console.log('--- Unit: findCompatibleSpecialists ---')
  const cardioAetna = findCompatibleSpecialists('cardiology', 'AETNA')
  assert(cardioAetna.length > 0, 'Should find Aetna cardiology specialists')
  assert(cardioAetna.every(s => s.specialty === 'cardiology'), 'All results should be cardiology')
  assert(cardioAetna.every(s => s.acceptedPayers.includes('AETNA')), 'All results should accept Aetna')

  // Neurologist only accepts MEDICARE and BCBS — should not appear for AETNA
  const neuroAetna = findCompatibleSpecialists('neurology', 'AETNA')
  assert(neuroAetna.length === 0, 'No neurologist accepts Aetna — should return empty')

  const neuroBCBS = findCompatibleSpecialists('neurology', 'BCBS')
  assert(neuroBCBS.length > 0, 'Neurologist should appear for BCBS')
  console.log('findCompatibleSpecialists OK')

  // --- Integration: cardiology referral detected and sent ---
  console.log('\n--- Integration: cardiology referral encounter ---')
  const cardioNote = getMockEncounterNote('cardiology_referral')
  const cardioResult = await runReferralAgent(cardioNote)

  assert(cardioResult.encounterId === 'ENC-101', 'Wrong encounterId')
  assert(cardioResult.processedAt, 'Missing processedAt')
  assert(cardioResult.referralDetected === true, 'Should detect referral')
  assert(cardioResult.specialtyNeeded === 'cardiology', `Expected cardiology, got ${cardioResult.specialtyNeeded}`)
  assert(cardioResult.compatibleSpecialistsFound > 0, 'Should find compatible specialists')
  assert(cardioResult.referralsSent > 0, 'Should send at least 1 referral')

  const sentReferral = cardioResult.referrals[0]
  assert(sentReferral.referralId, 'Referral should have an ID')
  assert(sentReferral.status === 'sent', `Referral status should be sent, got ${sentReferral.status}`)
  assert(sentReferral.clinicalSummary, 'Referral should have a clinical summary')
  assert(sentReferral.responseDeadline, 'Should have a 30-day response deadline')
  assert(sentReferral.patientToken === 'PT-B2C3D4E5', 'Should preserve patient token')
  assert(sentReferral.patientScheduled === false, 'Patient not yet scheduled')
  assert(sentReferral.specialistResponseReceived === false, 'No specialist response yet')
  // Verify no patient token leaked into clinical summary
  assert(!sentReferral.clinicalSummary.includes('PT-B2C3D4E5'), 'Patient token must not appear in clinical summary')

  console.log(`Referral sent: ${sentReferral.referralId} to ${sentReferral.specialistName}`)
  console.log(`Summary preview: ${sentReferral.clinicalSummary.slice(0, 100)}...`)

  // --- Integration: orthopedics referral with Medicare ---
  console.log('\n--- Integration: orthopedics referral (Medicare) ---')
  const orthoNote = getMockEncounterNote('orthopedics_referral')
  const orthoResult = await runReferralAgent(orthoNote)

  assert(orthoResult.referralDetected === true, 'Should detect orthopedics referral')
  assert(orthoResult.specialtyNeeded === 'orthopedics', `Expected orthopedics, got ${orthoResult.specialtyNeeded}`)
  assert(orthoResult.referralsSent > 0, 'Should send referral')
  console.log(`Ortho referral sent: urgency=${orthoResult.urgency}`)

  // --- Integration: no referral in note ---
  console.log('\n--- Integration: no referral note ---')
  const noRefNote = getMockEncounterNote('no_referral')
  const noRefResult = await runReferralAgent(noRefNote)

  assert(noRefResult.referralDetected === false, 'Should not detect referral in routine BP note')
  assert(!noRefResult.referrals, 'Should have no referrals array when none detected')
  console.log('No referral correctly detected')

  // --- Unit: status tracking ---
  console.log('\n--- Unit: getReferralStatus / updateReferralStatus ---')
  const referralId = sentReferral.referralId
  const tracked = getReferralStatus(referralId)
  assert(tracked, 'Should retrieve tracked referral by ID')
  assert(tracked.status === 'sent', 'Status should be sent')

  const updated = updateReferralStatus(referralId, { patientScheduled: true })
  assert(updated.patientScheduled === true, 'patientScheduled should update to true')
  assert(updated.updatedAt, 'Should have updatedAt timestamp after update')

  const afterUpdate = getReferralStatus(referralId)
  assert(afterUpdate.patientScheduled === true, 'Updated field should persist')

  // --- Unit: getOpenReferrals ---
  console.log('\n--- Unit: getOpenReferrals ---')
  const open = getOpenReferrals()
  assert(Array.isArray(open), 'getOpenReferrals should return array')
  assert(open.length >= 1, 'Should have at least 1 open referral (ortho)')
  // The referral we marked patientScheduled=true is still open (specialist hasn't responded)
  assert(open.every(r => !r.specialistResponseReceived), 'All open referrals should lack specialist response')
  console.log(`Open referrals awaiting specialist response: ${open.length}`)

  // Mark specialist responded to clean up
  updateReferralStatus(referralId, { specialistResponseReceived: true })
  const openAfter = getOpenReferrals()
  assert(!openAfter.find(r => r.referralId === referralId), 'Referral with specialist response should leave open list')

  console.log('\n=== AGENT 6 ALL TESTS PASSED ===')
}

test().catch(err => {
  console.error('\nTEST FAILED:', err.message)
  process.exit(1)
})
