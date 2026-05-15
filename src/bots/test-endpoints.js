require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') })

const BASE = 'http://localhost:3001'
const SECRET = process.env.WEBHOOK_SECRET

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': SECRET },
    body: JSON.stringify(body)
  })
  const json = await res.json()
  return { status: res.status, body: json }
}

async function testUnauth() {
  const res = await fetch(BASE + '/api/agents/eligibility', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'wrong-secret' },
    body: '{}'
  })
  const j = await res.json()
  console.log(`[AUTH TEST] Wrong secret → ${res.status} ${j.error} ${res.status === 401 ? '✓' : '✗ FAIL'}`)
}

async function testEligibility() {
  console.log('\n[TEST 1] POST /api/agents/eligibility')
  const r = await post('/api/agents/eligibility', {
    medplumAppointmentId: 'APT-BOT-001',
    medplumPatientId: 'abc123def456',
    memberId: 'MBR-9876543',
    payerCode: 'AETNA',
    dateOfBirth: '1985-03-15',
    appointmentDate: '2026-05-20'
  })
  console.log(`  Status: ${r.status}`)
  console.log(`  eligibility status: ${r.body.status}`)
  console.log(`  summary present: ${!!r.body.summary}`)
  console.log(`  copay: ${r.body.copay}`)
  console.log(`  ${r.status === 200 ? '✓ PASS' : '✗ FAIL'}`)
}

async function testClaimScrub() {
  console.log('\n[TEST 2] POST /api/agents/claimScrub')
  const r = await post('/api/agents/claimScrub', {
    medplumEncounterId: 'ENC-BOT-001',
    medplumPatientId: 'abc123def456',
    noteContent: {
      subjective: 'Patient reports chest pain for 2 days',
      objective: 'BP 130/85, HR 88',
      assessment: 'Chest pain, likely musculoskeletal',
      plan: 'NSAIDs, follow up in 1 week'
    },
    icd10Codes: ['R07.9', 'M54.5'],
    cptCode: '99214',
    payerCode: 'AETNA',
    providerId: 1
  })
  console.log(`  Status: ${r.status}`)
  console.log(`  passed: ${r.body.passed}`)
  console.log(`  issues: ${JSON.stringify(r.body.issues)}`)
  console.log(`  claim ID: ${r.body.claim?.claimId}`)
  console.log(`  ${r.status === 200 ? '✓ PASS' : '✗ FAIL'}`)
}

async function testCredentialing() {
  console.log('\n[TEST 3] POST /api/agents/credentialing')
  const r = await post('/api/agents/credentialing', { providerId: 1 })
  console.log(`  Status: ${r.status}`)
  console.log(`  alerts count: ${r.body.alerts?.length}`)
  console.log(`  first alert: ${r.body.alerts?.[0]?.label || 'none'}`)
  console.log(`  ${r.status === 200 ? '✓ PASS' : '✗ FAIL'}`)
}

async function testPracticeOps() {
  console.log('\n[TEST 4] POST /api/agents/practiceOps')
  const r = await post('/api/agents/practiceOps', {
    providerId: 1,
    fhirTasks: [
      { id: 'task-001', priority: 'urgent', description: 'Insurance verification failed for test patient', code: 'insurance-verification' },
      { id: 'task-002', priority: 'routine', description: 'Claim ready for submission', code: 'claim-ready' }
    ]
  })
  console.log(`  Status: ${r.status}`)
  console.log(`  actionItems count: ${r.body.actionItems?.length}`)
  console.log(`  summary: ${r.body.summary?.substring(0, 80)}...`)
  console.log(`  smsBriefing present: ${!!r.body.smsBriefing}`)
  console.log(`  ${r.status === 200 ? '✓ PASS' : '✗ FAIL'}`)
}

async function main() {
  console.log('=== Clearpath Agent Endpoint Tests ===')
  console.log(`WEBHOOK_SECRET set: ${!!SECRET}`)
  try {
    await testUnauth()
    await testEligibility()
    await testClaimScrub()
    await testCredentialing()
    await testPracticeOps()
    console.log('\n=== All tests complete ===')
  } catch (err) {
    console.error('\n[FATAL]', err.message)
    process.exit(1)
  }
}

main()
