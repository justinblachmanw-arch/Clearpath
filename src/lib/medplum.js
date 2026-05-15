require('dotenv').config()
const { MedplumClient } = require('@medplum/core')

let client = null

async function getMedplumClient() {
  if (!client) {
    client = new MedplumClient({
      baseUrl: process.env.MEDPLUM_BASE_URL
    })
    await client.startClientLogin(
      process.env.MEDPLUM_CLIENT_ID,
      process.env.MEDPLUM_CLIENT_SECRET
    )
  }
  return client
}

module.exports = { getMedplumClient }
