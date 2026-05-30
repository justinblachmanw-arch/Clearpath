---
name: run-clearpath
description: run, start, build, test, smoke test, screenshot, launch Clearpath API server
---

Clearpath is a Node.js/Express REST API backed by PostgreSQL. It is driven programmatically via `.claude/skills/run-clearpath/driver.mjs`, which starts the server in-process, runs a full smoke sequence (health, auth, dashboard, claims, credentials), then shuts down. No separate terminal or GUI needed.

## Prerequisites

- Node.js 18+ (v24 confirmed working)
- PostgreSQL running locally with database `clearpath_dev`
- `.env` file at repo root with `DATABASE_URL`, `JWT_SECRET`, `API_PORT` (defaults to 3001)
- `npm install` already run

No OS packages beyond Node + Postgres.

## Build

No compile step. CommonJS — runs directly.

```
npm install
```

## Run (agent path)

```
node .claude/skills/run-clearpath/driver.mjs [port]
```

Port defaults to `3099`. Accepts one optional positional argument.

What the driver does:
1. Starts the Express server in-process on the given port
2. Runs these smoke checks in order:
   - `GET /api/health` → 200
   - `GET /api/dashboard` (no auth) → 401
   - `POST /api/auth/login` (seed creds) → 200 + JWT
   - `GET /api/dashboard` (authed) → 200 + response keys logged
   - `GET /api/claims/action-items` (authed) → 200
   - `GET /api/credentials` (authed) → 200
3. Prints ✓/✗ per check, exits 0 on all-pass, 1 on any failure
4. Shuts down the server cleanly

Example run — verified output:

```
[driver] Starting Clearpath API on port 3099...
[DB] Connected to PostgreSQL — clearpath_dev
[CODING INTEL] 12 tables + indexes ready
[API] DB schema ready
[API] Server running on port 3099
[driver] Server ready. Running smoke checks...

  ✓ GET /api/health → 200 {"status":"ok","timestamp":"...","version":"1.0.0"}
  ✓ GET /api/dashboard (no auth) → 401
  ✓ POST /api/auth/login → 200
  ✓ GET /api/dashboard (authed) → 200
      keys: provider, metrics, sparklines, todayAppointments, actionItems, credentialAlerts, payerPatterns
  ✓ GET /api/claims/action-items (authed) → 200
  ✓ GET /api/credentials (authed) → 200

[driver] All checks passed.
```

### Calling individual endpoints during development

```js
// In-process — no server needed
const { app } = require('./src/api/server')
const request = require('supertest')  // if installed
const res = await request(app).get('/api/health')
```

Or start the server and use curl:

```
node -e "require('./src/api/server').start(3099).then(() => console.log('ready'))" &
curl -s http://localhost:3099/api/health
curl -s -X POST http://localhost:3099/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dr.patel@clearpathhealth.com","password":"clearpath_dev"}'
```

## Run (human path)

```
node src/api/server.js
```

Server starts on `API_PORT` (default 3001), runs until Ctrl-C. Not useful headless.

## Seed credentials

The database is seeded with one provider:

| Field    | Value                            |
|----------|----------------------------------|
| email    | `dr.patel@clearpathhealth.com`   |
| password | any value (no hash set in dev)   |

Login returns a JWT valid for 24h. Pass as `Authorization: Bearer <token>`.

## Gotchas

- **`dotenv` fires on every `require()`** — every module calls `require('dotenv').config()`. You'll see 20+ `◇ injected env` log lines on startup. Normal. Filter with `| grep -v "injected env"`.
- **`pdf-parse` must be v1.1.1** — v2 exports a class not a function and breaks `fetchPDF()` across all scrapers. Package.json pins `^1.1.1`. If it ever upgrades, `fetchPDF` silently returns null.
- **`migrateCodingIntelligence` runs on every start** — 12 tables + 27 indexes created with `IF NOT EXISTS`. Adds ~500ms to startup. Normal.
- **Dashboard spawns 6 parallel DB connections** — expected; pool handles it. Not a leak.
- **Auth accepts any password when `password_hash` is null** — by design for dev bootstrapping. Production requires a set hash.
- **Port 3001 is default for human path; driver uses 3099** — avoids collision with a running dev server.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 5432` | PostgreSQL not running. Start it. |
| `database "clearpath_dev" does not exist` | `createdb clearpath_dev` |
| `Cannot find module '../db'` | Running from wrong directory. Must `cd` to `Clearpath/` first. |
| `pdfParse is not a function` | `pdf-parse` upgraded past v1. Run `npm install pdf-parse@1.1.1`. |
| `[API] Schema setup error: relation "providers" does not exist` | DB exists but tables not seeded. Check `src/db/schema.sql` or prior migration. |
| Login returns 401 `Invalid email or password` | `password_hash` was set on the provider row. Reset: `UPDATE providers SET password_hash = NULL WHERE email = 'dr.patel@clearpathhealth.com'` |
