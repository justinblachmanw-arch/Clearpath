require('dotenv').config()
const express        = require('express')
const helmet         = require('helmet')
const cors           = require('cors')
const { rateLimit }  = require('express-rate-limit')
const db             = require('../db')
const { errorHandler } = require('./middleware/errorHandler')

const healthRouter       = require('./routes/health')
const authRouter         = require('./routes/auth')
const dashboardRouter    = require('./routes/dashboard')
const appointmentsRouter = require('./routes/appointments')
const claimsRouter       = require('./routes/claims')
const webhooksRouter     = require('./routes/webhooks')
const credentialsRouter  = require('./routes/credentials')
const financialsRouter   = require('./routes/financials')
const intakeRouter       = require('./routes/intake')
const maRouter           = require('./routes/ma')
const agentsRouter       = require('./routes/agents')
const adminRouter        = require('./routes/admin')

const app = express()

app.use(helmet())
app.use(cors())
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }))
app.use(express.json())
app.use(express.text({ type: ['text/plain', 'application/edi-x12'] }))

app.use('/api', healthRouter)
app.use('/api', authRouter)
app.use('/api', dashboardRouter)
app.use('/api', appointmentsRouter)
app.use('/api', claimsRouter)
app.use('/api', webhooksRouter)
app.use('/api', credentialsRouter)
app.use('/api', financialsRouter)
app.use('/api', intakeRouter)
app.use('/api', maRouter)
app.use('/api', agentsRouter)
app.use('/api', adminRouter)

app.use(errorHandler)

// PAYER POLICY REFRESH — runs 1st of each month
// TODO: Enable when going live
// const cron = require('node-cron')
// cron.schedule('0 8 1 * *', async () => {
//   const { runPayerPolicyScraper } = require('../lib/payerPolicyScraper')
//   try { await runPayerPolicyScraper() }
//   catch (err) { console.error('[CRON] Payer policy refresh error:', err.message) }
// })

// CRON JOBS DISABLED — enable when going live
// Replace with Medplum Bots when paid plan enabled
// Bot IDs: eligibility 0304be0c, claimscrub 175a10ad,
//          era 22ac39bf, credentialing 9b9c2ec3, practiceops d3fa8b90
//
// const cron = require('node-cron')
//
// // Daily at 6am UTC — credential expiry alerts
// cron.schedule('0 6 * * *', async () => {
//   const { runCredentialingAgent } = require('./agents/credentialingAgent')
//   try { await runCredentialingAgent(1) }
//   catch (err) { console.error('[CRON] Credentialing agent error:', err.message) }
// })
//
// // Daily at 7am UTC — morning practice ops briefing
// cron.schedule('0 7 * * *', async () => {
//   const { runPracticeOpsAgent } = require('./agents/practiceOpsAgent')
//   try { await runPracticeOpsAgent({ providerId: 1 }) }
//   catch (err) { console.error('[CRON] Practice ops agent error:', err.message) }
// })

async function ensureDbSchema() {
  try {
    await db.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS email         VARCHAR(255) UNIQUE`)
    await db.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`)
    await db.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS scheduled_time TIME`)
    await db.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'booked'`)
    await db.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS check_in_time TIMESTAMP`)
    await db.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMP`)
    await db.query(
      `UPDATE providers SET email = 'dr.patel@clearpathhealth.com' WHERE id = 1`
    )

    await db.query(`
      CREATE TABLE IF NOT EXISTS patient_intake (
        id                  SERIAL PRIMARY KEY,
        patient_id          INT REFERENCES patients(id),
        appointment_id      INT REFERENCES appointments(id),
        chief_complaint     TEXT,
        complaint_duration  TEXT,
        severity            INT,
        current_medications JSONB DEFAULT '[]',
        allergies           JSONB DEFAULT '[]',
        conditions          JSONB DEFAULT '[]',
        prior_surgeries     TEXT,
        family_history      TEXT,
        emergency_contact_name  TEXT,
        emergency_contact_phone TEXT,
        preferred_pharmacy  TEXT,
        insurance_card_front TEXT,
        insurance_card_back  TEXT,
        extracted_insurance  JSONB,
        hipaa_acknowledged  BOOLEAN DEFAULT FALSE,
        financial_consent   BOOLEAN DEFAULT FALSE,
        consent_to_treat    BOOLEAN DEFAULT FALSE,
        submitted_at        TIMESTAMP,
        created_at          TIMESTAMP DEFAULT NOW()
      )
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS vitals (
        id             SERIAL PRIMARY KEY,
        appointment_id INT REFERENCES appointments(id),
        patient_id     INT REFERENCES patients(id),
        provider_id    INT REFERENCES providers(id),
        bp_systolic    INT,
        bp_diastolic   INT,
        heart_rate     INT,
        temperature    DECIMAL(4,1),
        weight_lbs     DECIMAL(5,1),
        height_inches  DECIMAL(4,1),
        o2_saturation  INT,
        recorded_by    TEXT,
        recorded_at    TIMESTAMP DEFAULT NOW(),
        created_at     TIMESTAMP DEFAULT NOW()
      )
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id             SERIAL PRIMARY KEY,
        appointment_id INT REFERENCES appointments(id),
        patient_id     INT REFERENCES patients(id),
        provider_id    INT REFERENCES providers(id),
        order_type     TEXT,
        order_name     TEXT,
        order_code     TEXT,
        status         TEXT DEFAULT 'ordered',
        ordered_at     TIMESTAMP DEFAULT NOW(),
        created_at     TIMESTAMP DEFAULT NOW()
      )
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS ma_users (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        pin         TEXT NOT NULL,
        provider_id INT REFERENCES providers(id),
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS clinical_notes (
        id               SERIAL PRIMARY KEY,
        appointment_id   INT REFERENCES appointments(id),
        patient_id       INT REFERENCES patients(id),
        provider_id      INT REFERENCES providers(id),
        soap_subjective  TEXT,
        soap_objective   TEXT,
        soap_assessment  TEXT,
        soap_plan        TEXT,
        icd10_codes      JSONB DEFAULT '[]',
        cpt_code         TEXT,
        cpt_modifier     TEXT,
        signed_at        TIMESTAMP,
        signed_by        TEXT,
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW()
      )
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS payer_policies (
        id                     SERIAL PRIMARY KEY,
        payer_name             VARCHAR(100) NOT NULL,
        payer_code             VARCHAR(20)  NOT NULL,
        cpt_code               VARCHAR(10)  NOT NULL,
        policy_name            TEXT,
        policy_url             TEXT,
        coverage_criteria      TEXT,
        documentation_required TEXT,
        common_denial_reasons  TEXT,
        appeal_strategy        TEXT,
        source                 VARCHAR(50),
        effective_date         DATE,
        last_scraped_at        TIMESTAMP,
        raw_content            TEXT,
        created_at             TIMESTAMP DEFAULT NOW(),
        updated_at             TIMESTAMP DEFAULT NOW(),
        UNIQUE (payer_code, cpt_code)
      )
    `)
    await db.query(`CREATE INDEX IF NOT EXISTS idx_payer_policies_cpt   ON payer_policies(cpt_code)`)
    await db.query(`CREATE INDEX IF NOT EXISTS idx_payer_policies_payer ON payer_policies(payer_code)`)

    await db.query(`
      CREATE TABLE IF NOT EXISTS coding_guidelines (
        id             SERIAL PRIMARY KEY,
        source         VARCHAR(50)  NOT NULL,
        source_url     TEXT,
        cpt_code       VARCHAR(10),
        guideline_type VARCHAR(50),
        title          TEXT,
        content        TEXT NOT NULL,
        effective_date DATE,
        last_updated   TIMESTAMP DEFAULT NOW(),
        created_at     TIMESTAMP DEFAULT NOW(),
        UNIQUE (source, cpt_code, guideline_type)
      )
    `)
    await db.query(`CREATE INDEX IF NOT EXISTS idx_coding_guidelines_cpt  ON coding_guidelines(cpt_code)`)
    await db.query(`CREATE INDEX IF NOT EXISTS idx_coding_guidelines_type ON coding_guidelines(guideline_type)`)

    await db.query(`
      CREATE TABLE IF NOT EXISTS carc_rarc_codes (
        id           SERIAL PRIMARY KEY,
        code_type    VARCHAR(10) NOT NULL,
        code         VARCHAR(20) NOT NULL,
        description  TEXT NOT NULL,
        category     VARCHAR(50),
        fix_action   TEXT,
        appeal_angle TEXT,
        related_codes TEXT[],
        last_updated TIMESTAMP DEFAULT NOW(),
        created_at   TIMESTAMP DEFAULT NOW(),
        UNIQUE (code_type, code)
      )
    `)

    // Seed default MA user if none exists
    const maCheck = await db.query(`SELECT id FROM ma_users LIMIT 1`)
    if (!maCheck.rows.length) {
      const provRow = await db.query(`SELECT id FROM providers ORDER BY id LIMIT 1`)
      if (provRow.rows.length) {
        await db.query(
          `INSERT INTO ma_users (name, pin, provider_id) VALUES ('Sarah', '1234', $1)
           ON CONFLICT DO NOTHING`,
          [provRow.rows[0].id]
        )
        console.log('[API] MA user seeded')
      }
    }

    console.log('[API] DB schema ready')
  } catch (err) {
    console.error('[API] Schema setup error:', err.message)
  }
}

async function start(port) {
  const PORT = port || parseInt(process.env.API_PORT) || 3001
  await ensureDbSchema()
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`[API] Server running on port ${PORT}`)
      resolve(server)
    })
    server.on('error', reject)
  })
}

module.exports = { app, start }

if (require.main === module) {
  start().catch(err => { console.error('[API] Fatal:', err.message); process.exit(1) })
}
