require('dotenv').config()
const http = require('http')
const { getMockEDI835 } = require('../lib/ediReader')

const GREEN = '\x1b[32m'
const RED   = '\x1b[31m'
const RESET = '\x1b[0m'

const PORT = parseInt(process.env.API_PORT) || 3001
let token

function apiRequest(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const isJson  = body !== undefined && typeof body !== 'string'
    const bodyStr = body === undefined ? '' : (isJson ? JSON.stringify(body) : String(body))
    const buf     = Buffer.from(bodyStr)

    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api${path}`,
      method,
      headers: {
        'Content-Type':   isJson ? 'application/json' : 'text/plain',
        'Content-Length': buf.length,
        ...headers
      }
    }

    const req = http.request(options, res => {
      let data = ''
      res.on('data', chunk => (data += chunk))
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = data }
        resolve({ status: res.statusCode, body: parsed })
      })
    })

    req.on('error', reject)
    if (buf.length) req.write(buf)
    req.end()
  })
}

let pass = 0
let fail = 0

function check(name, cond, detail = '') {
  const label = cond ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`
  const suffix = detail ? `  (${detail})` : ''
  console.log(`  ${label}  ${name}${suffix}`)
  cond ? pass++ : fail++
}

async function runTests() {
  console.log('\n=== Health Platform API Tests ===\n')

  // 1. Health check — no auth
  try {
    const r = await apiRequest('GET', '/health')
    check('GET  /api/health', r.status === 200 && r.body.status === 'ok',
      `status=${r.body.status}`)
  } catch (e) {
    check('GET  /api/health', false, e.message)
  }

  // 2. Login
  try {
    const r = await apiRequest('POST', '/auth/login', {
      body: { email: 'dr.patel@clearpathhealth.com', password: 'password' }
    })
    token = r.body.token
    check('POST /api/auth/login', r.status === 200 && !!token,
      `provider=${r.body.provider?.name}`)
  } catch (e) {
    check('POST /api/auth/login', false, e.message)
  }

  // 3. Dashboard
  try {
    const r = await apiRequest('GET', '/dashboard', {
      headers: { Authorization: `Bearer ${token}` }
    })
    check('GET  /api/dashboard', r.status === 200 && !!r.body.metrics,
      `AR=$${r.body.metrics?.outstandingAR?.toFixed(2)}  actions=${r.body.metrics?.claimsNeedingAction}`)
  } catch (e) {
    check('GET  /api/dashboard', false, e.message)
  }

  // 4. Create appointment (eligibility agent runs inline)
  try {
    const date = new Date().toISOString().split('T')[0]
    const r = await apiRequest('POST', '/appointments', {
      body: { patientId: 1, date, visitType: 'Office Visit' },
      headers: { Authorization: `Bearer ${token}` }
    })
    check('POST /api/appointments', r.status === 201 && !!r.body.appointment?.id,
      `id=${r.body.appointment?.id}  eligibility=${r.body.appointment?.eligibilityStatus}`)
  } catch (e) {
    check('POST /api/appointments', false, e.message)
  }

  // 5. Claims action items
  try {
    const r = await apiRequest('GET', '/claims/action-items', {
      headers: { Authorization: `Bearer ${token}` }
    })
    check('GET  /api/claims/action-items', r.status === 200 && typeof r.body.total === 'number',
      `total=${r.body.total}  revenueAtRisk=$${r.body.revenueAtRisk?.toFixed(2)}`)
  } catch (e) {
    check('GET  /api/claims/action-items', false, e.message)
  }

  // 6. ERA webhook — raw EDI text, no JWT
  try {
    const edi = getMockEDI835('aetna_mixed')
    const r = await apiRequest('POST', '/webhooks/era', {
      body: edi,
      headers: {
        'Content-Type':    'text/plain',
        'X-Webhook-Secret': process.env.WEBHOOK_SECRET || 'clearpath_webhook_secret_dev'
      }
    })
    check('POST /api/webhooks/era', r.status === 200 && typeof r.body.claimsProcessed === 'number',
      `claims=${r.body.claimsProcessed}  paid=$${r.body.totalPaid?.toFixed(2)}`)
  } catch (e) {
    check('POST /api/webhooks/era', false, e.message)
  }

  const total = pass + fail
  const color = fail === 0 ? GREEN : RED
  console.log(`\n${color}${total} tests — ${pass} passed, ${fail} failed${RESET}\n`)
}

;(async () => {
  try {
    await runTests()
  } catch (err) {
    console.error('Test runner error:', err)
  } finally {
    process.exit(fail > 0 ? 1 : 0)
  }
})()
