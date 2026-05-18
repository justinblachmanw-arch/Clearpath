# HealthPlatform — Full Project Brief for Claude Code

## What We Are Building
A HIPAA-compliant, AI-native SaaS platform for independent healthcare providers (starting with primary care) who are starting or running their own practice. The product is a "business in a box" — handling claims processing, eligibility verification, ERA/denial management, credentialing, scheduling, patient management, financial reporting, and AI-driven operational intelligence.

The core architectural advantage: every competitor retrofits AI onto legacy infrastructure. We are building AI-native from day one — agent-driven workflows where events trigger automated logic, and humans only touch what requires judgment.

## What Is Already Built
Two working agents plus supporting libraries:

### Agent 1 — Eligibility Verification (src/agents/eligibilityAgent.js)
- Triggers when appointment is booked
- Pseudonymizes patient ID before any AI call
- Calls Availity API (mocked) with member ID + appointment date
- Parses 271 response — active/inactive/not_found
- Calls OpenAI GPT-4o to generate plain English coverage summary (no PHI in prompt)
- Fires Twilio SMS to patient with appropriate message per scenario
- Returns structured result for dashboard

### Agent 2 — ERA Parsing + Denial Detection (src/agents/eraAgent.js)
- Accepts raw X12 835 EDI files exactly as payers send them
- Two-layer parsing: strict first, lenient fallback with warning flag
- Parses CLP loops, SVC lines, CAS segments across all payer formats
- Handles claim-level and service-line-level adjustments
- Promotes claim-level adjustments to first service line
- Patient names intentionally skipped — only member ID stored as token
- Translates CARC denial codes to plain English via denialCodes.js dictionary
- Calls GPT-4o for specific actionable fix instructions per denial
- Detects patterns across multiple ERAs (payer denial rate spikes)
- Auto-posts clean claims, flags denied claims as action items
- Generates AI dashboard summary

### Supporting Libraries
- src/lib/pseudonymize.js — token mapping, patient IDs never sent to AI
- src/lib/availity.js — eligibility API wrapper with mock mode
- src/lib/notify.js — Twilio SMS wrapper with mock mode
- src/lib/denialCodes.js — CARC/RARC code dictionary with plain English + fix instructions
- src/lib/eraParser.js — claim parsing logic, pattern detection
- src/lib/ediReader.js — raw X12 EDI parser using node-x12, two-layer strict/lenient

## Architecture Principles — Follow These Exactly
1. HIPAA compliance — no PHI sent to AI models without BAA. Patient names/DOB never in AI prompts. Use pseudonymization tokens.
2. Sandbox flags — every external API call checks an env flag (AVAILITY_SANDBOX, TWILIO_SANDBOX) and falls back to mock data. Real credentials plugged in later without code changes.
3. Dotenv first — require('dotenv').config() at top of every file that uses env vars.
4. Event-driven — agents fire on events (appointment booked, ERA received, daily cron). Not request-response.
5. Structured logging — every agent step logged with [AGENT NAME] prefix.
6. Error handling — try/catch on every external call, meaningful error messages, never crash silently.
7. Mock data covers all scenarios — every mock simulates happy path + error cases.
8. No patient names or DOB in any AI prompt — ever.

## Environment Variables (.env)
```
AVAILITY_SANDBOX=true
TWILIO_SANDBOX=true
OPENAI_API_KEY=real_key_here
PROVIDER_NPI=1234567890
PROVIDER_TAX_ID=123456789
AVAILITY_CLIENT_ID=
AVAILITY_CLIENT_SECRET=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

## Agents To Build Next

### Agent 3 — Credentialing Tracker (src/agents/credentialingAgent.js)
Providers cannot bill any payer until credentialed with them. Credentials expire. This agent tracks all provider credentials and surfaces renewal alerts.

Credentials to track:
- DEA registration (federal, expires every 3 years)
- State medical license (expires 1-2 years depending on state)
- Malpractice insurance (annual)
- CAQH ProView profile (quarterly attestation)
- Payer enrollments per payer (Aetna, Medicare, UHC, BCBS etc) with effective dates
- Board certifications (varies by specialty)
- NPI registration (no expiry but needs address updates)

Logic:
- Daily cron check across all credentials
- Alert thresholds: 90 days (blue/info), 60 days (yellow/warning), 30 days (red/critical)
- Generate action items with days remaining, renewal URL where applicable
- Call GPT-4o to write plain English renewal instructions per credential type
- Flag payer enrollments that are pending vs active
- No PHI involved — purely provider credential data

Mock data: Dr. Patel with realistic credential set including some expiring soon

### Agent 4 — Claim Scrubbing Agent (src/agents/claimScrubAgent.js)
Fires when provider signs a clinical note. Validates the claim before submission to catch errors that would become denials.

Checks to run:
- All required fields present (NPI, tax ID, date of service, place of service)
- ICD-10 diagnosis codes valid and support medical necessity for CPT codes
- E&M level (99202-99215) consistent with documented complexity
- Modifier usage valid for procedure code combination
- Provider credentialed with this payer (check against credentialing agent data)
- Duplicate claim check (same patient, same date, same procedure)
- Timely filing window not exceeded (varies by payer, typically 90-365 days)

Output: pass (auto-submit) or fail (action items with specific fixes before submission)
Use GPT-4o to validate code combinations and suggest corrections.

### Agent 5 — Prior Authorization Agent (src/agents/priorAuthAgent.js)
When provider orders a procedure or referral, detect if prior auth is required and manage the workflow.

Logic:
- Maintain a rules table: payer + procedure code = auth required (true/false)
- When encounter includes procedure requiring auth, fire agent
- Pre-populate auth request from encounter data (diagnosis, procedure, clinical justification from note)
- Submit electronically where payer API supports it
- Track auth status: pending/approved/denied
- Alert provider when approved or denied
- 30-day follow-up if no response

### Agent 6 — Referral Management Agent (src/agents/referralAgent.js)
When provider documents a referral in a note, manage the full referral loop.

Logic:
- Detect referral intent in encounter note
- Generate clinical summary for specialist (GPT-4o from note content — uses Azure OpenAI BAA in production)
- Look up specialists by type + patient insurance compatibility
- Send referral via Direct secure messaging or fax
- Track whether patient scheduled appointment
- Alert if no specialist response in 30 days
- Receive and file specialist notes back to patient chart

### Agent 7 — Practice Operations Agent (src/agents/practiceOpsAgent.js)
The master agent. Runs every morning and assembles the full provider dashboard action list.

Aggregates output from all other agents:
- Denied claims needing action (from ERA agent)
- Credentials expiring (from credentialing agent)
- Prior auths pending (from prior auth agent)
- Referrals with no response (from referral agent)
- Patients with incomplete intake (from eligibility agent)
- Outstanding patient balances overdue
- Payer pattern alerts (from ERA agent)

Prioritizes by urgency (revenue at risk > patient care > compliance).
Generates daily AI narrative summary for dashboard header.
Sends provider a morning briefing SMS with top 3 action items.

## Database Plan (Not Yet Built)
Next structural task after agents are complete. Use PostgreSQL.

Tables needed:
- providers (id, name, npi, tax_id, specialty, created_at)
- patients (id, provider_id, token, insurance_member_id, payer_code, created_at)
- appointments (id, provider_id, patient_id, date, visit_type, eligibility_status, eligibility_summary)
- claims (id, provider_id, patient_id, appointment_id, status, billed_amount, paid_amount, submitted_at)
- claim_lines (id, claim_id, procedure_code, billed_amount, paid_amount)
- adjustments (id, claim_line_id, code, amount, plain_english, fix, appealable)
- credentials (id, provider_id, type, identifier, expiry_date, status, renewal_url)
- payer_enrollments (id, provider_id, payer_code, payer_name, status, effective_date, expiry_date)
- action_items (id, provider_id, type, priority, title, description, ai_instruction, resolved, created_at)
- era_files (id, provider_id, payer_name, check_number, check_date, total_paid, parse_warning, raw_edi)

All tables include provider_id for multi-tenant isolation.
All PHI fields encrypted at rest using pgcrypto.
All tables have audit log triggers.

## Frontend Plan (Not Yet Built)
Next after database. React + Next.js.

Screens:
1. Provider dashboard — morning action items, schedule, metrics
2. Schedule view — calendar with eligibility badges
3. Patient record — chart + current encounter
4. Claims manager — AR aging, claim status, denial management
5. ERA detail — parsed payment with line items
6. Credentialing tracker — credential status cards with expiry countdown
7. Financial dashboard — P&L, revenue by payer, expense tracking
8. Prior auth tracker — pending auths with status
9. Referral tracker — open referrals with follow-up status

## Tech Stack
- Runtime: Node.js
- Framework: Express (API) + Next.js (frontend, not yet built)
- Database: PostgreSQL with pgcrypto (not yet built)
- AI: OpenAI GPT-4o via Azure OpenAI (BAA) for PHI, standard OpenAI API for non-PHI
- Transcription: Deepgram (BAA) for ambient documentation
- Clearinghouse: Office Ally (early) → Waystar (scale) — sandbox accounts being applied for
- Eligibility: Availity API
- Messaging: Twilio (BAA)
- Payments: Stripe (BAA)
- Storage: AWS S3 (HIPAA BAA)
- EPIC integration: Particle Health or Health Gorilla (FHIR R4)
- EDI parsing: node-x12

## Payer Intelligence Layer

### payer_policies table (PostgreSQL)
Stores scraped and GPT-4o enriched coverage criteria for each major payer × E&M CPT code.

Payers: Medicare, Aetna, UnitedHealthcare, BCBS, Cigna
CPT codes: 99202-99215, 99381-99396

Fields:
- `payer_code`, `cpt_code` — the lookup key (unique constraint)
- `coverage_criteria` — what the payer requires for medical necessity
- `documentation_required` — specific note elements required
- `common_denial_reasons` — what triggers denial for this code/payer
- `appeal_strategy` — how to fight denials
- `source` — `cms_direct` or `gpt4o_structured` (tells us what to re-verify)
- `last_scraped_at` — when to refresh

### How it connects to existing agents

**claimScrubAgent.js:**
Before the GPT-4o validation step, queries `payer_policies` for `payer_code + cpt_code` on each E&M line. Injects `coverage_criteria` and `documentation_required` into the validation prompt. Surfaces gaps as specific scrub failures with payer-cited fix instructions.

**eraAgent.js:**
In `enrichActionItem`, queries `payer_policies` for the denied claim's payer + CPT. Injects `appeal_strategy` and `documentation_required` into the appeal instruction prompt so the provider knows exactly what to cite.

**Provider encounter UI (future):**
AI assist panel will query `GET /api/payer-policies/:payerCode/:cptCode` to show the provider exactly what their note needs before signing. (Endpoint not yet built — add when connecting encounter page to payer policy layer.)

### Refresh schedule
- Manual: `POST /api/admin/refresh-payer-policies` (X-Webhook-Secret required)
- Automated: Commented-out cron in server.js — enable at launch (1st of each month, 8am UTC)
- Monthly refresh catches payer policy updates

### Source hierarchy
1. Direct scrape from CMS/payer website (preferred, tagged `cms_direct`)
2. GPT-4o structured summary of publicly known payer requirements (tagged `gpt4o_structured`)
3. Records without source → treat as unverified, refresh first

All records tagged with `source` and `last_scraped_at`.

### Scraper
`src/lib/payerPolicyScraper.js` — exports `runPayerPolicyScraper()` and `getPayerPolicy(payerCode, cptCode)`.
Run standalone: `node src/lib/payerPolicyScraper.js`

## Competitors
- Tebra (Kareo + PatientPop merger) — direct competitor, poor UX, bad support
- athenahealth — enterprise focused, too complex for solo providers
- SimplePractice — behavioral health only, weak billing
- Practice Fusion — stagnant product, terrible support
- Our advantage: AI-native architecture, built for day-one independent providers, proactive intelligence vs reactive tools

## Pending Non-Code Tasks
- Apply for Office Ally developer/sandbox account (officeally.com partner program)
- Apply for Waystar developer program (waystar.com/partners)
- Get sample 835 files from both for real EDI testing
- Healthcare attorney for HIPAA compliance review
- BAA with Azure OpenAI for PHI-touching AI calls
- BAA with Deepgram for ambient transcription
- CAQH ProView API access for credentialing integration

## Code Style Rules
- CommonJS modules (require/module.exports) — no ES modules
- Async/await throughout — no callbacks or raw promises
- Descriptive console.log with agent name prefix
- All external calls wrapped in try/catch
- Mock mode controlled by env vars not hardcoded flags
- No patient names or DOB in any AI prompt
- Comments explaining WHY not WHAT
