require('dotenv').config()
const { runPracticeOpsAgent, prioritizeActionItems, PRIORITY } = require('./src/agents/practiceOpsAgent')

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
}

async function test() {
  console.log('=== TESTING AGENT 7: PRACTICE OPERATIONS AGENT ===\n')

  // --- Unit: prioritizeActionItems ---
  console.log('--- Unit: prioritizeActionItems ---')
  const items = [
    { priority: PRIORITY.INFO, revenueAtRisk: 0, title: 'Info item' },
    { priority: PRIORITY.REVENUE_AT_RISK, revenueAtRisk: 100, title: 'Low revenue item' },
    { priority: PRIORITY.CREDENTIAL_CRITICAL, revenueAtRisk: 0, title: 'Critical credential' },
    { priority: PRIORITY.REVENUE_AT_RISK, revenueAtRisk: 500, title: 'High revenue item' },
    { priority: PRIORITY.PATIENT_CARE, revenueAtRisk: 0, title: 'Patient care item' }
  ]

  const sorted = prioritizeActionItems(items)
  // CREDENTIAL_CRITICAL(1) < REVENUE_AT_RISK(2) < PATIENT_CARE(4) < INFO(6)
  assert(sorted[0].title === 'Critical credential', `First should be critical credential, got: ${sorted[0].title}`)
  assert(sorted[1].title === 'High revenue item', `Second should be high revenue, got: ${sorted[1].title}`)
  assert(sorted[2].title === 'Low revenue item', `Third should be low revenue, got: ${sorted[2].title}`)
  assert(sorted[3].title === 'Patient care item', `Fourth should be patient care, got: ${sorted[3].title}`)
  assert(sorted[4].title === 'Info item', `Last should be info, got: ${sorted[4].title}`)
  console.log('Prioritization order correct')

  // --- Integration: full morning briefing ---
  console.log('\n--- Integration: full morning briefing run ---')
  const result = await runPracticeOpsAgent({ providerId: 'PROV-001' })

  // Structure checks
  assert(result.providerId === 'PROV-001', 'Wrong providerId')
  assert(result.generatedAt, 'Missing generatedAt timestamp')
  assert(typeof result.dailySummary === 'string' && result.dailySummary.length > 0, 'dailySummary must be non-empty string')
  assert(Array.isArray(result.actionItems), 'actionItems must be array')
  assert(typeof result.totalActionItems === 'number', 'totalActionItems must be number')
  assert(typeof result.criticalCount === 'number', 'criticalCount must be number')
  assert(Array.isArray(result.topActionItems), 'topActionItems must be array')
  assert(result.topActionItems.length <= 3, 'topActionItems should contain at most 3 items')

  // Metrics structure
  assert(result.metrics, 'Missing metrics object')
  assert(typeof result.metrics.eraTotalPaid === 'number', 'eraTotalPaid must be number')
  assert(typeof result.metrics.totalRevenueAtRisk === 'number', 'totalRevenueAtRisk must be number')
  assert(typeof result.metrics.credentialCriticalCount === 'number', 'credentialCriticalCount must be number')

  // Should have action items from multiple sources
  const sources = [...new Set(result.actionItems.map(i => i.source))]
  assert(sources.includes('era_agent'), 'Should have ERA action items')
  assert(sources.includes('credentialing_agent'), 'Should have credentialing action items')
  console.log(`Action items from sources: ${sources.join(', ')}`)

  // All items must have required fields
  for (const item of result.actionItems) {
    assert(item.source, `Action item missing source: ${JSON.stringify(item)}`)
    assert(item.priority, `Action item missing priority: ${item.title}`)
    assert(item.type, `Action item missing type: ${item.title}`)
    assert(item.title, 'Action item missing title')
    assert(item.aiInstruction, `Action item missing aiInstruction: ${item.title}`)
    assert(item.urgency, `Action item missing urgency: ${item.title}`)
  }

  // Priority ordering — first item should be highest priority (lowest number)
  if (result.actionItems.length > 1) {
    const firstPriority = result.actionItems[0].priority
    const lastPriority = result.actionItems[result.actionItems.length - 1].priority
    assert(firstPriority <= lastPriority, `Items should be sorted by priority: first=${firstPriority}, last=${lastPriority}`)
  }

  // Revenue at risk should be positive (we have mock denied claims + balances)
  assert(result.metrics.totalRevenueAtRisk > 0, 'Should have revenue at risk from ERA + balances')

  // Critical credentials: CAQH (1 day) + DEA (18 days) = 2
  assert(result.metrics.credentialCriticalCount >= 2, `Expected >=2 critical credentials, got ${result.metrics.credentialCriticalCount}`)

  // Daily summary should not contain patient tokens
  assert(!result.dailySummary.includes('PT-'), 'Daily summary must not contain patient tokens')

  // Test with mock ERA results injected
  console.log('\n--- Integration: with injected ERA results ---')
  const mockERAResults = {
    totalPaid: 15420.00,
    claimsProcessed: 48,
    actionItems: [
      {
        source: 'era_agent',
        claimId: 'CLM-X01',
        payerName: 'Medicare',
        procedureCode: '99213',
        code: 'CO-11',
        plain: 'Diagnosis inconsistent with procedure',
        amount: 140.00,
        priority: 'medium',
        aiInstruction: 'Review diagnosis code on claim CLM-X01 for medical necessity.'
      }
    ],
    patterns: []
  }

  const resultWithERA = await runPracticeOpsAgent({ providerId: 'PROV-001', eraResults: mockERAResults })
  assert(resultWithERA.metrics.eraTotalPaid === 15420.00, 'Should use injected ERA total')
  assert(resultWithERA.metrics.eraClaimsProcessed === 48, 'Should use injected ERA claims count')
  const eraItem = resultWithERA.actionItems.find(i => i.source === 'era_agent' && i.type === 'denied_claim')
  assert(eraItem, 'Should have ERA denial action item')
  console.log('Injected ERA results processed correctly')

  console.log('\n=== SUMMARY ===')
  console.log(`Total action items: ${result.totalActionItems}`)
  console.log(`Critical: ${result.criticalCount} | High: ${result.highCount}`)
  console.log(`Revenue at risk: $${result.metrics.totalRevenueAtRisk.toFixed(2)}`)
  console.log(`\nTop 3 action items:`)
  for (const item of result.topActionItems) {
    console.log(`  [${item.urgency.toUpperCase()}] ${item.title}`)
  }
  console.log(`\nDaily summary: ${result.dailySummary}`)

  console.log('\n=== AGENT 7 ALL TESTS PASSED ===')
}

test().catch(err => {
  console.error('\nTEST FAILED:', err.message)
  process.exit(1)
})
