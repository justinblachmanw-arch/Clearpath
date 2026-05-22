require('dotenv').config()
const {
  scrubClaim,
  runClaimScrubAgent,
  getMockClaim,
  checkRequiredFields,
  checkEMLevel,
  checkModifiers,
  checkTimelyFiling,
  checkCredentialing
} = require('./src/agents/claimScrubAgent')
const pool = require('./src/lib/db')

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
}

// ─── Part A: Unit tests (mock data, no DB, deterministic) ────────────────────

async function unitTests() {
  console.log('=== PART A: UNIT TESTS (mock claims) ===\n')

  console.log('--- checkRequiredFields ---')
  const missingNPI = getMockClaim('missing_npi')
  const reqErrors  = checkRequiredFields(missingNPI)
  assert(reqErrors.length > 0, 'Should detect missing NPI')
  assert(reqErrors[0].check === 'required_fields', 'Error check should be required_fields')
  assert(reqErrors[0].field === 'providerNPI', 'Should flag providerNPI')
  assert(checkRequiredFields(getMockClaim('clean')).length === 0, 'Clean claim should have no field errors')
  console.log('PASS')

  console.log('--- checkEMLevel ---')
  const emErrors = checkEMLevel(getMockClaim('em_mismatch'))
  assert(emErrors.length > 0, 'Should detect E&M mismatch')
  assert(emErrors[0].check === 'em_level', 'Error check should be em_level')
  assert(emErrors[0].procedureCode === '99215', 'Should flag 99215')
  assert(checkEMLevel(getMockClaim('clean')).length === 0, '99214+moderate should pass')
  console.log('PASS')

  console.log('--- checkModifiers ---')
  const modErrors = checkModifiers(getMockClaim('invalid_modifier'))
  assert(modErrors.length > 0, 'Should detect invalid modifier 57 on 99213')
  assert(modErrors[0].check === 'modifier', 'Error check should be modifier')
  assert(modErrors[0].modifier === '57', 'Should flag modifier 57')
  assert(checkModifiers(getMockClaim('clean')).length === 0, 'Clean claim should pass modifier check')
  console.log('PASS')

  console.log('--- checkTimelyFiling ---')
  const timelyErrors = checkTimelyFiling(getMockClaim('timely_filing'))
  assert(timelyErrors.length > 0, 'Claim from 2024 should fail timely filing')
  assert(timelyErrors[0].check === 'timely_filing', 'Error check should be timely_filing')
  assert(checkTimelyFiling(getMockClaim('clean')).length === 0, 'Recent claim should pass')
  console.log('PASS')

  console.log('--- checkCredentialing ---')
  const credErrors = checkCredentialing(getMockClaim('not_credentialed'), ['MEDICARE', 'AETNA', 'BCBS'])
  assert(credErrors.length > 0, 'UHC should fail credentialing')
  assert(credErrors[0].check === 'credentialing', 'Error check should be credentialing')
  assert(checkCredentialing(getMockClaim('clean'), ['MEDICARE', 'AETNA', 'BCBS']).length === 0, 'AETNA should pass')
  console.log('PASS')

  console.log('\n--- Integration: clean claim passes ---')
  const cleanResult = await runClaimScrubAgent(getMockClaim('clean'), ['MEDICARE', 'AETNA', 'BCBS'])
  assert(cleanResult.claimId === 'CLM-TEST-001', 'Wrong claimId')
  assert(cleanResult.passed === true, `Clean claim should pass but got: ${JSON.stringify(cleanResult.errors)}`)
  assert(cleanResult.autoSubmit === true, 'Clean claim should auto-submit')
  console.log('PASS — clean claim passed')

  console.log('--- Integration: missing NPI fails ---')
  const npiResult = await runClaimScrubAgent(getMockClaim('missing_npi'), ['MEDICARE', 'AETNA', 'BCBS'])
  assert(npiResult.passed === false, 'Missing NPI should fail')
  assert(npiResult.errors.find(e => e.field === 'providerNPI'), 'Should include providerNPI error')
  console.log('PASS — missing NPI rejected')

  console.log('--- Integration: E&M mismatch fails ---')
  const emResult = await runClaimScrubAgent(getMockClaim('em_mismatch'), ['MEDICARE', 'AETNA', 'BCBS'])
  assert(emResult.passed === false, 'E&M mismatch should fail')
  assert(emResult.errors.find(e => e.check === 'em_level'), 'Should include em_level error')
  console.log('PASS — E&M mismatch rejected')

  console.log('--- Integration: uncredentialed payer fails ---')
  const credResult = await runClaimScrubAgent(getMockClaim('not_credentialed'), ['MEDICARE', 'AETNA', 'BCBS'])
  assert(credResult.passed === false, 'UHC claim should fail credentialing')
  assert(credResult.errors.find(e => e.check === 'credentialing'), 'Should include credentialing error')
  console.log('PASS — uncredentialed payer rejected')

  console.log('\n=== PART A: ALL UNIT TESTS PASSED ===\n')
}

// ─── Part B: DB integration test (real claims, three-layer scrub) ─────────────

async function dbTest() {
  console.log('=== PART B: DB INTEGRATION (real claims) ===\n')

  const claims = await pool.query(
    `SELECT * FROM claims WHERE status IN ('pending', 'ready_to_submit') LIMIT 5`
  )

  if (!claims.rows.length) {
    console.log('No pending/ready_to_submit claims found — seeding 2 test claims')
    // Fast seed: use first provider + patient already in DB
    const prov = await pool.query('SELECT id FROM providers LIMIT 1')
    const pat  = await pool.query('SELECT id FROM patients  LIMIT 1')
    if (prov.rows.length && pat.rows.length) {
      for (let i = 1; i <= 2; i++) {
        const { rows: [c] } = await pool.query(
          `INSERT INTO claims (provider_id, patient_id, payer_code, payer_name, date_of_service, status, billed_amount, claim_number)
           VALUES ($1,$2,'AETNA','Aetna','2026-04-01','pending',250,'CLM-SEED-00' || $3)
           RETURNING id`,
          [prov.rows[0].id, pat.rows[0].id, i]
        )
        await pool.query(
          `INSERT INTO claim_lines (claim_id, procedure_code, billed_amount) VALUES ($1,'99214',250)`,
          [c.id]
        )
      }
      claims.rows.push(...(await pool.query(`SELECT * FROM claims WHERE claim_number LIKE 'CLM-SEED%'`)).rows)
    }
  }

  console.log(`Scrubbing ${claims.rows.length} claim(s)...\n`)

  let gptCallCount = 0
  for (const claim of claims.rows) {
    console.log(`Scrubbing claim: ${claim.claim_number || claim.id}`)
    const result = await scrubClaim(claim)
    if (result.layer === 3) gptCallCount++
    console.log(`Result: ${result.decision} — ${result.reason}`)
    console.log(`Layer that fired: ${result.layer}`)
    console.log('---')
  }

  console.log(`\nGPT-4o calls made: ${gptCallCount} / ${claims.rows.length} claims`)
  assert(gptCallCount <= claims.rows.length, 'GPT-4o called at most once per claim')
  console.log('\n=== PART B: DB TEST COMPLETE ===')
}

async function main() {
  await unitTests()
  await dbTest()
  pool.end()
}

main().catch(err => {
  console.error('\nTEST FAILED:', err.message)
  pool.end()
  process.exit(1)
})
