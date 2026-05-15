require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') })
const { getMedplumClient } = require('../lib/medplum')
const fs = require('fs')
const path = require('path')

const BOT_IDS = {
  'Clearpath Eligibility Bot':    { id: '0304be0c-8b28-4697-b903-d6e5fe094b5f', file: 'eligibilityBot.ts' },
  'Clearpath Claim Scrub Bot':    { id: '175a10ad-300c-41dc-a557-d9225fe262f8', file: 'claimScrubBot.ts' },
  'Clearpath ERA Processing Bot': { id: '22ac39bf-8311-4af3-aaf5-4fe599bd558f', file: 'eraProcessingBot.ts' },
  'Clearpath Credentialing Bot':  { id: '9b9c2ec3-9feb-42ec-9f09-7038d617776d', file: 'credentialingBot.ts' },
  'Clearpath Practice Ops Bot':   { id: 'd3fa8b90-1811-4134-aa77-746091e98bf3', file: 'practiceOpsBot.ts' }
}

async function main() {
  const client = await getMedplumClient()
  console.log('[DEPLOY] Connected to Medplum')

  for (const [name, { id, file }] of Object.entries(BOT_IDS)) {
    const code = fs.readFileSync(path.join(__dirname, file), 'utf8')
    try {
      await client.post(`fhir/R4/Bot/${id}/$deploy`, {
        code,
        filename: file,
        contentType: 'text/typescript'
      })
      console.log(`[DEPLOY] ${name} -> ${id}`)
    } catch (err) {
      console.error(`[DEPLOY] Error deploying ${name}: ${err.message}`)
    }
  }

  console.log('\n[DEPLOY] Bot IDs:')
  for (const [name, { id }] of Object.entries(BOT_IDS)) {
    console.log(`  ${name}: ${id}`)
  }
}

main().catch(err => {
  console.error('[DEPLOY] Fatal:', err.message)
  process.exit(1)
})
