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

// ─── Date helpers ─────────────────────────────────────────────────────────────

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

function dateStr(date) {
  return date.toISOString().split('T')[0]
}

function addDays(base, days) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

// ─── Seed data definitions ────────────────────────────────────────────────────

const PROVIDER = {
  name: 'Dr. Anjali Patel', npi: '1234567890', tax_id: '123456789',
  specialty: 'Primary Care', phone: '212-555-0100',
  email: 'apatel@clearpathhealth.com', state: 'NY'
}

// Credentials — expiry dates relative to today as specified
const CREDENTIALS = [
  {
    credential_type: 'caqh', identifier: '12345678',
    issuing_body: 'CAQH', state: null,
    expiry_date: dateStr(addDays(TODAY, 1)),
    status: 'active',
    renewal_url: 'https://proview.caqh.org',
    notes: 'Quarterly attestation required — overdue'
  },
  {
    credential_type: 'dea', identifier: 'BP1234567',
    issuing_body: 'DEA', state: null,
    expiry_date: dateStr(addDays(TODAY, 18)),
    status: 'active',
    renewal_url: 'https://www.deadiversion.usdoj.gov/drugreg/reg_apps/online_forms.htm',
    notes: 'Renewal takes 4-6 weeks — start immediately'
  },
  {
    credential_type: 'state_license', identifier: 'MA98765',
    issuing_body: 'NY Office of the Professions', state: 'NY',
    expiry_date: dateStr(addDays(TODAY, 48)),
    status: 'active',
    renewal_url: 'https://www.op.nysed.gov/professions/physicians',
    notes: null
  },
  {
    credential_type: 'malpractice', identifier: 'POL-2024-44321',
    issuing_body: 'ProAssurance', state: null,
    expiry_date: dateStr(addDays(TODAY, 79)),
    status: 'active',
    renewal_url: null,
    notes: 'Contact broker for renewal quote'
  },
  {
    credential_type: 'board_cert', identifier: 'ABIM-2020-78901',
    issuing_body: 'ABIM', state: null,
    expiry_date: dateStr(addDays(TODAY, 88)),
    status: 'active',
    renewal_url: 'https://www.abim.org/maintain-certification/',
    notes: 'MOC points required before renewal'
  },
  {
    credential_type: 'npi', identifier: '1234567890',
    issuing_body: 'CMS NPPES', state: null,
    expiry_date: null,
    status: 'active',
    renewal_url: 'https://nppes.cms.hhs.gov',
    notes: 'No expiry — update address if practice moves'
  }
]

const PAYER_ENROLLMENTS = [
  { payer_code: 'AETNA',    payer_name: 'Aetna',                  status: 'active',  effective_date: '2022-03-01' },
  { payer_code: 'MEDICARE', payer_name: 'Medicare',                status: 'active',  effective_date: '2021-09-15' },
  { payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield',  status: 'active',  effective_date: '2021-11-01' },
  { payer_code: 'UHC',      payer_name: 'UnitedHealthcare',        status: 'pending', effective_date: null, notes: 'Application submitted 2026-01-15' },
  { payer_code: 'MEDICAID', payer_name: 'Medicaid',                status: 'pending', effective_date: null, notes: 'Application submitted 2026-03-01' }
]

// 20 patients — realistic demographics, mix of payers
const PATIENTS_RAW = [
  { first: 'Maria',       last: 'Santos',    dob: '1978-04-12', payer_code: 'AETNA',    payer_name: 'Aetna',               member_id: 'AET-992847',   phone: '+12125550001' },
  { first: 'James',       last: 'Chen',      dob: '1965-08-22', payer_code: 'UHC',      payer_name: 'UnitedHealthcare',    member_id: 'UHC-882341',   phone: '+12125550002' },
  { first: 'David',       last: 'Park',      dob: '1990-01-15', payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield', member_id: 'BCBS-771234', phone: '+12125550003' },
  { first: 'Sarah',       last: 'Johnson',   dob: '1952-03-28', payer_code: 'MEDICARE', payer_name: 'Medicare',            member_id: '1EG4TE5MK72', phone: '+12125550004' },
  { first: 'Robert',      last: 'Williams',  dob: '1968-11-05', payer_code: 'AETNA',    payer_name: 'Aetna',               member_id: 'AET-445678',   phone: '+12125550005' },
  { first: 'Emily',       last: 'Davis',     dob: '1982-07-19', payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield', member_id: 'BCBS-334521', phone: '+12125550006' },
  { first: 'Michael',     last: 'Brown',     dob: '1945-09-14', payer_code: 'MEDICARE', payer_name: 'Medicare',            member_id: '2QV7GH8NP93', phone: '+12125550007' },
  { first: 'Jennifer',    last: 'Garcia',    dob: '1975-12-30', payer_code: 'AETNA',    payer_name: 'Aetna',               member_id: 'AET-556789',   phone: '+12125550008' },
  { first: 'Christopher', last: 'Martinez',  dob: '1988-06-08', payer_code: 'UHC',      payer_name: 'UnitedHealthcare',    member_id: 'UHC-998877',   phone: '+12125550009' },
  { first: 'Amanda',      last: 'Wilson',    dob: '1993-02-14', payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield', member_id: 'BCBS-667788', phone: '+12125550010' },
  { first: 'Daniel',      last: 'Anderson',  dob: '1970-04-22', payer_code: 'AETNA',    payer_name: 'Aetna',               member_id: 'AET-112233',   phone: '+12125550011' },
  { first: 'Ashley',      last: 'Thompson',  dob: '1958-08-17', payer_code: 'MEDICARE', payer_name: 'Medicare',            member_id: '3WX9JK2LM84', phone: '+12125550012' },
  { first: 'Matthew',     last: 'Taylor',    dob: '1985-10-03', payer_code: 'UHC',      payer_name: 'UnitedHealthcare',    member_id: 'UHC-334455',   phone: '+12125550013' },
  { first: 'Lauren',      last: 'Moore',     dob: '1972-01-28', payer_code: 'AETNA',    payer_name: 'Aetna',               member_id: 'AET-778899',   phone: '+12125550014' },
  { first: 'Kevin',       last: 'Jackson',   dob: '1960-05-11', payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield', member_id: 'BCBS-990011', phone: '+12125550015' },
  { first: 'Stephanie',   last: 'White',     dob: '1949-07-02', payer_code: 'MEDICARE', payer_name: 'Medicare',            member_id: '4YZ6NP3QR95', phone: '+12125550016' },
  { first: 'Ryan',        last: 'Harris',    dob: '1995-03-19', payer_code: 'AETNA',    payer_name: 'Aetna',               member_id: 'AET-221133',   phone: '+12125550017' },
  { first: 'Megan',       last: 'Clark',     dob: '1987-09-25', payer_code: 'UHC',      payer_name: 'UnitedHealthcare',    member_id: 'UHC-556677',   phone: '+12125550018' },
  { first: 'Brandon',     last: 'Lewis',     dob: '1973-11-08', payer_code: 'BCBS',     payer_name: 'Blue Cross Blue Shield', member_id: 'BCBS-112244', phone: '+12125550019' },
  { first: 'Nicole',      last: 'Walker',    dob: '1980-04-16', payer_code: 'AETNA',    payer_name: 'Aetna',               member_id: 'AET-889900',   phone: '+12125550020' }
]

const VISIT_TYPES    = ['Annual Wellness', 'Follow-up', 'Sick Visit', 'New Patient', 'Medication Review', 'Telehealth']
const ELIGIBILITY_STATUSES = ['active', 'active', 'active', 'active', 'active', 'active', 'active', 'active', 'inactive', 'not_found']

// CPT → billed amount (Medicare fee schedule approximation)
const CPT_AMOUNTS = {
  '99213': 150, '99214': 220, '99215': 320,
  '99395': 280, '99396': 340
}
const CPT_CODES = Object.keys(CPT_AMOUNTS)

// ICD-10 codes to cycle through
const ICD10_CODES = ['I10', 'E11.9', 'Z00.00', 'J06.9', 'M54.5', 'F32.1', 'E78.5', 'J18.9', 'Z12.31', 'Z79.4']

// Denial codes to use — real codes from denialCodes.js
const DENIAL_CODES = ['CO-4', 'CO-11', 'CO-16', 'CO-45', 'CO-50', 'CO-97', 'CO-197', 'PR-1']

function pick(arr, i) { return arr[i % arr.length] }

function randBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

// ─── Main seed function ────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect()
  console.log('[SEED] Connected to database')

  try {
    await client.query('BEGIN')

    // Truncate all tables in dependency order, reset sequences
    await client.query(`
      TRUNCATE action_items, era_files, adjustments, claim_lines, claims,
               appointments, payer_enrollments, credentials,
               patients, providers
      RESTART IDENTITY CASCADE
    `)
    console.log('[SEED] Tables cleared')

    // ── Provider ──────────────────────────────────────────────────────────────
    const provRes = await client.query(
      `INSERT INTO providers (name, npi, tax_id, specialty, phone, email, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [PROVIDER.name, PROVIDER.npi, PROVIDER.tax_id, PROVIDER.specialty,
       PROVIDER.phone, PROVIDER.email, PROVIDER.state]
    )
    const providerId = provRes.rows[0].id
    console.log(`[SEED] Provider inserted — id ${providerId}: ${PROVIDER.name}`)

    // ── Credentials ───────────────────────────────────────────────────────────
    for (const cred of CREDENTIALS) {
      await client.query(
        `INSERT INTO credentials
           (provider_id, credential_type, identifier, issuing_body, state,
            expiry_date, status, renewal_url, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [providerId, cred.credential_type, cred.identifier, cred.issuing_body,
         cred.state, cred.expiry_date, cred.status, cred.renewal_url, cred.notes]
      )
    }
    console.log(`[SEED] ${CREDENTIALS.length} credentials inserted`)

    // ── Payer enrollments ─────────────────────────────────────────────────────
    for (const pe of PAYER_ENROLLMENTS) {
      await client.query(
        `INSERT INTO payer_enrollments
           (provider_id, payer_code, payer_name, status, effective_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [providerId, pe.payer_code, pe.payer_name, pe.status,
         pe.effective_date || null, pe.notes || null]
      )
    }
    console.log(`[SEED] ${PAYER_ENROLLMENTS.length} payer enrollments inserted`)

    // ── Patients ──────────────────────────────────────────────────────────────
    const patientIds = []
    for (let i = 0; i < PATIENTS_RAW.length; i++) {
      const p = PATIENTS_RAW[i]
      const token = `PT-${Buffer.from(p.first + p.last + p.dob).toString('hex').slice(0, 8).toUpperCase()}`
      const res = await client.query(
        `INSERT INTO patients
           (provider_id, token, first_name_encrypted, last_name_encrypted,
            dob_encrypted, insurance_member_id, payer_code, payer_name, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [providerId, token,
         `ENC:${p.first}`, `ENC:${p.last}`, `ENC:${p.dob}`,
         p.member_id, p.payer_code, p.payer_name, p.phone]
      )
      patientIds.push({ id: res.rows[0].id, ...p, token })
    }
    console.log(`[SEED] ${patientIds.length} patients inserted`)

    // ── Appointments (50 over last 90 days) ───────────────────────────────────
    const appointmentIds = []
    for (let i = 0; i < 50; i++) {
      const daysBack = i < 10 ? randBetween(0, 6)
                     : i < 30 ? randBetween(7, 30)
                     : randBetween(31, 89)
      const apptDate  = dateStr(addDays(TODAY, -daysBack))
      const patient   = patientIds[i % patientIds.length]
      const visitType = pick(VISIT_TYPES, i)
      const eligStat  = pick(ELIGIBILITY_STATUSES, i)
      const copay     = eligStat === 'active' ? (patient.payer_code === 'MEDICARE' ? 20 : 30) : null
      const deductRem = eligStat === 'active' ? randBetween(200, 1200) : null
      const eligSum   = eligStat === 'active'
        ? `Coverage active — ${patient.payer_name} — copay $${copay}`
        : eligStat === 'inactive' ? 'Coverage inactive as of appointment date'
        : 'Member ID not found in payer system'

      const res = await client.query(
        `INSERT INTO appointments
           (provider_id, patient_id, date, visit_type,
            eligibility_status, eligibility_summary, copay, deductible_remaining)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [providerId, patient.id, apptDate, visitType,
         eligStat, eligSum, copay, deductRem]
      )
      appointmentIds.push({ id: res.rows[0].id, patientId: patient.id, payer_code: patient.payer_code, payer_name: patient.payer_name, date: apptDate })
    }
    console.log(`[SEED] ${appointmentIds.length} appointments inserted`)

    // ── Claims (50), claim_lines, adjustments ─────────────────────────────────
    // Distribution: 30 paid, 10 denied, 7 pending, 3 needs_action
    const statuses = [
      ...Array(30).fill('paid'),
      ...Array(10).fill('denied'),
      ...Array(7).fill('pending'),
      ...Array(3).fill('needs_action')
    ]

    let claimsInserted = 0
    let adjustmentsInserted = 0
    const eraClaimGroups = [[], [], [], [], [], [], [], [], [], []] // 10 ERA groups

    for (let i = 0; i < 50; i++) {
      const appt      = appointmentIds[i]
      const cpt       = pick(CPT_CODES, i + 3)
      const billed    = CPT_AMOUNTS[cpt]
      const status    = statuses[i]
      const icd10     = pick(ICD10_CODES, i)
      const dos       = appt.date

      let paid = 0, patResp = 0, contractAdj = 0, paidAt = null

      if (status === 'paid') {
        contractAdj = Math.round(billed * (randBetween(10, 20) / 100) * 100) / 100
        patResp     = appt.payer_code === 'MEDICARE' ? 20 : 30
        paid        = Math.round((billed - contractAdj - patResp) * 100) / 100
        paidAt      = dateStr(addDays(new Date(dos), randBetween(14, 45)))
      } else if (status === 'denied' || status === 'needs_action') {
        paid = 0; patResp = 0; contractAdj = 0
      }

      const claimNumber = `CLM-${String(i + 1).padStart(4, '0')}-${appt.payer_code.slice(0, 3)}`

      const claimRes = await client.query(
        `INSERT INTO claims
           (provider_id, patient_id, appointment_id, claim_number, status,
            billed_amount, paid_amount, patient_responsibility, contractual_adjustment,
            payer_code, payer_name, date_of_service, submitted_at, paid_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                 CASE WHEN $13!='pending' THEN NOW() - INTERVAL '30 days' ELSE NULL END,
                 $14)
         RETURNING id`,
        [providerId, appt.patientId, appt.id, claimNumber, status,
         billed, paid, patResp, contractAdj,
         appt.payer_code, appt.payer_name, dos,
         status, paidAt || null]
      )
      const claimId = claimRes.rows[0].id
      claimsInserted++

      // Claim line
      const lineRes = await client.query(
        `INSERT INTO claim_lines (claim_id, procedure_code, billed_amount, paid_amount, units)
         VALUES ($1,$2,$3,$4,1) RETURNING id`,
        [claimId, cpt, billed, paid]
      )
      const lineId = lineRes.rows[0].id

      // Adjustments for denied/needs_action claims
      if (status === 'denied' || status === 'needs_action') {
        const denialCode = pick(DENIAL_CODES, i)
        const info = getDenialInfo(denialCode)
        const adjAmount = billed
        await client.query(
          `INSERT INTO adjustments
             (claim_line_id, code, amount, group_code, plain_english, fix_instruction, appealable)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [lineId, denialCode, adjAmount,
           denialCode.split('-')[0],
           info.plain, info.fix, info.appealable]
        )
        adjustmentsInserted++
      } else if (status === 'paid') {
        // CO-45 contractual adjustment for paid claims
        if (contractAdj > 0) {
          const co45 = getDenialInfo('CO-45')
          await client.query(
            `INSERT INTO adjustments
               (claim_line_id, code, amount, group_code, plain_english, fix_instruction, appealable)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [lineId, 'CO-45', contractAdj, 'CO', co45.plain, co45.fix, false]
          )
          adjustmentsInserted++
        }
        // PR-3 patient copay
        if (patResp > 0) {
          const pr3 = getDenialInfo('PR-3')
          await client.query(
            `INSERT INTO adjustments
               (claim_line_id, code, amount, group_code, plain_english, fix_instruction, appealable)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [lineId, 'PR-3', patResp, 'PR', pr3.plain, pr3.fix, false]
          )
          adjustmentsInserted++
        }
      }

      // Assign to ERA group (every 5 claims per ERA)
      eraClaimGroups[Math.floor(i / 5)].push({ claimId, payer_code: appt.payer_code, payer_name: appt.payer_name, paid, dos })
    }
    console.log(`[SEED] ${claimsInserted} claims, ${adjustmentsInserted} adjustments inserted`)

    // ── ERA Files (10) ────────────────────────────────────────────────────────
    const payerNames = ['Aetna', 'Medicare', 'Blue Cross Blue Shield', 'Aetna', 'Medicare',
                        'Blue Cross Blue Shield', 'Aetna', 'Medicare', 'Aetna', 'Blue Cross Blue Shield']
    const payerCodes = ['AETNA', 'MEDICARE', 'BCBS', 'AETNA', 'MEDICARE', 'BCBS', 'AETNA', 'MEDICARE', 'AETNA', 'BCBS']

    for (let i = 0; i < 10; i++) {
      const group     = eraClaimGroups[i]
      const totalPaid = group.reduce((s, c) => s + (c.paid || 0), 0)
      const checkDate = dateStr(addDays(TODAY, -(i * 9)))
      await client.query(
        `INSERT INTO era_files
           (provider_id, payer_name, payer_id, check_number, check_date,
            total_paid, claims_count, processed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() - ($8 * INTERVAL '1 day'))`,
        [providerId, payerNames[i], payerCodes[i],
         `CHK-${80000 + i * 317}`, checkDate,
         Math.round(totalPaid * 100) / 100, group.length, i * 9]
      )
    }
    console.log('[SEED] 10 ERA files inserted')

    // ── Action Items (15) ─────────────────────────────────────────────────────
    const actionItems = [
      // Critical credentials (priority 1)
      { type: 'credential_expiry', priority: 1, title: 'CRITICAL: CAQH ProView Attestation expires tomorrow',
        description: 'CAQH ProView attestation expires in 1 day. Payers pull your data from CAQH — lapsed attestation can suspend claims.',
        ai_instruction: 'Log in to proview.caqh.org immediately, complete the attestation, and confirm submission.',
        source_agent: 'credentialing_agent', source_id: 'cred-caqh', resolved: false },
      { type: 'credential_expiry', priority: 1, title: 'CRITICAL: DEA Registration expires in 18 days',
        description: 'DEA Registration BP1234567 expires in 18 days. You cannot prescribe controlled substances with a lapsed DEA.',
        ai_instruction: 'Begin DEA renewal online at deadiversion.usdoj.gov. Allow 4-6 weeks for processing.',
        source_agent: 'credentialing_agent', source_id: 'cred-dea', resolved: false },

      // Denied claims (priority 2)
      { type: 'denied_claim', priority: 2, title: 'Denied: CLM-0004-MED — CO-50 Medical Necessity',
        description: 'Medicare denied $320.00 for CLM-0004. Service deemed not medically necessary.',
        ai_instruction: 'Appeal with clinical notes supporting medical necessity. Reference Medicare LCD for the CPT billed.',
        source_agent: 'era_agent', source_id: 'CLM-0004-MED', resolved: false },
      { type: 'denied_claim', priority: 2, title: 'Denied: CLM-0007-AET — CO-4 Modifier Mismatch',
        description: 'Aetna denied $220.00. Modifier used does not apply to this procedure.',
        ai_instruction: 'Remove modifier and resubmit CLM-0007. Verify modifier policy for this CPT with Aetna.',
        source_agent: 'era_agent', source_id: 'CLM-0007-AET', resolved: false },
      { type: 'denied_claim', priority: 2, title: 'Denied: CLM-0011-MED — CO-97 Bundling',
        description: 'Medicare denied $150.00. Procedure bundled into another service on same date.',
        ai_instruction: 'Review NCCI edits for this code pair. If distinct service, appeal with separate documentation.',
        source_agent: 'era_agent', source_id: 'CLM-0011-MED', resolved: false },

      // Patient balances (priority 3)
      { type: 'patient_balance', priority: 3, title: 'Patient balance $340.00 overdue 45 days',
        description: 'Patient token PT-4D69F2A1 owes $340.00, 45 days past due.',
        ai_instruction: 'Send patient statement. Follow up by phone. Offer payment plan if balance exceeds $200.',
        source_agent: 'practice_ops', source_id: null, resolved: false },
      { type: 'patient_balance', priority: 3, title: 'Patient balance $150.00 overdue 62 days',
        description: 'Patient token PT-8BC23E47 owes $150.00, 62 days past due.',
        ai_instruction: 'Send final notice. Consider collections if no response in 14 days.',
        source_agent: 'practice_ops', source_id: null, resolved: false },

      // Prior auth pending (priority 4)
      { type: 'prior_auth_pending', priority: 4, title: 'Prior auth pending: 27447 Total Knee Arthroplasty — Aetna',
        description: 'Auth AUTH-20260501-KJ8 submitted 12 days ago. Aetna target: 14 days. Follow up today.',
        ai_instruction: 'Call Aetna auth line at 1-800-AETNA-PA. Reference auth tracking number AUTH-20260501-KJ8.',
        source_agent: 'prior_auth_agent', source_id: 'AUTH-20260501-KJ8', resolved: false },
      { type: 'prior_auth_pending', priority: 4, title: 'Prior auth pending: 72148 MRI Lumbar — Medicare',
        description: 'Medicare auth submitted 5 days ago. Expected response 7-10 business days.',
        ai_instruction: 'Check Medicare auth portal for status. If no update by day 10, call Medicare directly.',
        source_agent: 'prior_auth_agent', source_id: 'AUTH-20260508-MR2', resolved: false },

      // Referral no response (priority 4)
      { type: 'referral_no_response', priority: 4, title: 'Referral REF-2026-0042 — no response from Dr. Sarah Chen',
        description: 'Cardiology referral sent 18 days ago. No specialist response. Patient has not scheduled.',
        ai_instruction: 'Call Dr. Chen\'s office to confirm receipt. Ask patient if they received referral paperwork.',
        source_agent: 'referral_agent', source_id: 'REF-2026-0042', resolved: false },

      // Eligibility issue (priority 4)
      { type: 'eligibility_issue', priority: 4, title: 'Eligibility not verified — James Chen (APT-002)',
        description: 'Member ID NOTFOUND returned "not found" for James Chen. Appointment 2026-05-14.',
        ai_instruction: 'Call patient to confirm correct member ID before appointment. Update insurance record.',
        source_agent: 'eligibility_agent', source_id: 'APT-002', resolved: false },

      // Warning credentials (priority 5)
      { type: 'credential_expiry', priority: 5, title: 'WARNING: NY Medical License expires in 48 days',
        description: 'NY medical license MA98765 expires in 48 days. Begin renewal at NY Office of Professions.',
        ai_instruction: 'Log in to op.nysed.gov and complete online renewal. CME documentation required.',
        source_agent: 'credentialing_agent', source_id: 'cred-license', resolved: false },

      // Resolved items
      { type: 'denied_claim', priority: 2, title: 'Denied: CLM-0002-AET — CO-16 Missing Info (RESOLVED)',
        description: 'Aetna denied $220.00 for missing referring provider NPI. Corrected and resubmitted.',
        ai_instruction: 'Add referring provider NPI and resubmit.',
        source_agent: 'era_agent', source_id: 'CLM-0002-AET', resolved: true },
      { type: 'credential_expiry', priority: 1, title: 'Malpractice insurance renewed (RESOLVED)',
        description: 'ProAssurance policy renewed for next term.',
        ai_instruction: 'Upload new certificate of insurance to credentialing portal.',
        source_agent: 'credentialing_agent', source_id: 'cred-malp-prev', resolved: true },
      { type: 'prior_auth_pending', priority: 4, title: 'Auth approved: 70553 MRI Brain — Aetna (RESOLVED)',
        description: 'Aetna approved prior auth for MRI Brain. Auth number: AET-AUTH-9921.',
        ai_instruction: 'Schedule MRI. Include auth number AET-AUTH-9921 on claim.',
        source_agent: 'prior_auth_agent', source_id: 'AUTH-20260415-BR1', resolved: true },
      { type: 'patient_balance', priority: 3, title: 'Patient balance $90.00 collected (RESOLVED)',
        description: 'Patient paid balance in full at checkout.',
        ai_instruction: 'Post payment to patient account.',
        source_agent: 'practice_ops', source_id: null, resolved: true }
    ]

    let actionItemsInserted = 0
    for (const ai of actionItems) {
      await client.query(
        `INSERT INTO action_items
           (provider_id, type, priority, title, description, ai_instruction,
            source_agent, source_id, resolved, resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                 CASE WHEN $10 THEN NOW() - INTERVAL '3 days' ELSE NULL END)`,
        [providerId, ai.type, ai.priority, ai.title, ai.description,
         ai.ai_instruction, ai.source_agent, ai.source_id,
         ai.resolved, ai.resolved]
      )
      actionItemsInserted++
    }
    console.log(`[SEED] ${actionItemsInserted} action items inserted`)

    await client.query('COMMIT')
    console.log('\n[SEED] ✓ All data committed successfully')

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[SEED] ERROR — rolled back:', err.message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

seed().catch(err => {
  console.error('[SEED] Fatal:', err.message)
  process.exit(1)
})
