'use strict'

// Standard metadata columns appended to most tables.
// Defined once here — avoids repetition across 10 CREATE TABLE statements.
const META = `
  source_type                VARCHAR(30),
  source_url                 TEXT,
  source_section             TEXT,
  source_date                DATE,
  cms_rule_reference         TEXT,
  source_authority_score     INTEGER,
  recency_score              INTEGER,
  consistency_score          INTEGER,
  confidence_score           INTEGER,
  confidence_level           VARCHAR(20),
  is_stated                  BOOLEAN DEFAULT false,
  is_behavioral              BOOLEAN DEFAULT false,
  stated_behavioral_conflict BOOLEAN DEFAULT false,
  conflict_notes             TEXT,
  applies_when               TEXT,
  exceptions                 TEXT,
  edge_cases                 TEXT,
  trump_era_change           BOOLEAN DEFAULT false,
  last_verified_date         DATE,
  needs_reverification       BOOLEAN DEFAULT false,
  reverification_reason      TEXT,
  created_at                 TIMESTAMP DEFAULT NOW(),
  updated_at                 TIMESTAMP DEFAULT NOW()
`

async function migrateCodingIntelligence(pool) {
  // ── Table 1: cpt_knowledge ────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cpt_knowledge (
      id                             SERIAL PRIMARY KEY,
      cpt_code                       VARCHAR(10) NOT NULL UNIQUE,
      short_description              TEXT,
      full_description               TEXT,
      category                       VARCHAR(50),
      subcategory                    VARCHAR(50),
      em_level                       INTEGER,
      em_complexity                  VARCHAR(20),
      em_min_time_minutes            INTEGER,
      em_mdm_problems                TEXT,
      em_mdm_data                    TEXT,
      em_mdm_risk                    TEXT,
      em_key_components              TEXT,
      required_documentation         TEXT[],
      recommended_documentation      TEXT[],
      documentation_notes            TEXT,
      global_period_days             INTEGER DEFAULT 0,
      requires_prior_auth_medicare   BOOLEAN DEFAULT false,
      requires_prior_auth_commercial BOOLEAN DEFAULT false,
      time_limit_per_day             INTEGER,
      time_limit_per_year            INTEGER,
      frequency_limit_notes          TEXT,
      new_patient_only               BOOLEAN DEFAULT false,
      established_patient_only       BOOLEAN DEFAULT false,
      add_on_to                      TEXT[],
      cannot_bill_same_day           TEXT[],
      common_denial_reasons          TEXT[],
      common_denial_carc_codes       TEXT[],
      common_mistakes                TEXT[],
      things_to_avoid                TEXT[],
      audit_risk_level               VARCHAR(20),
      audit_risk_notes               TEXT,
      modifiers_required             TEXT[],
      modifiers_common               TEXT[],
      modifiers_prohibited           TEXT[],
      modifier_notes                 TEXT,
      telehealth_allowed             BOOLEAN,
      telehealth_modifiers           TEXT[],
      telehealth_pos_codes           TEXT[],
      telehealth_notes               TEXT,
      audio_only_allowed             BOOLEAN,
      audio_only_modifiers           TEXT[],
      is_new_2025                    BOOLEAN DEFAULT false,
      replaces_code                  VARCHAR(10),
      replaced_by_code               VARCHAR(10),
      last_cms_change_date           DATE,
      last_cms_change_description    TEXT,
      change_impact                  VARCHAR(20),
      ${META}
    )
  `)

  // ── Table 2: icd10_knowledge ──────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS icd10_knowledge (
      id                          SERIAL PRIMARY KEY,
      icd10_code                  VARCHAR(10) NOT NULL UNIQUE,
      description                 TEXT,
      category                    VARCHAR(50),
      body_system                 VARCHAR(50),
      specificity_level           VARCHAR(20),
      more_specific_codes         TEXT[],
      specificity_notes           TEXT,
      sequencing_rule             VARCHAR(20),
      sequencing_notes            TEXT,
      requires_additional_code    BOOLEAN DEFAULT false,
      additional_code_notes       TEXT,
      etiology_manifestation      BOOLEAN DEFAULT false,
      generally_covered_medicare  BOOLEAN DEFAULT true,
      coverage_notes              TEXT,
      covered_cpt_codes           TEXT[],
      non_covered_with_cpt        TEXT[],
      common_coding_mistakes      TEXT[],
      unspecified_risk            TEXT,
      is_active                   BOOLEAN DEFAULT true,
      replaced_by                 VARCHAR(10),
      effective_date              DATE,
      icd10_version               VARCHAR(10) DEFAULT 'ICD-10-CM',
      fiscal_year                 VARCHAR(10),
      ${META}
    )
  `)

  // ── Table 3: cpt_icd10_combinations ──────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cpt_icd10_combinations (
      id                       SERIAL PRIMARY KEY,
      cpt_code                 VARCHAR(10) NOT NULL,
      icd10_code               VARCHAR(10) NOT NULL,
      supports_medical_necessity VARCHAR(20),
      necessity_rationale      TEXT,
      approval_likelihood      VARCHAR(20),
      approval_notes           TEXT,
      known_denial_reasons     TEXT[],
      denial_frequency         VARCHAR(20),
      denial_carc_codes        TEXT[],
      defensive_documentation  TEXT[],
      age_range_typical        VARCHAR(50),
      unusual_combination      BOOLEAN DEFAULT false,
      unusual_notes            TEXT,
      payer_variations         JSONB,
      UNIQUE(cpt_code, icd10_code),
      ${META}
    )
  `)

  // ── Table 4: payer_rules ──────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payer_rules (
      id                   SERIAL PRIMARY KEY,
      payer_code           VARCHAR(20) NOT NULL,
      payer_name           VARCHAR(100),
      cpt_code             VARCHAR(10),
      icd10_code           VARCHAR(10),
      rule_type            VARCHAR(30),
      rule_title           TEXT NOT NULL,
      rule_description     TEXT,
      rule_severity        VARCHAR(20),
      likely_denial_code   VARCHAR(10),
      denial_description   TEXT,
      fix_action           TEXT,
      appeal_strategy      TEXT,
      appeal_success_rate  VARCHAR(20),
      payer_language       TEXT,
      is_published         BOOLEAN DEFAULT false,
      is_learned           BOOLEAN DEFAULT false,
      effective_date       DATE,
      change_description   TEXT,
      is_new_change        BOOLEAN DEFAULT false,
      ${META}
    )
  `)

  // ── Table 5: denial_patterns ──────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS denial_patterns (
      id                    SERIAL PRIMARY KEY,
      scenario_title        TEXT,
      scenario_description  TEXT,
      cpt_codes             TEXT[] NOT NULL,
      icd10_codes           TEXT[],
      modifiers             TEXT[],
      payer_code            VARCHAR(20),
      place_of_service      VARCHAR(5),
      appointment_type      VARCHAR(30),
      denial_category       VARCHAR(30),
      carc_code             VARCHAR(10),
      rarc_code             VARCHAR(10),
      denial_reason_plain   TEXT,
      root_cause            TEXT,
      missing_documentation TEXT[],
      missing_codes         TEXT[],
      missing_modifiers     TEXT[],
      fix_description       TEXT,
      prevention_tip        TEXT,
      appealed              BOOLEAN,
      appeal_outcome        VARCHAR(20),
      appeal_strategy_used  TEXT,
      days_to_resolution    INTEGER,
      is_verified           BOOLEAN DEFAULT false,
      verified_by           VARCHAR(50),
      ${META}
    )
  `)

  // ── Table 6: modifier_rules ───────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS modifier_rules (
      id                    SERIAL PRIMARY KEY,
      modifier_code         VARCHAR(5) NOT NULL UNIQUE,
      modifier_name         TEXT,
      description           TEXT,
      use_case              TEXT,
      required_documentation TEXT,
      when_required         TEXT,
      when_optional         TEXT,
      common_cpt_codes      TEXT[],
      prevents_denial_codes TEXT[],
      triggers_review       BOOLEAN DEFAULT false,
      common_mistakes       TEXT,
      overuse_risk          TEXT,
      underuse_risk         TEXT,
      medicare_guidance     TEXT,
      commercial_guidance   TEXT,
      telehealth_specific   BOOLEAN DEFAULT false,
      telehealth_guidance   TEXT,
      ${META}
    )
  `)

  // ── Table 7: ncci_edits ───────────────────────────────────────────────────
  // Lighter metadata — this is structured CMS data, no trust scoring needed
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ncci_edits (
      id                   SERIAL PRIMARY KEY,
      column1_cpt          VARCHAR(10) NOT NULL,
      column2_cpt          VARCHAR(10) NOT NULL,
      modifier_indicator   INTEGER,
      effective_date       DATE,
      deletion_date        DATE,
      is_active            BOOLEAN DEFAULT true,
      plain_english        TEXT,
      common_scenario      TEXT,
      bypass_conditions    TEXT,
      UNIQUE(column1_cpt, column2_cpt, effective_date),
      source_type          VARCHAR(30) DEFAULT 'cms_direct',
      source_url           TEXT,
      source_date          DATE,
      confidence_level     VARCHAR(20) DEFAULT 'verified',
      trump_era_change     BOOLEAN DEFAULT false,
      created_at           TIMESTAMP DEFAULT NOW(),
      updated_at           TIMESTAMP DEFAULT NOW()
    )
  `)

  // ── Table 8: appointment_type_rules ──────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointment_type_rules (
      id                       SERIAL PRIMARY KEY,
      appointment_type         VARCHAR(30) NOT NULL,
      cpt_code                 VARCHAR(10),
      rule_description         TEXT,
      impact_on_coding         TEXT,
      common_errors            TEXT,
      documentation_requirements TEXT,
      required_modifiers       TEXT[],
      forbidden_cpt_codes      TEXT[],
      preferred_cpt_codes      TEXT[],
      ${META}
    )
  `)

  // ── Table 9: place_of_service_rules ──────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS place_of_service_rules (
      id                   SERIAL PRIMARY KEY,
      pos_code             VARCHAR(5) NOT NULL,
      pos_description      TEXT,
      cpt_code             VARCHAR(10),
      rule_description     TEXT,
      reimbursement_impact TEXT,
      common_errors        TEXT,
      required_modifiers   TEXT[],
      forbidden_with_pos   TEXT[],
      telehealth_specific  BOOLEAN DEFAULT false,
      payer_variations     JSONB,
      ${META}
    )
  `)

  // ── Table 10: patient_demographics_rules ─────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patient_demographics_rules (
      id               SERIAL PRIMARY KEY,
      demographic_type VARCHAR(20) NOT NULL,
      age_min          INTEGER,
      age_max          INTEGER,
      sex              VARCHAR(10),
      cpt_code         VARCHAR(10),
      rule_description TEXT,
      rationale        TEXT,
      common_errors    TEXT,
      denial_risk      TEXT,
      carc_code        VARCHAR(10),
      ${META}
    )
  `)

  // ── Table 11: policy_change_log ───────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS policy_change_log (
      id                 SERIAL PRIMARY KEY,
      change_date        DATE NOT NULL,
      payer_code         VARCHAR(20),
      cpt_code           VARCHAR(10),
      change_type        VARCHAR(30),
      change_title       TEXT NOT NULL,
      change_description TEXT,
      impact_level       VARCHAR(20),
      old_rule           TEXT,
      new_rule           TEXT,
      action_required    TEXT,
      effective_date     DATE,
      sunset_date        DATE,
      is_temporary       BOOLEAN DEFAULT false,
      administration     VARCHAR(20),
      cms_reference      TEXT,
      source_url         TEXT,
      verified           BOOLEAN DEFAULT false,
      trump_era_change   BOOLEAN DEFAULT false,
      created_at         TIMESTAMP DEFAULT NOW()
    )
  `)

  // ── Table 12: field_change_history ───────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS field_change_history (
      id                    SERIAL PRIMARY KEY,
      table_name            VARCHAR(50) NOT NULL,
      record_id             INTEGER NOT NULL,
      field_name            VARCHAR(100) NOT NULL,
      old_value             TEXT,
      new_value             TEXT,
      change_date           TIMESTAMP DEFAULT NOW(),
      change_source         VARCHAR(50),
      change_reason         TEXT,
      policy_change_log_id  INTEGER REFERENCES policy_change_log(id)
    )
  `)

  // ── Indexes ───────────────────────────────────────────────────────────────
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_cpt_knowledge_code       ON cpt_knowledge(cpt_code)`,
    `CREATE INDEX IF NOT EXISTS idx_cpt_knowledge_category   ON cpt_knowledge(category)`,
    `CREATE INDEX IF NOT EXISTS idx_cpt_knowledge_telehealth ON cpt_knowledge(telehealth_allowed)`,

    `CREATE INDEX IF NOT EXISTS idx_icd10_code               ON icd10_knowledge(icd10_code)`,
    `CREATE INDEX IF NOT EXISTS idx_icd10_category           ON icd10_knowledge(category)`,
    `CREATE INDEX IF NOT EXISTS idx_icd10_active             ON icd10_knowledge(is_active)`,

    `CREATE INDEX IF NOT EXISTS idx_combinations_cpt_icd10   ON cpt_icd10_combinations(cpt_code, icd10_code)`,
    `CREATE INDEX IF NOT EXISTS idx_combinations_likelihood  ON cpt_icd10_combinations(approval_likelihood)`,

    `CREATE INDEX IF NOT EXISTS idx_payer_rules_payer_cpt    ON payer_rules(payer_code, cpt_code)`,
    `CREATE INDEX IF NOT EXISTS idx_payer_rules_type         ON payer_rules(rule_type)`,
    `CREATE INDEX IF NOT EXISTS idx_payer_rules_severity     ON payer_rules(rule_severity)`,
    `CREATE INDEX IF NOT EXISTS idx_payer_rules_trump        ON payer_rules(trump_era_change)`,

    `CREATE INDEX IF NOT EXISTS idx_denial_patterns_cpt      ON denial_patterns USING GIN(cpt_codes)`,
    `CREATE INDEX IF NOT EXISTS idx_denial_patterns_carc     ON denial_patterns(carc_code)`,
    `CREATE INDEX IF NOT EXISTS idx_denial_patterns_category ON denial_patterns(denial_category)`,
    `CREATE INDEX IF NOT EXISTS idx_denial_patterns_payer    ON denial_patterns(payer_code)`,

    `CREATE INDEX IF NOT EXISTS idx_modifier_code            ON modifier_rules(modifier_code)`,

    `CREATE INDEX IF NOT EXISTS idx_ncci_col1                ON ncci_edits(column1_cpt)`,
    `CREATE INDEX IF NOT EXISTS idx_ncci_col2                ON ncci_edits(column2_cpt)`,
    `CREATE INDEX IF NOT EXISTS idx_ncci_active              ON ncci_edits(is_active)`,

    `CREATE INDEX IF NOT EXISTS idx_apt_type                 ON appointment_type_rules(appointment_type, cpt_code)`,

    `CREATE INDEX IF NOT EXISTS idx_pos_code                 ON place_of_service_rules(pos_code, cpt_code)`,

    `CREATE INDEX IF NOT EXISTS idx_demographics_type        ON patient_demographics_rules(demographic_type, cpt_code)`,

    `CREATE INDEX IF NOT EXISTS idx_policy_change_date       ON policy_change_log(change_date)`,
    `CREATE INDEX IF NOT EXISTS idx_policy_change_trump      ON policy_change_log(trump_era_change)`,
    `CREATE INDEX IF NOT EXISTS idx_policy_change_payer_cpt  ON policy_change_log(payer_code, cpt_code)`,

    `CREATE INDEX IF NOT EXISTS idx_field_history_table_record ON field_change_history(table_name, record_id)`,
  ]

  for (const idx of indexes) await pool.query(idx)

  console.log('[CODING INTEL] 12 tables + indexes ready')
}

module.exports = migrateCodingIntelligence
