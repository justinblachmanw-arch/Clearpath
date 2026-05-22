-- HealthPlatform schema
-- Run as: psql -U clearpath -d clearpath_dev -f src/db/schema.sql

-- ─── PROVIDERS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS providers (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(255)  NOT NULL,
  npi          VARCHAR(10)   NOT NULL UNIQUE,
  tax_id       VARCHAR(9)    NOT NULL,
  specialty    VARCHAR(100),
  phone        VARCHAR(20),
  email        VARCHAR(255),
  state        CHAR(2),
  created_at   TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- ─── PATIENTS ─────────────────────────────────────────────────────────────────
-- PHI fields stored as encrypted ciphertext (pgcrypto in production, ENC: prefix in dev)
CREATE TABLE IF NOT EXISTS patients (
  id                    SERIAL PRIMARY KEY,
  provider_id           INTEGER       NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  token                 VARCHAR(50)   NOT NULL UNIQUE,
  first_name_encrypted  TEXT,
  last_name_encrypted   TEXT,
  dob_encrypted         TEXT,
  insurance_member_id   VARCHAR(100),
  payer_code            VARCHAR(50),
  payer_name            VARCHAR(100),
  phone                 VARCHAR(20),
  created_at            TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_provider_id ON patients(provider_id);

-- ─── APPOINTMENTS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id                    SERIAL PRIMARY KEY,
  provider_id           INTEGER       NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  patient_id            INTEGER       NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date                  DATE          NOT NULL,
  visit_type            VARCHAR(100),
  eligibility_status    VARCHAR(50),
  eligibility_summary   TEXT,
  copay                 NUMERIC(10,2),
  deductible_remaining  NUMERIC(10,2),
  created_at            TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_provider_id ON appointments(provider_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id  ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date        ON appointments(date);

-- ─── CLAIMS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS claims (
  id                      SERIAL PRIMARY KEY,
  provider_id             INTEGER       NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  patient_id              INTEGER       NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id          INTEGER       REFERENCES appointments(id),
  claim_number            VARCHAR(100)  UNIQUE,
  status                  VARCHAR(50)   NOT NULL DEFAULT 'pending',
  billed_amount           NUMERIC(10,2) NOT NULL DEFAULT 0,
  paid_amount             NUMERIC(10,2)          DEFAULT 0,
  patient_responsibility  NUMERIC(10,2)          DEFAULT 0,
  contractual_adjustment  NUMERIC(10,2)          DEFAULT 0,
  payer_code              VARCHAR(50),
  payer_name              VARCHAR(100),
  date_of_service         DATE,
  submitted_at            TIMESTAMP,
  paid_at                 TIMESTAMP,
  scrub_result            VARCHAR(20),
  scrub_notes             TEXT,
  scrubbed_at             TIMESTAMP,
  created_at              TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_provider_id ON claims(provider_id);
CREATE INDEX IF NOT EXISTS idx_claims_patient_id  ON claims(patient_id);
CREATE INDEX IF NOT EXISTS idx_claims_status      ON claims(status);

-- ─── CLAIM LINES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS claim_lines (
  id              SERIAL PRIMARY KEY,
  claim_id        INTEGER       NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  procedure_code  VARCHAR(10)   NOT NULL,
  billed_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  paid_amount     NUMERIC(10,2)          DEFAULT 0,
  units           INTEGER                DEFAULT 1,
  created_at      TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_lines_claim_id ON claim_lines(claim_id);

-- ─── ADJUSTMENTS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adjustments (
  id               SERIAL PRIMARY KEY,
  claim_line_id    INTEGER       NOT NULL REFERENCES claim_lines(id) ON DELETE CASCADE,
  code             VARCHAR(20)   NOT NULL,
  amount           NUMERIC(10,2) NOT NULL DEFAULT 0,
  group_code       VARCHAR(10),
  plain_english    TEXT,
  fix_instruction  TEXT,
  appealable       BOOLEAN                DEFAULT FALSE,
  created_at       TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adjustments_claim_line_id ON adjustments(claim_line_id);

-- ─── CREDENTIALS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credentials (
  id               SERIAL PRIMARY KEY,
  provider_id      INTEGER       NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  credential_type  VARCHAR(50)   NOT NULL,
  identifier       VARCHAR(100),
  issuing_body     VARCHAR(100),
  state            CHAR(2),
  expiry_date      DATE,
  status           VARCHAR(50)            DEFAULT 'active',
  renewal_url      TEXT,
  notes            TEXT,
  created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credentials_provider_id  ON credentials(provider_id);
CREATE INDEX IF NOT EXISTS idx_credentials_expiry_date  ON credentials(expiry_date);

-- ─── PAYER ENROLLMENTS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payer_enrollments (
  id             SERIAL PRIMARY KEY,
  provider_id    INTEGER       NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  payer_code     VARCHAR(50)   NOT NULL,
  payer_name     VARCHAR(100)  NOT NULL,
  status         VARCHAR(50)            DEFAULT 'pending',
  effective_date DATE,
  expiry_date    DATE,
  notes          TEXT,
  created_at     TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payer_enrollments_provider_id ON payer_enrollments(provider_id);

-- ─── ACTION ITEMS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS action_items (
  id            SERIAL PRIMARY KEY,
  provider_id   INTEGER       NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  type          VARCHAR(50)   NOT NULL,
  priority      INTEGER       NOT NULL DEFAULT 5,
  title         VARCHAR(500)  NOT NULL,
  description   TEXT,
  ai_instruction TEXT,
  source_agent  VARCHAR(100),
  source_id     VARCHAR(100),
  resolved      BOOLEAN                DEFAULT FALSE,
  resolved_at   TIMESTAMP,
  created_at    TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_items_provider_id ON action_items(provider_id);
CREATE INDEX IF NOT EXISTS idx_action_items_resolved    ON action_items(resolved);

-- ─── ERA FILES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS era_files (
  id            SERIAL PRIMARY KEY,
  provider_id   INTEGER       NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  payer_name    VARCHAR(100),
  payer_id      VARCHAR(50),
  check_number  VARCHAR(100),
  check_date    DATE,
  total_paid    NUMERIC(10,2)          DEFAULT 0,
  claims_count  INTEGER                DEFAULT 0,
  parse_warning TEXT,
  raw_edi       TEXT,
  processed_at  TIMESTAMP,
  created_at    TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_era_files_provider_id ON era_files(provider_id);
