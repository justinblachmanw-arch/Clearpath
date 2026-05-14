require('dotenv').config()
const express        = require('express')
const helmet         = require('helmet')
const cors           = require('cors')
const { rateLimit }  = require('express-rate-limit')
const db             = require('../db')
const { errorHandler } = require('./middleware/errorHandler')

const healthRouter      = require('./routes/health')
const authRouter        = require('./routes/auth')
const dashboardRouter   = require('./routes/dashboard')
const appointmentsRouter = require('./routes/appointments')
const claimsRouter      = require('./routes/claims')
const webhooksRouter    = require('./routes/webhooks')

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

app.use(errorHandler)

async function ensureDbSchema() {
  try {
    await db.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS email         VARCHAR(255) UNIQUE`)
    await db.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`)
    await db.query(
      `UPDATE providers SET email = 'dr.patel@clearpathhealth.com' WHERE id = 1`
    )
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
