/**
 * Clearpath API smoke driver
 * Usage: node .claude/skills/run-clearpath/driver.mjs [port]
 *
 * Starts the Express API on the given port (default 3099), runs a
 * representative smoke sequence (health, auth, dashboard, claims),
 * prints results, then shuts down cleanly.
 *
 * Exit code 0 = all checks passed. Non-zero = something failed.
 *
 * All paths are relative to the repo root (Clearpath/).
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import http from 'http'

const require = createRequire(import.meta.url)
// Root of the repo — three levels up from .claude/skills/run-clearpath/
const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(opts, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
    })
    r.on('error', reject)
    if (body) r.write(JSON.stringify(body))
    r.end()
  })
}

async function smoke(port) {
  const failures = []

  function check(label, status, expected, bodySnippet) {
    const ok = status === expected
    const mark = ok ? '✓' : '✗'
    console.log(`  ${mark} ${label} → ${status}${bodySnippet ? ' ' + bodySnippet : ''}`)
    if (!ok) failures.push(`${label}: expected ${expected} got ${status}`)
    return ok
  }

  // ── 1. Health ─────────────────────────────────────────────────────────────
  const h = await req({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET' })
  check('GET /api/health', h.status, 200, h.body.slice(0, 80))

  // ── 2. Unauthenticated endpoints must 401 ─────────────────────────────────
  const noauth = await req({ hostname: '127.0.0.1', port, path: '/api/dashboard', method: 'GET' })
  check('GET /api/dashboard (no auth)', noauth.status, 401)

  // ── 3. Login ──────────────────────────────────────────────────────────────
  const loginRes = await req(
    { hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { email: 'dr.patel@clearpathhealth.com', password: 'clearpath_dev' }
  )
  const loginOk = check('POST /api/auth/login', loginRes.status, 200)
  if (!loginOk) { failures.push('Login failed — cannot run authed checks'); return failures }

  const token = JSON.parse(loginRes.body).token
  const authHeader = { Authorization: 'Bearer ' + token }

  // ── 4. Authenticated dashboard ────────────────────────────────────────────
  const dash = await req({ hostname: '127.0.0.1', port, path: '/api/dashboard', method: 'GET', headers: authHeader })
  const dashOk = check('GET /api/dashboard (authed)', dash.status, 200)
  if (dashOk) {
    const keys = Object.keys(JSON.parse(dash.body)).join(', ')
    console.log(`      keys: ${keys}`)
  }

  // ── 5. Claims action items ────────────────────────────────────────────────
  const claims = await req({ hostname: '127.0.0.1', port, path: '/api/claims/action-items', method: 'GET', headers: authHeader })
  check('GET /api/claims/action-items (authed)', claims.status, 200)

  // ── 6. Credentials list ───────────────────────────────────────────────────
  const creds = await req({ hostname: '127.0.0.1', port, path: '/api/credentials', method: 'GET', headers: authHeader })
  check('GET /api/credentials (authed)', creds.status, 200)

  return failures
}

async function main() {
  const port = parseInt(process.argv[2] || '3099')

  // Load server from repo root
  const { start } = require(path.join(root, 'src', 'api', 'server'))

  console.log(`[driver] Starting Clearpath API on port ${port}...`)
  let srv
  try {
    srv = await start(port)
  } catch (err) {
    console.error('[driver] Server failed to start:', err.message)
    process.exit(1)
  }
  console.log(`[driver] Server ready. Running smoke checks...\n`)

  let failures = []
  try {
    failures = await smoke(port)
  } catch (err) {
    console.error('[driver] Smoke sequence threw:', err.message)
    failures.push(err.message)
  } finally {
    srv.close()
  }

  if (failures.length === 0) {
    console.log('\n[driver] All checks passed.')
    process.exit(0)
  } else {
    console.error('\n[driver] FAILURES:')
    failures.forEach(f => console.error('  -', f))
    process.exit(1)
  }
}

main()
