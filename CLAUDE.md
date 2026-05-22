# Clearpath — AI-Native Healthcare Practice Platform

## Product
- HIPAA-compliant SaaS for independent primary care providers — "business in a box"
- Covers: claims, eligibility, ERA/denials, credentialing, scheduling, patient mgmt, financial reporting
- Differentiator: AI-native from day one; competitors retrofit AI onto legacy infra
- Agent-driven workflows — humans only touch what requires judgment

## Tech Stack
- Runtime: Node.js / CommonJS (require/module.exports — no ES modules)
- API: Express
- Frontend: React + Next.js (not yet built)
- Database: PostgreSQL + pgcrypto (not yet built)
- AI: GPT-4o via Azure OpenAI (BAA) for PHI; standard OpenAI API for non-PHI
- Transcription: Deepgram (BAA)
- Clearinghouse: Office Ally (early) → Waystar (scale)
- Eligibility: Availity API
- Messaging: Twilio (BAA)
- Payments: Stripe (BAA)
- Storage: AWS S3 (HIPAA BAA)
- EHR integration: Particle Health or Health Gorilla (FHIR R4)
- EDI parsing: node-x12

## Architecture Rules — Non-Negotiable
- No PHI in any AI prompt ever — no patient names, no DOB; use pseudonymization tokens
- Every external API call checks sandbox env flag (AVAILITY_SANDBOX, TWILIO_SANDBOX); falls back to mock
- require('dotenv').config() at top of every file that uses env vars
- Agents fire on events (appointment booked, ERA received, daily cron) — not request-response
- Every agent step logged with [AGENT NAME] prefix
- try/catch on every external call; never crash silently
- Every mock simulates happy path + error cases
- Async/await throughout — no callbacks or raw promises
- Comments explain WHY not WHAT

## Environment Variables
See .env file — never commit secrets

## Built — Agents

**Agent 1 — Eligibility Verification** `src/agents/eligibilityAgent.js`
- Triggers on appointment booked
- Pseudonymizes patient ID → calls Availity API (mocked) with member ID + date
- Parses 271 response (active/inactive/not_found) → GPT-4o plain English summary (no PHI)
- Fires Twilio SMS per scenario; returns structured result for dashboard

**Agent 2 — ERA Parsing + Denial Detection** `src/agents/eraAgent.js`
- Accepts raw X12 835 EDI; two-layer parse: strict first, lenient fallback with warning flag
- Parses CLP loops, SVC lines, CAS segments; claim-level and service-line adjustments
- Promotes claim-level adjustments to first service line; patient names skipped (member ID token only)
- Translates CARC codes via denialCodes.js → GPT-4o actionable fix per denial
- Detects payer denial rate spikes across ERAs; auto-posts clean claims; flags denials as action items

## Built — Libraries
- `src/lib/pseudonymize.js` — token mapping; patient IDs never sent to AI
- `src/lib/availity.js` — eligibility API wrapper, mock mode
- `src/lib/notify.js` — Twilio SMS wrapper, mock mode
- `src/lib/denialCodes.js` — CARC/RARC dictionary with plain English + fix instructions
- `src/lib/eraParser.js` — claim parsing logic, pattern detection
- `src/lib/ediReader.js` — X12 EDI parser (node-x12), strict/lenient two-layer
- `src/lib/payerPolicyScraper.js` — exports `runPayerPolicyScraper()`, `getPayerPolicy(payerCode, cptCode)`

## To Build — Agents
- Agent 3 — Credentialing Tracker: `src/agents/credentialingAgent.js`
- Agent 4 — Claim Scrubbing: `src/agents/claimScrubAgent.js`
- Agent 5 — Prior Authorization: `src/agents/priorAuthAgent.js`
- Agent 6 — Referral Management: `src/agents/referralAgent.js`
- Agent 7 — Practice Operations (Master): `src/agents/practiceOpsAgent.js`

## To Build — Database (PostgreSQL)
Tables (all with provider_id isolation, pgcrypto PHI encryption, audit triggers):
`providers`, `patients`, `appointments`, `claims`, `claim_lines`, `adjustments`, `credentials`, `payer_enrollments`, `action_items`, `era_files`

## Payer Intelligence Layer
**Table:** `payer_policies` — payer × E&M CPT coverage criteria
- Payers: Medicare, Aetna, UnitedHealthcare, BCBS, Cigna
- CPT codes: 99202-99215, 99381-99396
- Fields: `payer_code`, `cpt_code` (unique key), `coverage_criteria`, `documentation_required`, `common_denial_reasons`, `appeal_strategy`, `source` (cms_direct|gpt4o_structured), `last_scraped_at`

**Agent integrations:**
- `claimScrubAgent.js` — queries payer_policies before GPT-4o validation; injects coverage_criteria + documentation_required
- `eraAgent.js` — in `enrichActionItem`, injects appeal_strategy + documentation_required for denied claims
- Future encounter UI: `GET /api/payer-policies/:payerCode/:cptCode` (not yet built)

**Refresh:**
- Manual: `POST /api/admin/refresh-payer-policies` (X-Webhook-Secret required)
- Automated: commented-out cron in server.js — enable at launch (1st of month, 8am UTC)
- Source priority: cms_direct > gpt4o_structured > no-source (treat as unverified, refresh first)
- Run scraper standalone: `node src/lib/payerPolicyScraper.js`

## Pending Non-Code Tasks
- Apply for Office Ally developer/sandbox account (officeally.com partner program)
- Apply for Waystar developer program (waystar.com/partners)
- Get sample 835 files from both for real EDI testing
- Healthcare attorney — HIPAA compliance review
- BAA with Azure OpenAI (PHI-touching AI calls)
- BAA with Deepgram (ambient transcription)
- CAQH ProView API access for credentialing integration

## Clearpath-Specific Rules
- Never modify server.js without being explicitly asked
- Never touch .env or any credentials
- Each agent is independent — no cross-importing between agents
- All DB changes require a verification query after running
- If a change might affect another agent, stop and ask first
- Run tests with: node src/api/test.js
- CommonJS only — require/module.exports, no ES modules ever

---

## Behavioral Guidelines (Karpathy)

Bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
