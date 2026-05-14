require('dotenv').config()

// ─── Agents ───────────────────────────────────────────────────────────────────
const { runEligibilityAgentForDate } = require('./src/agents/eligibilityAgent')
const { runERAAgent } = require('./src/agents/eraAgent')
const { runClaimScrubAgent, getMockClaim } = require('./src/agents/claimScrubAgent')
const { runPriorAuthAgent, getMockEncounter } = require('./src/agents/priorAuthAgent')
const { runReferralAgent, getMockEncounterNote } = require('./src/agents/referralAgent')
const { runPracticeOpsAgent } = require('./src/agents/practiceOpsAgent')

// ─── Libraries ────────────────────────────────────────────────────────────────
const { readERA835, getMockEDI835 } = require('./src/lib/ediReader')

// ─── Today's appointment schedule ─────────────────────────────────────────────
const testAppointments = [
  {
    id: 'APT-001',
    patientId: 'patient-maria-santos',
    patientName: 'Maria Santos',
    patientPhone: '+12125550001',
    date: '2026-05-14',
    visitType: 'Annual Wellness',
    insurance: { memberId: 'AET-992847', dateOfBirth: '1978-04-12', payerCode: 'AETNA' }
  },
  {
    id: 'APT-002',
    patientId: 'patient-james-chen',
    patientName: 'James Chen',
    patientPhone: '+12125550002',
    date: '2026-05-14',
    visitType: 'Follow-up HTN',
    insurance: { memberId: 'NOTFOUND', dateOfBirth: '1965-08-22', payerCode: 'UNITED' }
  },
  {
    id: 'APT-003',
    patientId: 'patient-david-park',
    patientName: 'David Park',
    patientPhone: '+12125550003',
    date: '2026-05-14',
    visitType: 'New Patient',
    insurance: { memberId: 'INACTIVE', dateOfBirth: '1990-01-15', payerCode: 'BCBS' }
  }
]

// ─── Signed clinical notes (provider finishes charting, triggers billing workflow) ──
// Each entry represents one signed encounter note.
// In production these come from the EHR when the provider hits "Sign & Lock".
const signedNotes = [
  {
    label: 'Maria Santos — Annual Wellness (99214 Aetna)',
    // Claim scrub: 99214 + moderate complexity + Aetna = clean, auto-submits
    claim: getMockClaim('clean'),
    encounter: null,
    // Note contains referral to cardiology — Agent 6 detects and sends it
    note: getMockEncounterNote('cardiology_referral')
  },
  {
    label: 'New patient — knee pain w/ procedure ordered',
    // Claim scrub: 99215 billed but only low complexity documented — Agent 4 catches it
    claim: getMockClaim('em_mismatch'),
    // Total knee arthroplasty ordered — Aetna requires prior auth — Agent 5 submits request
    encounter: getMockEncounter('auth_required'),
    note: null
  }
]

// Active payer enrollments for this provider — used by claim scrub credentialing check
const CREDENTIALED_PAYERS = ['MEDICARE', 'AETNA', 'BCBS']

function section(title) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

function divider(label) {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 54 - label.length))}`)
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║         HEALTHPLATFORM — FULL SYSTEM RUN                ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('Simulating one complete practice day — all 7 agents in sequence.\n')

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 1 — ERA PROCESSING (overnight batch)
  // Payer sends 835 files after close of business. Agent 2 processes them
  // immediately on receipt so results are ready for the morning briefing.
  // ───────────────────────────────────────────────────────────────────────────
  section('PHASE 1 — ERA PROCESSING  (Agent 2 — overnight)')

  let aetnaERA
  let medicareERA

  try {
    console.log('Parsing Aetna 835 EDI...')
    aetnaERA = readERA835(getMockEDI835('aetna_mixed'), { payerName: 'Aetna', payerId: 'AETNA' })
    console.log(`Aetna ERA parsed — ${aetnaERA.claims.length} claims found`)
  } catch (err) {
    console.error('Aetna EDI parse error:', err.message)
  }

  try {
    console.log('Parsing Medicare 835 EDI...')
    medicareERA = readERA835(getMockEDI835('medicare_clean'), { payerName: 'Medicare', payerId: 'MEDICARE' })
    console.log(`Medicare ERA parsed — ${medicareERA.claims.length} claims found`)
  } catch (err) {
    console.error('Medicare EDI parse error:', err.message)
  }

  const eras = [aetnaERA, medicareERA].filter(Boolean)
  if (eras.length === 0) {
    console.error('No ERAs parsed successfully — aborting')
    return
  }

  const eraResult = await runERAAgent(eras)

  divider('ERA Summary')
  console.log(`ERAs processed : ${eraResult.erasProcessed}`)
  console.log(`Claims         : ${eraResult.claimsProcessed}`)
  console.log(`Total paid     : $${eraResult.totalPaid.toFixed(2)}`)
  console.log(`Action items   : ${eraResult.actionItems.length}`)
  console.log(`Patterns       : ${eraResult.patterns.length}`)
  console.log(`AI summary     : ${eraResult.summary}`)

  if (eraResult.actionItems.length > 0) {
    divider('Denied Claims Needing Action')
    for (const item of eraResult.actionItems) {
      console.log(`  Claim ${item.claimId} | ${item.code} | $${item.amount} | ${item.priority}`)
      console.log(`  Issue       : ${item.plain}`)
      console.log(`  Instruction : ${item.aiInstruction}`)
    }
  }

  if (eraResult.patterns.length > 0) {
    divider('Payer Patterns Detected')
    for (const pattern of eraResult.patterns) {
      console.log(`  ⚠  ${pattern.message}`)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 2 — MORNING BRIEFING (Agent 7, which internally runs Agent 3)
  // Runs at 7am via cron. ERA results from Phase 1 feed directly in so the
  // provider's dashboard reflects last night's payments and denials immediately.
  // Agent 3 (credentialing) is called inside Agent 7 — no separate invocation needed.
  // ───────────────────────────────────────────────────────────────────────────
  section('PHASE 2 — MORNING BRIEFING  (Agent 7 + Agent 3)')
  console.log('ERA results from Phase 1 feed directly into the morning briefing.\n')

  const briefing = await runPracticeOpsAgent({
    providerId: 'PROV-001',
    providerPhone: process.env.PROVIDER_PHONE || null,
    eraResults: eraResult  // live handoff from Agent 2 → Agent 7
  })

  divider('Dashboard Summary')
  console.log(`Action items   : ${briefing.totalActionItems} total (${briefing.criticalCount} critical, ${briefing.highCount} high)`)
  console.log(`Revenue at risk: $${briefing.metrics.totalRevenueAtRisk.toFixed(2)}`)
  console.log(`\nAI Narrative   : ${briefing.dailySummary}`)

  divider('Top 3 Action Items (sent to provider via SMS)')
  briefing.topActionItems.forEach((item, i) => {
    console.log(`  ${i + 1}. [${item.urgency.toUpperCase()}] ${item.title}`)
    console.log(`     ${item.description}`)
  })

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 3 — APPOINTMENT ELIGIBILITY (Agent 1)
  // Fires for each booked appointment as soon as it is scheduled (or 24h before).
  // Verifies coverage, generates AI summary for the provider, SMS to patient.
  // ───────────────────────────────────────────────────────────────────────────
  section('PHASE 3 — APPOINTMENT ELIGIBILITY  (Agent 1)')

  const today = new Date().toISOString().split('T')[0]
  const eligibilityResults = await runEligibilityAgentForDate(1, today)
  for (const result of eligibilityResults) {
    divider(`Appointment ${result.appointmentId}`)
    console.log(`  Status  : ${result.status}`)
    console.log(`  Summary : ${result.summary}`)
    console.log(`  SMS sent: ${result.notified}`)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 4 — CLINICAL NOTE WORKFLOW (Agents 4 / 5 / 6)
  // Provider sees patients throughout the day. When they sign a note the EHR
  // fires three agents in parallel:
  //   Agent 4 — scrubs the claim before it leaves the building
  //   Agent 5 — checks if the ordered procedure requires prior auth
  //   Agent 6 — detects referral language and sends the referral packet
  // ───────────────────────────────────────────────────────────────────────────
  section('PHASE 4 — CLINICAL NOTE WORKFLOW  (Agents 4 / 5 / 6)')

  for (const signedNote of signedNotes) {
    console.log(`\n▸ Provider signs note: ${signedNote.label}`)

    // Agent 4 — Claim Scrubbing
    if (signedNote.claim) {
      const scrub = await runClaimScrubAgent(signedNote.claim, CREDENTIALED_PAYERS)
      if (scrub.passed) {
        console.log(`  [CLAIM SCRUB] ✓ PASSED — claim auto-submitted to clearinghouse`)
      } else {
        console.log(`  [CLAIM SCRUB] ✗ FAILED — ${scrub.errorCount} error(s), held for correction`)
        for (const err of scrub.errors) {
          console.log(`    • ${err.message}`)
        }
      }
    }

    // Agent 5 — Prior Authorization
    if (signedNote.encounter) {
      const auth = await runPriorAuthAgent(signedNote.encounter, 1)
      for (const r of auth.results) {
        if (r.authRequired) {
          console.log(`  [PRIOR AUTH]  Auth required for ${r.procedureCode} — submitted to ${signedNote.encounter.payerCode}`)
          console.log(`                Auth ID: ${r.authId} | Status: ${r.status}`)
          console.log(`                Follow-up: ${new Date(r.followUpDate).toLocaleDateString()}`)
        } else {
          console.log(`  [PRIOR AUTH]  No auth required for ${r.procedureCode}`)
        }
      }
    }

    // Agent 6 — Referral Management
    if (signedNote.note) {
      const referral = await runReferralAgent(signedNote.note, 1)
      if (referral.referralDetected) {
        console.log(`  [REFERRAL]    ${referral.specialtyNeeded} referral detected (${referral.urgency})`)
        for (const r of referral.referrals) {
          console.log(`                Sent to ${r.specialistName} via ${r.sentMethod}`)
          console.log(`                ID: ${r.referralId} | Response deadline: ${new Date(r.responseDeadline).toLocaleDateString()}`)
        }
      } else {
        console.log(`  [REFERRAL]    No referral detected in note`)
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DONE
  // ───────────────────────────────────────────────────────────────────────────
  section('SYSTEM RUN COMPLETE')
  console.log(`All 7 agents executed in sequence.`)
  console.log(`Tomorrow at 7am Agent 7 will run again — it will automatically`)
  console.log(`pick up today's new prior auths and open referrals alongside`)
  console.log(`whatever ERA files arrive overnight.\n`)
}

main().catch(console.error)
