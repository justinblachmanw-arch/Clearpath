require('dotenv').config()
const { getMedplumClient } = require('./medplum')

// ─── Patient ──────────────────────────────────────────────────────────────────

async function createFHIRPatient({ firstName, lastName, birthDate, phone, email }) {
  try {
    const client = await getMedplumClient()
    const resource = await client.createResource({
      resourceType: 'Patient',
      name: [{ use: 'official', family: lastName, given: [firstName] }],
      birthDate,
      telecom: [
        ...(phone  ? [{ system: 'phone', value: phone, use: 'mobile' }] : []),
        ...(email  ? [{ system: 'email', value: email }]                : [])
      ],
      active: true
    })
    console.log(`[FHIR] Patient created: ${resource.id}`)
    return { medplumId: resource.id, resource }
  } catch (err) {
    console.error('[FHIR] createFHIRPatient error:', err.message)
    throw err
  }
}

// ─── Patient History ──────────────────────────────────────────────────────────

async function getPatientHistory(medplumPatientId) {
  try {
    const client = await getMedplumClient()
    const ref = `Patient/${medplumPatientId}`

    const [condBundle, allergyBundle, medBundle, obsBundle, encBundle] = await Promise.all([
      client.search('Condition',              { patient: ref, _sort: '-date', _count: '20' }),
      client.search('AllergyIntolerance',     { patient: ref, _count: '20' }),
      client.search('MedicationStatement',    { subject: ref, _sort: '-date', _count: '20' }),
      client.search('Observation',            { patient: ref, category: 'vital-signs', _sort: '-date', _count: '20' }),
      client.search('Encounter',              { patient: ref, _sort: '-date', _count: '3' })
    ])

    const conditions = (condBundle.entry || []).map(e => ({
      id:      e.resource.id,
      code:    e.resource.code?.coding?.[0]?.code,
      display: e.resource.code?.coding?.[0]?.display || e.resource.code?.text,
      status:  e.resource.clinicalStatus?.coding?.[0]?.code
    }))

    const allergies = (allergyBundle.entry || []).map(e => ({
      id:       e.resource.id,
      substance: e.resource.code?.coding?.[0]?.display || e.resource.code?.text,
      severity:  e.resource.reaction?.[0]?.severity
    }))

    const medications = (medBundle.entry || []).map(e => ({
      id:   e.resource.id,
      name: e.resource.medicationCodeableConcept?.text ||
            e.resource.medicationCodeableConcept?.coding?.[0]?.display ||
            e.resource.medication?.concept?.text,
      status: e.resource.status
    }))

    // Latest vitals — most recent observation per LOINC code
    const vitalsMap = {}
    for (const entry of (obsBundle.entry || [])) {
      const obs   = entry.resource
      const loinc = obs.code?.coding?.[0]?.code
      if (loinc && !vitalsMap[loinc]) vitalsMap[loinc] = obs.valueQuantity?.value
    }
    const vitals = {
      bp:     vitalsMap['8480-6'] && vitalsMap['8462-4']
                ? `${vitalsMap['8480-6']}/${vitalsMap['8462-4']}`
                : null,
      hr:     vitalsMap['8867-4'] ?? null,
      temp:   vitalsMap['8310-5'] ?? null,
      weight: vitalsMap['29463-7'] ?? null,
      o2:     vitalsMap['2708-6'] ?? null
    }

    const recentEncounters = (encBundle.entry || []).map(e => ({
      id:      e.resource.id,
      date:    e.resource.period?.start,
      status:  e.resource.status,
      type:    e.resource.type?.[0]?.text || e.resource.class?.display
    }))

    return { conditions, allergies, medications, vitals, recentEncounters }
  } catch (err) {
    console.error('[FHIR] getPatientHistory error:', err.message)
    throw err
  }
}

// ─── Insurance / Coverage ─────────────────────────────────────────────────────

async function savePatientInsurance(medplumPatientId, { payerName, memberId, groupNumber, planName }) {
  try {
    const client = await getMedplumClient()
    const resource = await client.createResource({
      resourceType: 'Coverage',
      status: 'active',
      subscriber: { reference: `Patient/${medplumPatientId}` },
      beneficiary: { reference: `Patient/${medplumPatientId}` },
      payor: [{ display: payerName }],
      subscriberId: memberId,
      class: [
        ...(groupNumber ? [{ type: { coding: [{ code: 'group' }] }, value: groupNumber }] : []),
        ...(planName    ? [{ type: { coding: [{ code: 'plan' }]  }, value: planName    }] : [])
      ]
    })
    console.log(`[FHIR] Coverage created: ${resource.id}`)
    return resource.id
  } catch (err) {
    console.error('[FHIR] savePatientInsurance error:', err.message)
    throw err
  }
}

// ─── Appointment ──────────────────────────────────────────────────────────────

async function createFHIRAppointment({ medplumPatientId, medplumPractitionerId, date, visitType }) {
  try {
    const client = await getMedplumClient()
    const resource = await client.createResource({
      resourceType: 'Appointment',
      status: 'booked',
      serviceType: [{ coding: [{ display: visitType }] }],
      start: date,
      end:   date,
      participant: [
        { actor: { reference: `Patient/${medplumPatientId}` },      status: 'accepted' },
        { actor: { reference: `Practitioner/${medplumPractitionerId}` }, status: 'accepted' }
      ]
    })
    console.log(`[FHIR] Appointment created: ${resource.id}`)
    return resource.id
  } catch (err) {
    console.error('[FHIR] createFHIRAppointment error:', err.message)
    throw err
  }
}

async function updateFHIRAppointmentStatus(medplumAppointmentId, status) {
  try {
    const client = await getMedplumClient()
    const existing = await client.readResource('Appointment', medplumAppointmentId)
    await client.updateResource({ ...existing, status })
    console.log(`[FHIR] Appointment ${medplumAppointmentId} status → ${status}`)
  } catch (err) {
    console.error('[FHIR] updateFHIRAppointmentStatus error:', err.message)
    throw err
  }
}

// ─── Encounter ────────────────────────────────────────────────────────────────

async function createFHIREncounter({ medplumPatientId, medplumAppointmentId, medplumPractitionerId, visitType }) {
  try {
    const client = await getMedplumClient()
    const resource = await client.createResource({
      resourceType: 'Encounter',
      status: 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
      type: [{ coding: [{ display: visitType }] }],
      subject: { reference: `Patient/${medplumPatientId}` },
      participant: [{ individual: { reference: `Practitioner/${medplumPractitionerId}` } }],
      ...(medplumAppointmentId ? { appointment: [{ reference: `Appointment/${medplumAppointmentId}` }] } : {}),
      period: { start: new Date().toISOString() }
    })
    console.log(`[FHIR] Encounter created: ${resource.id}`)
    return resource.id
  } catch (err) {
    console.error('[FHIR] createFHIREncounter error:', err.message)
    throw err
  }
}

// ─── Vitals ───────────────────────────────────────────────────────────────────

const VITAL_LOINC = {
  bpSystolic:   { code: '8480-6',  display: 'Systolic blood pressure',  unit: 'mmHg', system: 'http://unitsofmeasure.org', ucum: 'mm[Hg]' },
  bpDiastolic:  { code: '8462-4',  display: 'Diastolic blood pressure', unit: 'mmHg', system: 'http://unitsofmeasure.org', ucum: 'mm[Hg]' },
  heartRate:    { code: '8867-4',  display: 'Heart rate',               unit: '/min', system: 'http://unitsofmeasure.org', ucum: '/min' },
  temperature:  { code: '8310-5',  display: 'Body temperature',         unit: '°F',   system: 'http://unitsofmeasure.org', ucum: '[degF]' },
  weightLbs:    { code: '29463-7', display: 'Body weight',              unit: 'lbs',  system: 'http://unitsofmeasure.org', ucum: '[lb_av]' },
  o2Saturation: { code: '2708-6',  display: 'Oxygen saturation',        unit: '%',    system: 'http://unitsofmeasure.org', ucum: '%' }
}

async function saveFHIRVitals({ medplumPatientId, medplumEncounterId, bpSystolic, bpDiastolic, heartRate, temperature, weightLbs, o2Saturation }) {
  try {
    const client = await getMedplumClient()
    const ids = []
    const now  = new Date().toISOString()

    const vitalsToSave = { bpSystolic, bpDiastolic, heartRate, temperature, weightLbs, o2Saturation }

    for (const [key, value] of Object.entries(vitalsToSave)) {
      if (value == null) continue
      const meta = VITAL_LOINC[key]
      const obs = await client.createResource({
        resourceType: 'Observation',
        status: 'final',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
        code: { coding: [{ system: 'http://loinc.org', code: meta.code, display: meta.display }], text: meta.display },
        subject: { reference: `Patient/${medplumPatientId}` },
        ...(medplumEncounterId ? { encounter: { reference: `Encounter/${medplumEncounterId}` } } : {}),
        effectiveDateTime: now,
        valueQuantity: { value: parseFloat(value), unit: meta.unit, system: meta.system, code: meta.ucum }
      })
      ids.push(obs.id)
    }

    console.log(`[FHIR] ${ids.length} vitals saved`)
    return ids
  } catch (err) {
    console.error('[FHIR] saveFHIRVitals error:', err.message)
    throw err
  }
}

async function getFHIRVitals(medplumPatientId, medplumEncounterId) {
  try {
    const client = await getMedplumClient()
    const params = { patient: `Patient/${medplumPatientId}`, category: 'vital-signs', _sort: '-date', _count: '20' }
    if (medplumEncounterId) params.encounter = `Encounter/${medplumEncounterId}`

    const bundle = await client.search('Observation', params)
    const map = {}
    for (const entry of (bundle.entry || [])) {
      const obs   = entry.resource
      const loinc = obs.code?.coding?.[0]?.code
      if (loinc && map[loinc] == null) map[loinc] = obs.valueQuantity?.value
    }

    return {
      bp:     map['8480-6'] != null && map['8462-4'] != null ? `${map['8480-6']}/${map['8462-4']}` : null,
      bpSystolic:  map['8480-6'] ?? null,
      bpDiastolic: map['8462-4'] ?? null,
      hr:     map['8867-4'] ?? null,
      temp:   map['8310-5'] ?? null,
      weight: map['29463-7'] ?? null,
      o2:     map['2708-6'] ?? null
    }
  } catch (err) {
    console.error('[FHIR] getFHIRVitals error:', err.message)
    throw err
  }
}

// ─── Intake — Allergies, Medications, Conditions, Consent ────────────────────

async function saveFHIRIntake({ medplumPatientId, medplumEncounterId, chiefComplaint, medications, allergies, conditions, consents }) {
  try {
    const client  = await getMedplumClient()
    const patRef  = `Patient/${medplumPatientId}`
    const encRef  = medplumEncounterId ? `Encounter/${medplumEncounterId}` : undefined
    const now     = new Date().toISOString()
    const result  = { allergies: [], medications: [], conditions: [], consents: [] }

    for (const substance of (allergies || [])) {
      const r = await client.createResource({
        resourceType: 'AllergyIntolerance',
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'unconfirmed' }] },
        patient: { reference: patRef },
        recordedDate: now,
        code: { text: substance }
      })
      result.allergies.push(r.id)
    }

    for (const med of (medications || [])) {
      const r = await client.createResource({
        resourceType: 'MedicationStatement',
        status: 'active',
        subject: { reference: patRef },
        dateAsserted: now,
        medicationCodeableConcept: { text: med },
        ...(encRef ? { context: { reference: encRef } } : {})
      })
      result.medications.push(r.id)
    }

    for (const condition of (conditions || [])) {
      const r = await client.createResource({
        resourceType: 'Condition',
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'unconfirmed' }] },
        subject: { reference: patRef },
        recordedDate: now,
        code: { text: condition },
        ...(encRef ? { encounter: { reference: encRef } } : {})
      })
      result.conditions.push(r.id)
    }

    if (consents?.hipaa) {
      const r = await client.createResource({
        resourceType: 'Consent',
        status: 'active',
        scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'privacy' }] },
        category: [{ coding: [{ system: 'http://loinc.org', code: '59284-0', display: 'Privacy policy acknowledgement' }] }],
        patient: { reference: patRef },
        dateTime: now,
        policyRule: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'HIPAA' }] }
      })
      result.consents.push(r.id)
    }

    if (consents?.treatment) {
      const r = await client.createResource({
        resourceType: 'Consent',
        status: 'active',
        scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'treatment' }] },
        category: [{ coding: [{ system: 'http://loinc.org', code: '64292-6', display: 'Release of information consent' }] }],
        patient: { reference: patRef },
        dateTime: now,
        policyRule: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'treat' }] }
      })
      result.consents.push(r.id)
    }

    if (consents?.financial) {
      const r = await client.createResource({
        resourceType: 'Consent',
        status: 'active',
        scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }] },
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentcategorycodes', code: 'acd', display: 'Financial responsibility consent' }] }],
        patient: { reference: patRef },
        dateTime: now,
        policyRule: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'PAYDECL' }] }
      })
      result.consents.push(r.id)
    }

    // Update Encounter with chief complaint — isolated so a failure here never blocks consent saves
    if (chiefComplaint && medplumEncounterId) {
      try {
        await client.updateResource({
          ...(await client.readResource('Encounter', medplumEncounterId)),
          reasonCode: [{ text: chiefComplaint }]
        })
      } catch (encErr) {
        console.error('[FHIR] Encounter reasonCode update failed (non-blocking):', encErr.message)
      }
    }

    console.log(`[FHIR] Intake saved: ${result.allergies.length} allergies, ${result.medications.length} meds, ${result.conditions.length} conditions`)
    return result
  } catch (err) {
    console.error('[FHIR] saveFHIRIntake error:', err.message)
    throw err
  }
}

async function getFHIRIntake(medplumPatientId, medplumEncounterId) {
  try {
    const client = await getMedplumClient()
    const patRef = `Patient/${medplumPatientId}`

    const [allergyBundle, medBundle, condBundle, consentBundle] = await Promise.all([
      client.search('AllergyIntolerance', { patient: patRef, _sort: '-date', _count: '20' }),
      client.search('MedicationStatement', { subject: patRef, _sort: '-date', _count: '20' }),
      client.search('Condition', { patient: patRef, _sort: '-date', _count: '20' }),
      client.search('Consent', { patient: patRef, _count: '10' })
    ])

    return {
      allergies: (allergyBundle.entry || []).map(e => e.resource.code?.text || e.resource.code?.coding?.[0]?.display),
      medications: (medBundle.entry || []).map(e =>
        e.resource.medicationCodeableConcept?.text ||
        e.resource.medicationCodeableConcept?.coding?.[0]?.display ||
        e.resource.medication?.concept?.text
      ),
      conditions: (condBundle.entry || []).map(e => ({
        text: e.resource.code?.text,
        code: e.resource.code?.coding?.[0]?.code
      })),
      consents: (consentBundle.entry || []).map(e => e.resource.scope?.coding?.[0]?.code)
    }
  } catch (err) {
    console.error('[FHIR] getFHIRIntake error:', err.message)
    throw err
  }
}

// ─── SOAP Note / Composition ──────────────────────────────────────────────────

async function saveFHIRNote({ medplumPatientId, medplumEncounterId, medplumPractitionerId, subjective, objective, assessment, plan, icd10Codes, cptCode }) {
  try {
    const client = await getMedplumClient()
    const now = new Date().toISOString()

    // Create Condition per ICD-10 code
    for (const code of (icd10Codes || [])) {
      await client.createResource({
        resourceType: 'Condition',
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
        subject: { reference: `Patient/${medplumPatientId}` },
        recordedDate: now,
        code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] },
        ...(medplumEncounterId ? { encounter: { reference: `Encounter/${medplumEncounterId}` } } : {})
      })
    }

    const composition = await client.createResource({
      resourceType: 'Composition',
      status: 'final',
      type: { coding: [{ system: 'http://loinc.org', code: '11488-4', display: 'Consult note' }] },
      subject: { reference: `Patient/${medplumPatientId}` },
      date: now,
      author: [{ reference: `Practitioner/${medplumPractitionerId}` }],
      title: 'SOAP Note',
      ...(medplumEncounterId ? { encounter: { reference: `Encounter/${medplumEncounterId}` } } : {}),
      section: [
        { title: 'Subjective',  code: { coding: [{ system: 'http://loinc.org', code: '61150-9' }] }, text: { status: 'generated', div: `<div>${subjective || ''}</div>` } },
        { title: 'Objective',   code: { coding: [{ system: 'http://loinc.org', code: '61149-1' }] }, text: { status: 'generated', div: `<div>${objective || ''}</div>` } },
        { title: 'Assessment',  code: { coding: [{ system: 'http://loinc.org', code: '51848-0' }] }, text: { status: 'generated', div: `<div>${assessment || ''} — ICD-10: ${(icd10Codes || []).join(', ')}</div>` } },
        { title: 'Plan',        code: { coding: [{ system: 'http://loinc.org', code: '18776-5' }] }, text: { status: 'generated', div: `<div>${plan || ''} — CPT: ${cptCode || ''}</div>` } }
      ]
    })

    console.log(`[FHIR] Composition saved: ${composition.id}`)
    return composition.id
  } catch (err) {
    console.error('[FHIR] saveFHIRNote error:', err.message)
    throw err
  }
}

async function getFHIRNote(medplumEncounterId) {
  try {
    const client = await getMedplumClient()
    const bundle = await client.search('Composition', {
      encounter: `Encounter/${medplumEncounterId}`,
      _sort: '-date',
      _count: '1'
    })
    if (!bundle.entry?.length) return null
    const comp = bundle.entry[0].resource
    const sections = {}
    for (const s of (comp.section || [])) {
      sections[s.title] = s.text?.div?.replace(/<[^>]+>/g, '') || ''
    }
    return {
      subjective: sections['Subjective'],
      objective:  sections['Objective'],
      assessment: sections['Assessment'],
      plan:       sections['Plan'],
      conditions: []
    }
  } catch (err) {
    console.error('[FHIR] getFHIRNote error:', err.message)
    throw err
  }
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

async function createFHIRTask({ medplumPatientId, medplumEncounterId, type, priority, description, aiInstruction }) {
  try {
    const client = await getMedplumClient()
    const resource = await client.createResource({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      priority: priority || 'routine',
      code: { text: type },
      description,
      note: aiInstruction ? [{ text: aiInstruction }] : [],
      for: { reference: `Patient/${medplumPatientId}` },
      ...(medplumEncounterId ? { focus: { reference: `Encounter/${medplumEncounterId}` } } : {}),
      authoredOn: new Date().toISOString()
    })
    console.log(`[FHIR] Task created: ${resource.id}`)
    return resource.id
  } catch (err) {
    console.error('[FHIR] createFHIRTask error:', err.message)
    throw err
  }
}

async function getOpenFHIRTasks(medplumPractitionerId) {
  try {
    const client = await getMedplumClient()
    const bundle = await client.search('Task', {
      owner: `Practitioner/${medplumPractitionerId}`,
      status: 'requested,active',
      _sort: '-authored-on',
      _count: '50'
    })
    return (bundle.entry || []).map(e => ({
      id:          e.resource.id,
      status:      e.resource.status,
      priority:    e.resource.priority,
      description: e.resource.description,
      code:        e.resource.code?.text,
      authoredOn:  e.resource.authoredOn
    }))
  } catch (err) {
    console.error('[FHIR] getOpenFHIRTasks error:', err.message)
    throw err
  }
}

module.exports = {
  createFHIRPatient,
  getPatientHistory,
  savePatientInsurance,
  createFHIRAppointment,
  updateFHIRAppointmentStatus,
  createFHIREncounter,
  saveFHIRVitals,
  getFHIRVitals,
  saveFHIRIntake,
  getFHIRIntake,
  saveFHIRNote,
  getFHIRNote,
  createFHIRTask,
  getOpenFHIRTasks
}
