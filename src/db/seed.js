require('dotenv').config()
const { Pool } = require('pg')
const { getDenialInfo } = require('../lib/denialCodes')

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'clearpath_dev',
  user:     process.env.DB_USER     || 'clearpath',
  password: process.env.DB_PASSWORD || 'clearpath_dev_password'
})

// ─── Date helpers ──────────────────────────────────────────────────────────────

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

function dateStr(d) { return d.toISOString().split('T')[0] }
function addDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return d }

function monthStart(monthsAgo) {
  const d = new Date(TODAY)
  d.setDate(1)
  d.setMonth(d.getMonth() - monthsAgo)
  return d
}

function monthEnd(monthsAgo) {
  if (monthsAgo === 0) return new Date(TODAY)
  const d = new Date(TODAY)
  d.setDate(1)
  d.setMonth(d.getMonth() - monthsAgo + 1)
  d.setDate(0)
  return d
}

function getWorkingDays(start, end) {
  const days = []
  const d = new Date(start)
  while (d <= end) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) days.push(dateStr(new Date(d)))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function daysInMonth(monthsAgo) {
  const d = new Date(TODAY)
  d.setDate(1)
  d.setMonth(d.getMonth() - monthsAgo + 1)
  d.setDate(0)
  return d.getDate()
}

// ─── Practice config ───────────────────────────────────────────────────────────

const PROVIDER = {
  name: 'Dr. Anjali Patel', npi: '1234567890', tax_id: '123456789',
  specialty: 'Primary Care', phone: '212-555-0100',
  email: 'apatel@clearpathhealth.com', state: 'NY'
}

// Monthly growth targets and rates (index 0 = 5 months ago, index 5 = current month)
const MONTH_CONFIG = [
  { monthsAgo: 5, targetVisits: 120, collectRate: 82, denialRate: 13 },
  { monthsAgo: 4, targetVisits: 150, collectRate: 83, denialRate: 12 },
  { monthsAgo: 3, targetVisits: 180, collectRate: 84, denialRate: 11 },
  { monthsAgo: 2, targetVisits: 200, collectRate: 85, denialRate: 10 },
  { monthsAgo: 1, targetVisits: 210, collectRate: 86, denialRate:  9 },
  { monthsAgo: 0, targetVisits: 220, collectRate: 87, denialRate:  8 },
]

// Today's schedule — 8 distinct patients with specific times (no claims yet, visit just scheduled)
const TODAY_STR = dateStr(TODAY)
const TODAY_SCHEDULE = [
  { patientIdx:  0, time: '09:00', visitType: 'Annual Wellness',   eligStatus: 'active'    },
  { patientIdx:  2, time: '09:30', visitType: 'Follow-up',          eligStatus: 'active'    },
  { patientIdx:  4, time: '10:00', visitType: 'New Patient',        eligStatus: 'active'    },
  { patientIdx:  6, time: '10:30', visitType: 'Sick Visit',         eligStatus: 'not_found' },
  { patientIdx:  8, time: '11:00', visitType: 'Follow-up',          eligStatus: 'active'    },
  { patientIdx: 10, time: '11:30', visitType: 'Medication Review',  eligStatus: 'active'    },
  { patientIdx: 12, time: '13:00', visitType: 'Annual Wellness',    eligStatus: 'inactive'  },
  { patientIdx: 14, time: '14:00', visitType: 'Follow-up',          eligStatus: 'active'    },
]

const VISIT_CONFIG = {
  'Annual Wellness':   { cpt: '99395', amount: 280 },
  'New Patient':       { cpt: '99205', amount: 320 },
  'Follow-up':         { cpt: '99214', amount: 220 },
  'Sick Visit':        { cpt: '99213', amount: 150 },
  'Medication Review': { cpt: '99213', amount: 150 },
  'Telehealth':        { cpt: '99214', amount: 220 },
}

const VISIT_TYPES = Object.keys(VISIT_CONFIG)

// Time slots for appointments throughout the day
const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'
]

// Denial codes weighted toward most common real-world codes
const DENIAL_CODES_WEIGHTED = [
  'CO-97', 'CO-4', 'CO-97', 'CO-50', 'CO-11', 'CO-4',
  'CO-97', 'CO-16', 'CO-4',  'CO-197', 'CO-97', 'CO-45'
]

const ICD10_CODES = ['I10', 'E11.9', 'Z00.00', 'J06.9', 'M54.5', 'F32.1', 'E78.5', 'J18.9', 'Z12.31', 'Z79.4']

const PATIENTS_RAW = [
  { first: 'Maria',       last: 'Santos',    dob: '1978-04-12', payer_code: 'AETNA',    payer_name: 'Aetna',                  member_id: 'AET-992847',   phone: '+12125550001' },
  { first: 'James',       last: 'Chen',      dob: '1965-08-22', payer_code: 'UHC',      payer_name: 'UnitedHealthcare',        member_id: 'UHC-882341',   phone: '+12125550002' },
  { first: 'David',       last: 'Park',      dob: '1990-01-15', payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield',  member_id: 'BCBS-771234',  phone: '+12125550003' },
  { first: 'Sarah',       last: 'Johnson',   dob: '1952-03-28', payer_code: 'MEDICARE', payer_name: 'Medicare',                member_id: '1EG4TE5MK72', phone: '+12125550004' },
  { first: 'Robert',      last: 'Williams',  dob: '1968-11-05', payer_code: 'AETNA',    payer_name: 'Aetna',                  member_id: 'AET-445678',   phone: '+12125550005' },
  { first: 'Emily',       last: 'Davis',     dob: '1982-07-19', payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield',  member_id: 'BCBS-334521',  phone: '+12125550006' },
  { first: 'Michael',     last: 'Brown',     dob: '1945-09-14', payer_code: 'MEDICARE', payer_name: 'Medicare',                member_id: '2QV7GH8NP93', phone: '+12125550007' },
  { first: 'Jennifer',    last: 'Garcia',    dob: '1975-12-30', payer_code: 'AETNA',    payer_name: 'Aetna',                  member_id: 'AET-556789',   phone: '+12125550008' },
  { first: 'Christopher', last: 'Martinez',  dob: '1988-06-08', payer_code: 'UHC',      payer_name: 'UnitedHealthcare',        member_id: 'UHC-998877',   phone: '+12125550009' },
  { first: 'Amanda',      last: 'Wilson',    dob: '1993-02-14', payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield',  member_id: 'BCBS-667788',  phone: '+12125550010' },
  { first: 'Daniel',      last: 'Anderson',  dob: '1970-04-22', payer_code: 'AETNA',    payer_name: 'Aetna',                  member_id: 'AET-112233',   phone: '+12125550011' },
  { first: 'Ashley',      last: 'Thompson',  dob: '1958-08-17', payer_code: 'MEDICARE', payer_name: 'Medicare',                member_id: '3WX9JK2LM84', phone: '+12125550012' },
  { first: 'Matthew',     last: 'Taylor',    dob: '1985-10-03', payer_code: 'UHC',      payer_name: 'UnitedHealthcare',        member_id: 'UHC-334455',   phone: '+12125550013' },
  { first: 'Lauren',      last: 'Moore',     dob: '1972-01-28', payer_code: 'AETNA',    payer_name: 'Aetna',                  member_id: 'AET-778899',   phone: '+12125550014' },
  { first: 'Kevin',       last: 'Jackson',   dob: '1960-05-11', payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield',  member_id: 'BCBS-990011',  phone: '+12125550015' },
  { first: 'Stephanie',   last: 'White',     dob: '1949-07-02', payer_code: 'MEDICARE', payer_name: 'Medicare',                member_id: '4YZ6NP3QR95', phone: '+12125550016' },
  { first: 'Ryan',        last: 'Harris',    dob: '1995-03-19', payer_code: 'AETNA',    payer_name: 'Aetna',                  member_id: 'AET-221133',   phone: '+12125550017' },
  { first: 'Megan',       last: 'Clark',     dob: '1987-09-25', payer_code: 'UHC',      payer_name: 'UnitedHealthcare',        member_id: 'UHC-556677',   phone: '+12125550018' },
  { first: 'Brandon',     last: 'Lewis',     dob: '1973-11-08', payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield',  member_id: 'BCBS-112244',  phone: '+12125550019' },
  { first: 'Nicole',      last: 'Walker',    dob: '1980-04-16', payer_code: 'AETNA',    payer_name: 'Aetna',                  member_id: 'AET-889900',   phone: '+12125550020' }
]

const CREDENTIALS = [
  { credential_type: 'caqh',         identifier: '12345678',      issuing_body: 'CAQH',                        state: null, expiry_date: dateStr(addDays(TODAY, 1)),   status: 'active', renewal_url: 'https://proview.caqh.org', notes: 'Quarterly attestation required — overdue' },
  { credential_type: 'dea',          identifier: 'BP1234567',     issuing_body: 'DEA',                         state: null, expiry_date: dateStr(addDays(TODAY, 18)),  status: 'active', renewal_url: 'https://www.deadiversion.usdoj.gov/drugreg/reg_apps/online_forms.htm', notes: 'Renewal takes 4-6 weeks — start immediately' },
  { credential_type: 'state_license',identifier: 'MA98765',       issuing_body: 'NY Office of the Professions',state: 'NY', expiry_date: dateStr(addDays(TODAY, 48)),  status: 'active', renewal_url: 'https://www.op.nysed.gov/professions/physicians', notes: null },
  { credential_type: 'malpractice',  identifier: 'POL-2024-44321',issuing_body: 'ProAssurance',                state: null, expiry_date: dateStr(addDays(TODAY, 79)),  status: 'active', renewal_url: null, notes: 'Contact broker for renewal quote' },
  { credential_type: 'board_cert',   identifier: 'ABIM-2020-78901',issuing_body: 'ABIM',                       state: null, expiry_date: dateStr(addDays(TODAY, 88)),  status: 'active', renewal_url: 'https://www.abim.org/maintain-certification/', notes: 'MOC points required before renewal' },
  { credential_type: 'npi',          identifier: '1234567890',    issuing_body: 'CMS NPPES',                   state: null, expiry_date: null,                         status: 'active', renewal_url: 'https://nppes.cms.hhs.gov', notes: 'No expiry — update address if practice moves' }
]

const PAYER_ENROLLMENTS = [
  { payer_code: 'AETNA',    payer_name: 'Aetna',                  status: 'active',  effective_date: '2022-03-01' },
  { payer_code: 'MEDICARE', payer_name: 'Medicare',                status: 'active',  effective_date: '2021-09-15' },
  { payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield',  status: 'active',  effective_date: '2021-11-01' },
  { payer_code: 'UHC',      payer_name: 'UnitedHealthcare',        status: 'pending', effective_date: null, notes: 'Application submitted 2026-01-15' },
  { payer_code: 'MEDICAID', payer_name: 'Medicaid',                status: 'pending', effective_date: null, notes: 'Application submitted 2026-03-01' }
]

// ─── Status assignment (counter-based for repeatable distribution) ────────────

function getClaimStatus(monthIdx, counter) {
  const mod = counter % 100
  const collect = MONTH_CONFIG[monthIdx].collectRate
  const deny    = MONTH_CONFIG[monthIdx].denialRate
  if (mod < collect)              return 'paid'
  if (mod < collect + deny)       return 'denied'
  if (mod < collect + deny + 2)   return 'needs_action'
  return 'pending'
}

function getDenialCode(counter) {
  return DENIAL_CODES_WEIGHTED[counter % DENIAL_CODES_WEIGHTED.length]
}

// ─── Main seed ─────────────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect()
  console.log('[SEED] Connected')

  try {
    await client.query('BEGIN')

    // Ensure all columns and tables exist before truncating
    await client.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS scheduled_time TIME`)
    await client.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'booked'`)
    await client.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS check_in_time TIMESTAMP`)
    await client.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMP`)
    await client.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS medplum_practitioner_id TEXT`)

    await client.query(`
      CREATE TABLE IF NOT EXISTS patient_intake (
        id SERIAL PRIMARY KEY, patient_id INT REFERENCES patients(id),
        appointment_id INT REFERENCES appointments(id),
        chief_complaint TEXT, complaint_duration TEXT, severity INT,
        current_medications JSONB DEFAULT '[]', allergies JSONB DEFAULT '[]',
        conditions JSONB DEFAULT '[]', prior_surgeries TEXT, family_history TEXT,
        emergency_contact_name TEXT, emergency_contact_phone TEXT, preferred_pharmacy TEXT,
        insurance_card_front TEXT, insurance_card_back TEXT, extracted_insurance JSONB,
        hipaa_acknowledged BOOLEAN DEFAULT FALSE, financial_consent BOOLEAN DEFAULT FALSE,
        consent_to_treat BOOLEAN DEFAULT FALSE, submitted_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
      )`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS vitals (
        id SERIAL PRIMARY KEY, appointment_id INT REFERENCES appointments(id),
        patient_id INT REFERENCES patients(id), provider_id INT REFERENCES providers(id),
        bp_systolic INT, bp_diastolic INT, heart_rate INT, temperature DECIMAL(4,1),
        weight_lbs DECIMAL(5,1), height_inches DECIMAL(4,1), o2_saturation INT,
        recorded_by TEXT, recorded_at TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW()
      )`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY, appointment_id INT REFERENCES appointments(id),
        patient_id INT REFERENCES patients(id), provider_id INT REFERENCES providers(id),
        order_type TEXT, order_name TEXT, order_code TEXT, status TEXT DEFAULT 'ordered',
        ordered_at TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW()
      )`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ma_users (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, pin TEXT NOT NULL,
        provider_id INT REFERENCES providers(id), created_at TIMESTAMP DEFAULT NOW()
      )`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS clinical_notes (
        id SERIAL PRIMARY KEY, appointment_id INT REFERENCES appointments(id),
        patient_id INT REFERENCES patients(id), provider_id INT REFERENCES providers(id),
        soap_subjective TEXT, soap_objective TEXT, soap_assessment TEXT, soap_plan TEXT,
        icd10_codes JSONB DEFAULT '[]', cpt_code TEXT, cpt_modifier TEXT,
        signed_at TIMESTAMP, signed_by TEXT,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )`)

    await client.query(`
      TRUNCATE action_items, era_files, adjustments, claim_lines, claims,
               appointments, payer_enrollments, credentials, patients, providers
      RESTART IDENTITY CASCADE
    `)
    // Clear dependent new tables — use savepoint so a missing table doesn't abort the transaction
    await client.query('SAVEPOINT before_new_tables')
    try {
      await client.query(`TRUNCATE TABLE patient_intake, vitals, orders, clinical_notes, ma_users RESTART IDENTITY CASCADE`)
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT before_new_tables')
    }
    await client.query('RELEASE SAVEPOINT before_new_tables')
    console.log('[SEED] Tables cleared')

    // ── Provider ──────────────────────────────────────────────────────────────
    const provRes = await client.query(
      `INSERT INTO providers (name, npi, tax_id, specialty, phone, email, state, medplum_practitioner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [PROVIDER.name, PROVIDER.npi, PROVIDER.tax_id, PROVIDER.specialty,
       PROVIDER.phone, PROVIDER.email, PROVIDER.state,
       process.env.MEDPLUM_PRACTITIONER_ID || null]
    )
    const providerId = provRes.rows[0].id
    console.log(`[SEED] Provider: ${PROVIDER.name}`)

    // ── MA Users ──────────────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO ma_users (name, pin, provider_id) VALUES ('Sarah', '1234', $1)`,
      [providerId]
    )
    console.log('[SEED] MA user: Sarah (PIN 1234)')

    // ── Credentials ───────────────────────────────────────────────────────────
    for (const c of CREDENTIALS) {
      await client.query(
        `INSERT INTO credentials (provider_id,credential_type,identifier,issuing_body,state,expiry_date,status,renewal_url,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [providerId, c.credential_type, c.identifier, c.issuing_body, c.state,
         c.expiry_date, c.status, c.renewal_url, c.notes]
      )
    }
    console.log(`[SEED] ${CREDENTIALS.length} credentials`)

    // ── Payer Enrollments ─────────────────────────────────────────────────────
    for (const pe of PAYER_ENROLLMENTS) {
      await client.query(
        `INSERT INTO payer_enrollments (provider_id,payer_code,payer_name,status,effective_date,notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [providerId, pe.payer_code, pe.payer_name, pe.status, pe.effective_date || null, pe.notes || null]
      )
    }

    // ── Patients ──────────────────────────────────────────────────────────────
    const patientIds = []
    for (let i = 0; i < PATIENTS_RAW.length; i++) {
      const p     = PATIENTS_RAW[i]
      const token = `PT-${Buffer.from(p.first + p.last + p.dob).toString('hex').slice(0, 8).toUpperCase()}`
      const res   = await client.query(
        `INSERT INTO patients (provider_id,token,first_name_encrypted,last_name_encrypted,dob_encrypted,insurance_member_id,payer_code,payer_name,phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [providerId, token, `ENC:${p.first}`, `ENC:${p.last}`, `ENC:${p.dob}`,
         p.member_id, p.payer_code, p.payer_name, p.phone]
      )
      patientIds.push({ id: res.rows[0].id, ...p, token })
    }
    console.log(`[SEED] ${patientIds.length} patients`)

    // ── Today's schedule (appointments only, claims submitted after visit) ───
    for (const slot of TODAY_SCHEDULE) {
      const patient  = patientIds[slot.patientIdx]
      const copay    = slot.eligStatus === 'active' ? (patient.payer_code === 'MEDICARE' ? 20 : 30) : null
      const deductRem = slot.eligStatus === 'active' ? 650 : null
      const eligSum   = slot.eligStatus === 'active'
        ? `Coverage active — ${patient.payer_name} — copay $${copay}`
        : slot.eligStatus === 'inactive' ? 'Coverage inactive as of appointment date'
        : 'Member ID not found in payer system'

      await client.query(
        `INSERT INTO appointments
           (provider_id, patient_id, date, visit_type, scheduled_time,
            eligibility_status, eligibility_summary, copay, deductible_remaining, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'booked')`,
        [providerId, patient.id, TODAY_STR, slot.visitType, slot.time,
         slot.eligStatus, eligSum, copay, deductRem]
      )
    }
    console.log(`[SEED] Today's schedule: ${TODAY_SCHEDULE.length} appointments (${TODAY_STR})`)

    // ── Historical months — appointments + claims ─────────────────────────────
    let globalVisitCounter = 0
    let totalAppts = TODAY_SCHEDULE.length
    let totalClaims = 0
    let totalAdjustments = 0
    const eraGroups = [] // for ERA file creation

    for (let mIdx = 0; mIdx < MONTH_CONFIG.length; mIdx++) {
      const cfg = MONTH_CONFIG[mIdx]
      const start = monthStart(cfg.monthsAgo)
      const end   = monthEnd(cfg.monthsAgo)

      // For current month: only days before today (today handled above)
      const workDays = getWorkingDays(start, end).filter(d => d < TODAY_STR)
      if (workDays.length === 0) continue

      // Scale visits proportionally for current month
      const totalDays = daysInMonth(cfg.monthsAgo)
      const daysElapsed = workDays.length
      const allWorkDaysInMonth = getWorkingDays(monthStart(cfg.monthsAgo), new Date(TODAY.getFullYear(), TODAY.getMonth() - cfg.monthsAgo + 1, 0)).length
      const scaledVisits = cfg.monthsAgo === 0
        ? Math.ceil(cfg.targetVisits * daysElapsed / (allWorkDaysInMonth || 1))
        : cfg.targetVisits

      // Distribute visits across working days
      const basePerDay = Math.floor(scaledVisits / workDays.length)
      const extra      = scaledVisits % workDays.length

      const monthEraGroup = []
      let dayIdx = 0

      for (const day of workDays) {
        const visitsToday = basePerDay + (dayIdx < extra ? 1 : 0)
        dayIdx++

        for (let v = 0; v < visitsToday; v++) {
          const patientObj  = patientIds[globalVisitCounter % patientIds.length]
          const visitType   = VISIT_TYPES[globalVisitCounter % VISIT_TYPES.length]
          const visitCfg    = VISIT_CONFIG[visitType]
          const time        = TIME_SLOTS[v % TIME_SLOTS.length]
          const eligStatus  = 'active'
          const copay       = patientObj.payer_code === 'MEDICARE' ? 20 : 30
          const deductRem   = 400 + (globalVisitCounter % 800)

          // Insert appointment
          const apptRes = await client.query(
            `INSERT INTO appointments
               (provider_id, patient_id, date, visit_type, scheduled_time,
                eligibility_status, eligibility_summary, copay, deductible_remaining)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [providerId, patientObj.id, day, visitType, time,
             eligStatus, `Coverage active — ${patientObj.payer_name} — copay $${copay}`,
             copay, deductRem]
          )
          const apptId = apptRes.rows[0].id
          totalAppts++

          // Claim status
          const status = getClaimStatus(mIdx, globalVisitCounter)
          const billed  = visitCfg.amount
          let paid = 0, patResp = 0, contractAdj = 0, paidAt = null

          if (status === 'paid') {
            contractAdj = Math.round(billed * 0.15 * 100) / 100
            patResp     = patientObj.payer_code === 'MEDICARE' ? 20 : 30
            paid        = Math.round((billed - contractAdj - patResp) * 100) / 100
            paidAt      = dateStr(addDays(new Date(day), 21 + (globalVisitCounter % 14)))
          }

          const claimNumber = `CLM-${String(globalVisitCounter + 1).padStart(5, '0')}-${patientObj.payer_code.slice(0, 3)}`

          const claimRes = await client.query(
            `INSERT INTO claims
               (provider_id, patient_id, appointment_id, claim_number, status,
                billed_amount, paid_amount, patient_responsibility, contractual_adjustment,
                payer_code, payer_name, date_of_service, submitted_at, paid_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                     NOW() - INTERVAL '20 days', $13)
             RETURNING id`,
            [providerId, patientObj.id, apptId, claimNumber, status,
             billed, paid, patResp, contractAdj,
             patientObj.payer_code, patientObj.payer_name, day,
             paidAt || null]
          )
          const claimId = claimRes.rows[0].id
          totalClaims++

          // Claim line
          const lineRes = await client.query(
            `INSERT INTO claim_lines (claim_id, procedure_code, billed_amount, paid_amount, units)
             VALUES ($1,$2,$3,$4,1) RETURNING id`,
            [claimId, visitCfg.cpt, billed, paid]
          )
          const lineId = lineRes.rows[0].id

          // Adjustments
          if (status === 'denied' || status === 'needs_action') {
            const dCode = getDenialCode(globalVisitCounter)
            const info  = getDenialInfo(dCode)
            await client.query(
              `INSERT INTO adjustments (claim_line_id,code,amount,group_code,plain_english,fix_instruction,appealable)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [lineId, dCode, billed, dCode.split('-')[0], info.plain, info.fix, info.appealable]
            )
            totalAdjustments++
          } else if (status === 'paid') {
            if (contractAdj > 0) {
              const co45 = getDenialInfo('CO-45')
              await client.query(
                `INSERT INTO adjustments (claim_line_id,code,amount,group_code,plain_english,fix_instruction,appealable)
                 VALUES ($1,'CO-45',$2,'CO',$3,$4,false)`,
                [lineId, contractAdj, co45.plain, co45.fix]
              )
              totalAdjustments++
            }
            if (patResp > 0) {
              const pr3 = getDenialInfo('PR-3')
              await client.query(
                `INSERT INTO adjustments (claim_line_id,code,amount,group_code,plain_english,fix_instruction,appealable)
                 VALUES ($1,'PR-3',$2,'PR',$3,$4,false)`,
                [lineId, patResp, pr3.plain, pr3.fix]
              )
              totalAdjustments++
            }
          }

          monthEraGroup.push({ claimId, payer_code: patientObj.payer_code, payer_name: patientObj.payer_name, paid, day })
          globalVisitCounter++
        }
      }

      eraGroups.push({ monthLabel: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), claims: monthEraGroup, payer_name: monthEraGroup[0]?.payer_name || 'Aetna', payer_code: monthEraGroup[0]?.payer_code || 'AETNA', start, end })
      console.log(`[SEED] Month ${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}: ${scaledVisits} target → ${monthEraGroup.length} visits`)
    }

    console.log(`[SEED] ${totalAppts} appointments, ${totalClaims} claims, ${totalAdjustments} adjustments`)

    // ── ERA Files (2 per historical month) ───────────────────────────────────
    const PAYER_CYCLE = [
      { name: 'Aetna',                 code: 'AETNA'    },
      { name: 'Medicare',               code: 'MEDICARE' },
      { name: 'Blue Cross Blue Shield', code: 'BCBS'     },
      { name: 'UnitedHealthcare',       code: 'UHC'      },
    ]

    let eraCount = 0
    for (let i = 0; i < eraGroups.length; i++) {
      const group   = eraGroups[i]
      const payer1  = PAYER_CYCLE[i % PAYER_CYCLE.length]
      const payer2  = PAYER_CYCLE[(i + 1) % PAYER_CYCLE.length]
      const half    = Math.ceil(group.claims.length / 2)
      const g1      = group.claims.slice(0, half)
      const g2      = group.claims.slice(half)
      const paid1   = g1.reduce((s, c) => s + (c.paid || 0), 0)
      const paid2   = g2.reduce((s, c) => s + (c.paid || 0), 0)
      const ckDate1 = dateStr(addDays(group.end, 14))
      const ckDate2 = dateStr(addDays(group.end, 28))

      await client.query(
        `INSERT INTO era_files (provider_id,payer_name,payer_id,check_number,check_date,total_paid,claims_count,processed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [providerId, payer1.name, payer1.code, `CHK-${80000 + eraCount * 317}`, ckDate1, Math.round(paid1 * 100) / 100, g1.length, addDays(TODAY, -(eraGroups.length - i) * 35)]
      )
      await client.query(
        `INSERT INTO era_files (provider_id,payer_name,payer_id,check_number,check_date,total_paid,claims_count,processed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [providerId, payer2.name, payer2.code, `CHK-${80100 + eraCount * 317}`, ckDate2, Math.round(paid2 * 100) / 100, g2.length, addDays(TODAY, -((eraGroups.length - i) * 35 - 14))]
      )
      eraCount += 2
    }
    console.log(`[SEED] ${eraCount} ERA files`)

    // ── Action Items ──────────────────────────────────────────────────────────
    const actionItems = [
      { type: 'credential_expiry',   priority: 1, title: 'CRITICAL: CAQH ProView Attestation expires tomorrow',     description: 'CAQH ProView attestation expires in 1 day. Payers pull your data from CAQH — lapsed attestation can suspend claims.', ai_instruction: 'Log in to proview.caqh.org immediately, complete the attestation, and confirm submission.', source_agent: 'credentialing_agent', source_id: 'cred-caqh', resolved: false },
      { type: 'credential_expiry',   priority: 1, title: 'CRITICAL: DEA Registration expires in 18 days',           description: 'DEA Registration BP1234567 expires in 18 days. You cannot prescribe controlled substances with a lapsed DEA.', ai_instruction: 'Begin DEA renewal online at deadiversion.usdoj.gov. Allow 4-6 weeks for processing.', source_agent: 'credentialing_agent', source_id: 'cred-dea', resolved: false },
      { type: 'denied_claim',        priority: 2, title: 'Denied: CLM-00004-MED — CO-50 Medical Necessity',         description: 'Medicare denied $320.00 for CLM-00004. Service deemed not medically necessary.', ai_instruction: 'Appeal with clinical notes supporting medical necessity. Reference Medicare LCD for the CPT billed.', source_agent: 'era_agent', source_id: 'CLM-00004-MED', resolved: false },
      { type: 'denied_claim',        priority: 2, title: 'Denied: CLM-00007-AET — CO-4 Modifier Mismatch',          description: 'Aetna denied $220.00. Modifier used does not apply to this procedure.', ai_instruction: 'Remove modifier and resubmit CLM-00007. Verify modifier policy for this CPT with Aetna.', source_agent: 'era_agent', source_id: 'CLM-00007-AET', resolved: false },
      { type: 'denied_claim',        priority: 2, title: 'Denied: CLM-00011-MED — CO-97 Bundling',                  description: 'Medicare denied $150.00. Procedure bundled into another service on same date.', ai_instruction: 'Review NCCI edits for this code pair. If distinct service, appeal with separate documentation.', source_agent: 'era_agent', source_id: 'CLM-00011-MED', resolved: false },
      { type: 'patient_balance',     priority: 3, title: 'Patient balance $340.00 overdue 45 days',                 description: 'Patient owes $340.00, 45 days past due.', ai_instruction: 'Send patient statement. Follow up by phone. Offer payment plan if balance exceeds $200.', source_agent: 'practice_ops', source_id: null, resolved: false },
      { type: 'prior_auth_pending',  priority: 4, title: 'Prior auth pending: 27447 Total Knee Arthroplasty — Aetna',description: 'Auth AUTH-20260501-KJ8 submitted 12 days ago. Aetna target: 14 days.', ai_instruction: 'Call Aetna auth line. Reference auth tracking number AUTH-20260501-KJ8.', source_agent: 'prior_auth_agent', source_id: 'AUTH-20260501-KJ8', resolved: false },
      { type: 'referral_no_response',priority: 4, title: 'Referral REF-2026-0042 — no response from Dr. Sarah Chen', description: 'Cardiology referral sent 18 days ago. No specialist response. Patient has not scheduled.', ai_instruction: "Call Dr. Chen's office to confirm receipt. Ask patient if they received referral paperwork.", source_agent: 'referral_agent', source_id: 'REF-2026-0042', resolved: false },
      { type: 'eligibility_issue',   priority: 4, title: 'Eligibility not verified — James Chen',                   description: 'Member ID NOTFOUND returned "not found". Appointment today.', ai_instruction: 'Call patient to confirm correct member ID before appointment. Update insurance record.', source_agent: 'eligibility_agent', source_id: 'APT-002', resolved: false },
      { type: 'credential_expiry',   priority: 5, title: 'WARNING: NY Medical License expires in 48 days',          description: 'NY medical license MA98765 expires in 48 days.', ai_instruction: 'Log in to op.nysed.gov and complete online renewal. CME documentation required.', source_agent: 'credentialing_agent', source_id: 'cred-license', resolved: false },
    ]

    for (const ai of actionItems) {
      await client.query(
        `INSERT INTO action_items (provider_id,type,priority,title,description,ai_instruction,source_agent,source_id,resolved,resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $10 THEN NOW() - INTERVAL '3 days' ELSE NULL END)`,
        [providerId, ai.type, ai.priority, ai.title, ai.description, ai.ai_instruction,
         ai.source_agent, ai.source_id, ai.resolved, ai.resolved]
      )
    }
    console.log(`[SEED] ${actionItems.length} action items`)

    await client.query('COMMIT')
    console.log('\n[SEED] ✓ Done — 6 months of data seeded successfully')
    console.log(`[SEED] Today's schedule: ${TODAY_SCHEDULE.length} appointments on ${TODAY_STR}`)

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[SEED] ROLLBACK:', err.message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

seed().catch(err => { console.error('[SEED] Fatal:', err.message); process.exit(1) })
