require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'clearpath_dev',
  user:     process.env.DB_USER     || 'clearpath',
  password: process.env.DB_PASSWORD || 'clearpath_dev_password'
})

pool.on('connect', () => {
  console.log('[DB] Connected to PostgreSQL — clearpath_dev')
})

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message)
})

// Base query wrapper — all agents call this, never the pool directly
async function query(text, params) {
  try {
    const result = await pool.query(text, params)
    return result
  } catch (err) {
    console.error('[DB] Query error:', err.message, '| Query:', text.slice(0, 80))
    throw err
  }
}

// ─── PROVIDERS ────────────────────────────────────────────────────────────────

async function getProvider(providerId) {
  const result = await query('SELECT * FROM providers WHERE id = $1', [providerId])
  return result.rows[0] || null
}

// ─── APPOINTMENTS ─────────────────────────────────────────────────────────────

async function getAppointmentsByDate(providerId, date) {
  const result = await query(
    `SELECT a.*, p.token AS patient_token, p.payer_code, p.payer_name, p.insurance_member_id
     FROM appointments a
     JOIN patients p ON a.patient_id = p.id
     WHERE a.provider_id = $1 AND a.date = $2
     ORDER BY a.id`,
    [providerId, date]
  )
  return result.rows
}

async function saveEligibilityResult(appointmentId, status, summary, copay = null, deductibleRemaining = null) {
  const result = await query(
    `UPDATE appointments
     SET eligibility_status = $1, eligibility_summary = $2,
         copay = $3, deductible_remaining = $4
     WHERE id = $5
     RETURNING id`,
    [status, summary, copay, deductibleRemaining, appointmentId]
  )
  return result.rows[0] || null
}

// ─── ERA FILES ────────────────────────────────────────────────────────────────

async function saveERAFile(eraData) {
  const result = await query(
    `INSERT INTO era_files
       (provider_id, payer_name, payer_id, check_number, check_date,
        total_paid, claims_count, parse_warning, raw_edi, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     RETURNING id`,
    [
      eraData.providerId, eraData.payerName, eraData.payerId,
      eraData.checkNumber, eraData.checkDate, eraData.totalPaid,
      eraData.claimsCount, eraData.parseWarning || null, eraData.rawEdi || null
    ]
  )
  return result.rows[0]
}

// ─── CLAIMS ───────────────────────────────────────────────────────────────────

async function saveClaim(claimData) {
  const result = await query(
    `INSERT INTO claims
       (provider_id, patient_id, appointment_id, claim_number, status,
        billed_amount, paid_amount, patient_responsibility, contractual_adjustment,
        payer_code, payer_name, date_of_service, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
     RETURNING id`,
    [
      claimData.providerId, claimData.patientId, claimData.appointmentId || null,
      claimData.claimNumber, claimData.status,
      claimData.billedAmount, claimData.paidAmount || 0,
      claimData.patientResponsibility || 0, claimData.contractualAdjustment || 0,
      claimData.payerCode, claimData.payerName, claimData.dateOfService
    ]
  )
  return result.rows[0]
}

// ─── ACTION ITEMS ─────────────────────────────────────────────────────────────

async function saveActionItem(actionItemData) {
  const result = await query(
    `INSERT INTO action_items
       (provider_id, type, priority, title, description, ai_instruction,
        source_agent, source_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      actionItemData.providerId, actionItemData.type, actionItemData.priority,
      actionItemData.title, actionItemData.description || null,
      actionItemData.aiInstruction || null,
      actionItemData.sourceAgent || null, actionItemData.sourceId || null
    ]
  )
  return result.rows[0]
}

async function getOpenActionItems(providerId) {
  const result = await query(
    `SELECT * FROM action_items
     WHERE provider_id = $1 AND resolved = FALSE
     ORDER BY priority ASC, created_at DESC`,
    [providerId]
  )
  return result.rows
}

async function updateActionItemResolved(actionItemId) {
  const result = await query(
    `UPDATE action_items
     SET resolved = TRUE, resolved_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [actionItemId]
  )
  return result.rows[0] || null
}

// ─── CREDENTIALS ──────────────────────────────────────────────────────────────

async function getCredentials(providerId) {
  const result = await query(
    `SELECT * FROM credentials
     WHERE provider_id = $1
     ORDER BY expiry_date ASC NULLS LAST`,
    [providerId]
  )
  return result.rows
}

async function getExpiringCredentials(providerId, daysThreshold) {
  const result = await query(
    `SELECT * FROM credentials
     WHERE provider_id = $1
       AND expiry_date IS NOT NULL
       AND expiry_date <= NOW() + ($2 * INTERVAL '1 day')
     ORDER BY expiry_date ASC`,
    [providerId, daysThreshold]
  )
  return result.rows
}

module.exports = {
  pool,
  query,
  getProvider,
  getAppointmentsByDate,
  saveEligibilityResult,
  saveERAFile,
  saveClaim,
  saveActionItem,
  getOpenActionItems,
  updateActionItemResolved,
  getCredentials,
  getExpiringCredentials
}
