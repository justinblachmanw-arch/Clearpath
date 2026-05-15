require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') })
const { getMedplumClient } = require('../lib/medplum')

const BOT_NAMES = {
  eligibility:  'Clearpath Eligibility Bot',
  claimScrub:   'Clearpath Claim Scrub Bot',
  eraProcessing:'Clearpath ERA Processing Bot',
  credentialing:'Clearpath Credentialing Bot',
  practiceOps:  'Clearpath Practice Ops Bot'
}

async function getBotId(client, name) {
  const results = await client.searchResources('Bot', 'name=' + encodeURIComponent(name))
  if (!results.length) throw new Error(`Bot not found: ${name}`)
  return results[0].id
}

async function upsertSubscription(client, { name, criteria, botId, cron }) {
  // Check if subscription already exists by scanning active subscriptions
  try {
    const all = await client.searchResources('Subscription', 'status=active')
    const existing = all.find(s => s.reason === name)
    if (existing) {
      console.log(`[SUBSCRIPTIONS] Already exists: ${name} (${existing.id})`)
      return existing.id
    }
  } catch (_) {
    // If search fails, proceed to create
  }

  const sub = {
    resourceType: 'Subscription',
    status: 'active',
    reason: name,
    ...(criteria ? { criteria } : {}),
    channel: {
      type: 'rest-hook',
      endpoint: 'Bot/' + botId,
      ...(cron ? { extension: [{ url: 'https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction', valueCode: 'timer' }] } : {})
    }
  }

  // Cron subscriptions use a different criteria format
  if (cron) {
    sub.criteria = cron
  }

  const created = await client.createResource(sub)
  console.log(`[SUBSCRIPTIONS] Created: ${name} → ${created.id}`)
  return created.id
}

async function main() {
  const client = await getMedplumClient()
  console.log('[SUBSCRIPTIONS] Connected to Medplum')

  const ids = {}
  for (const [key, name] of Object.entries(BOT_NAMES)) {
    try {
      ids[key] = await getBotId(client, name)
      console.log(`[SUBSCRIPTIONS] Found bot ${name} → ${ids[key]}`)
    } catch (err) {
      console.error(`[SUBSCRIPTIONS] ERROR: ${err.message}`)
      console.error(`[SUBSCRIPTIONS] Deploy bots first: npx medplum bot create "${name}"`)
      process.exit(1)
    }
  }

  const results = {}

  results.eligibility = await upsertSubscription(client, {
    name: 'Clearpath Eligibility Subscription',
    criteria: 'Appointment?status=booked',
    botId: ids.eligibility
  })

  results.claimScrub = await upsertSubscription(client, {
    name: 'Clearpath Claim Scrub Subscription',
    criteria: 'Encounter?status=finished',
    botId: ids.claimScrub
  })

  results.eraProcessing = await upsertSubscription(client, {
    name: 'Clearpath ERA Processing Subscription',
    criteria: 'ExplanationOfBenefit',
    botId: ids.eraProcessing
  })

  results.credentialing = await upsertSubscription(client, {
    name: 'Clearpath Credentialing Subscription',
    criteria: 'timer://06:00',
    botId: ids.credentialing,
    cron: 'timer://06:00'
  })

  results.practiceOps = await upsertSubscription(client, {
    name: 'Clearpath Practice Ops Subscription',
    criteria: 'timer://07:00',
    botId: ids.practiceOps,
    cron: 'timer://07:00'
  })

  console.log('\n[SUBSCRIPTIONS] Summary:')
  console.log('  Eligibility bot ID:    ', ids.eligibility)
  console.log('  Claim Scrub bot ID:    ', ids.claimScrub)
  console.log('  ERA Processing bot ID: ', ids.eraProcessing)
  console.log('  Credentialing bot ID:  ', ids.credentialing)
  console.log('  Practice Ops bot ID:   ', ids.practiceOps)
  console.log('')
  console.log('  Eligibility subscription:    ', results.eligibility)
  console.log('  Claim Scrub subscription:    ', results.claimScrub)
  console.log('  ERA Processing subscription: ', results.eraProcessing)
  console.log('  Credentialing subscription:  ', results.credentialing)
  console.log('  Practice Ops subscription:   ', results.practiceOps)
}

main().catch(err => {
  console.error('[SUBSCRIPTIONS] Fatal:', err.message)
  process.exit(1)
})
