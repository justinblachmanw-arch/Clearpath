'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getToken } from '@/lib/auth'
import { apiGetEncounter, apiSaveOrders, apiSignNote } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { PageLoader, ErrorMessage } from '@/components/ui/LoadingSpinner'
import { formatDate, calcAge } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Encounter {
  appointment: {
    id: number; date: string; visitType: string; status: string
    eligibilityStatus: string | null; copay: number | null
    deductibleRemaining: number | null; medplumEncounterId: string | null
  }
  patient: {
    id: number; name: string; dob: string | null
    payerName: string | null; payerCode: string | null; memberId: string | null
    medplumPatientId: string | null
  }
  provider: { name: string; medplumPractitionerId: string | null }
  intake: {
    chiefComplaint: string | null; complaintDuration: string | null; severity: number | null
    currentMedications: string[]; allergies: string[]; conditions: string[]
    extractedInsurance: Record<string, string> | null
    submittedAt: string | null
  } | null
  vitals: {
    bpSystolic: number | null; bpDiastolic: number | null; heartRate: number | null
    temperature: number | null; weightLbs: number | null; o2Saturation: number | null
    source?: string
  } | null
  medplum: {
    allergies: { id: string; substance: string }[]
    medications: { id: string; name: string }[]
    conditions: { id: string; code: string; display: string }[]
    recentEncounters: { id: string; date: string; type: string }[]
  } | null
  previousVisits: { id: number; date: string; visitType: string; subjective: string | null; icd10Codes: string[]; cptCode: string | null }[]
}

// ─── ICD-10 reference for common primary care codes ──────────────────────────

const COMMON_ICD10: { code: string; description: string }[] = [
  { code: 'Z00.00', description: 'Encounter for general adult medical examination' },
  { code: 'I10',    description: 'Essential (primary) hypertension' },
  { code: 'E11.9',  description: 'Type 2 diabetes mellitus without complications' },
  { code: 'E11.65', description: 'Type 2 diabetes with hyperglycemia' },
  { code: 'J06.9',  description: 'Acute upper respiratory infection, unspecified' },
  { code: 'M54.5',  description: 'Low back pain' },
  { code: 'F32.1',  description: 'Major depressive disorder, single episode, moderate' },
  { code: 'F41.1',  description: 'Generalized anxiety disorder' },
  { code: 'E78.5',  description: 'Hyperlipidemia, unspecified' },
  { code: 'J18.9',  description: 'Pneumonia, unspecified organism' },
  { code: 'Z12.31', description: 'Encounter for screening mammogram for malignant neoplasm' },
  { code: 'Z79.4',  description: 'Long-term (current) use of insulin' },
  { code: 'N39.0',  description: 'Urinary tract infection, site not specified' },
  { code: 'K21.0',  description: 'Gastro-esophageal reflux disease with esophagitis' },
  { code: 'J45.901',description: 'Unspecified asthma, uncomplicated' },
  { code: 'E03.9',  description: 'Hypothyroidism, unspecified' },
  { code: 'Z87.891',description: 'Personal history of nicotine dependence' },
]

const CONDITION_TO_ICD10: Record<string, string> = {
  'High blood pressure':        'I10',
  'Diabetes':                   'E11.9',
  'Asthma or breathing problems': 'J45.901',
  'Heart disease':              'I25.10',
  'Depression or anxiety':      'F32.1',
  'Thyroid problems':           'E03.9',
  'Kidney disease':             'N18.9',
}

const LAB_ORDERS = [
  { name: 'CBC with differential',         code: '58410-2' },
  { name: 'Comprehensive metabolic panel',  code: '24323-8' },
  { name: 'Lipid panel',                    code: '57698-3' },
  { name: 'HbA1c',                          code: '4548-4'  },
  { name: 'TSH',                            code: '3016-3'  },
  { name: 'Urinalysis',                     code: '5767-9'  },
  { name: 'Blood glucose, fasting',         code: '1558-6'  },
  { name: 'Vitamin D',                      code: '14635-7' },
]

// ─── CPT suggestion ───────────────────────────────────────────────────────────

function suggestCPT(conditions: string[], visitType: string, subjectiveLength: number): { code: string; reasoning: string } {
  const isWellness   = visitType?.toLowerCase().includes('wellness') || visitType?.toLowerCase().includes('annual')
  const isNew        = visitType?.toLowerCase().includes('new')
  const chronicCount = conditions.filter(c => ['I10', 'E11.9', 'E78.5', 'F32.1', 'E03.9'].some(x => c.includes(x) || x.includes(c))).length

  if (isWellness && !isNew) return { code: '99395', reasoning: `Annual wellness visit — preventive medicine (age 18-39). Existing patient.` }
  if (isWellness && isNew)  return { code: '99385', reasoning: `Annual wellness visit — new patient, preventive medicine.` }
  if (isNew && chronicCount >= 2) return { code: '99205', reasoning: `New patient with ${chronicCount} chronic conditions — high complexity.` }
  if (isNew) return { code: '99204', reasoning: `New patient, moderate complexity.` }
  if (chronicCount >= 2 || subjectiveLength > 300) return { code: '99214', reasoning: `${chronicCount} chronic conditions managed, moderate complexity. Prescription drug management.` }
  if (chronicCount === 1) return { code: '99213', reasoning: `Single chronic condition, low complexity.` }
  return { code: '99213', reasoning: `Established patient, low complexity office visit.` }
}

// ─── Quality measures ─────────────────────────────────────────────────────────

function qualityAlerts(icd10s: string[], vitals: Encounter['vitals']): string[] {
  const alerts: string[] = []
  if (icd10s.some(c => c.startsWith('E11'))) alerts.push('HbA1c due — order if not checked within 3 months')
  if (icd10s.some(c => c.startsWith('E11'))) alerts.push('Annual foot exam — document if completed today')
  if (icd10s.some(c => c === 'I10') && vitals?.bpSystolic && vitals.bpSystolic < 130) alerts.push('Blood pressure at goal — document in note')
  if (icd10s.some(c => c === 'I10') && vitals?.bpSystolic && vitals.bpSystolic >= 130) alerts.push('BP above goal (130+) — consider medication adjustment')
  if (icd10s.some(c => c.startsWith('E78'))) alerts.push('Lipid panel due — order if not checked within 12 months')
  return alerts
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function VitalsRow({ v }: { v: Encounter['vitals'] }) {
  if (!v) return <p style={{ fontSize: 13, color: '#aaa' }}>No vitals recorded</p>
  const chips = [
    v.bpSystolic   ? { label: 'BP',     value: `${v.bpSystolic}/${v.bpDiastolic}` } : null,
    v.heartRate    ? { label: 'HR',     value: `${v.heartRate} bpm` } : null,
    v.temperature  ? { label: 'Temp',   value: `${v.temperature}°F` } : null,
    v.weightLbs    ? { label: 'Wt',     value: `${v.weightLbs} lb` } : null,
    v.o2Saturation ? { label: 'O₂',    value: `${v.o2Saturation}%` } : null,
  ].filter(Boolean) as { label: string; value: string }[]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
      {chips.map(c => (
        <div key={c.label} style={{
          background: '#f5f5f5', borderRadius: 6, padding: '6px 10px',
        }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{c.label}</p>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#111', lineHeight: 1 }}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}

function SideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e5e5', padding: 14, marginBottom: 10 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{title}</p>
      {children}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = ['Note', 'Orders', 'Billing'] as const
type Tab = typeof TABS[number]

export default function EncounterPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  useEffect(() => { if (!getToken()) router.replace('/login') }, [router])

  const [data, setData]         = useState<Encounter | null>(null)
  const [isLoading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [tab, setTab]           = useState<Tab>('Note')

  // SOAP state
  const [subjective,  setSubjective]  = useState('')
  const [objective,   setObjective]   = useState('')
  const [assessment,  setAssessment]  = useState('')
  const [plan,        setPlan]        = useState('')
  const [icd10Codes,  setIcd10Codes]  = useState<string[]>([])
  const [icd10Search, setIcd10Search] = useState('')
  const [cptCode,     setCptCode]     = useState('')
  const [cptModifier, setCptModifier] = useState('')
  const [selectedLabs, setSelectedLabs] = useState<string[]>([])

  // Sign state
  const [signing,    setSigning]    = useState(false)
  const [signed,     setSigned]     = useState(false)
  const [signResult, setSignResult] = useState<{ scrub: { passed: boolean; errors: { message: string }[] }; claim: { claimNumber: string; billedAmount: number; status: string } | null } | null>(null)

  // Load encounter
  useEffect(() => {
    if (!id) return
    apiGetEncounter(id)
      .then((enc: Encounter) => {
        setData(enc)
        setLoading(false)

        // Pre-populate from intake
        if (enc.intake?.chiefComplaint) {
          setSubjective(
            `Chief complaint: ${enc.intake.chiefComplaint}` +
            (enc.intake.complaintDuration ? `\nDuration: ${enc.intake.complaintDuration}` : '') +
            (enc.intake.severity ? `\nSeverity: ${enc.intake.severity}/10` : '') +
            (enc.intake.currentMedications?.length ? `\nMedications: ${enc.intake.currentMedications.join(', ')}` : '') +
            (enc.intake.allergies?.length ? `\nAllergies: ${enc.intake.allergies.join(', ')}` : '')
          )
        }

        // Auto-insert vitals into objective
        const v = enc.vitals
        if (v) {
          const vStr = [
            v.bpSystolic    ? `BP ${v.bpSystolic}/${v.bpDiastolic}` : null,
            v.heartRate     ? `HR ${v.heartRate}` : null,
            v.temperature   ? `Temp ${v.temperature}°F` : null,
            v.weightLbs     ? `Weight ${v.weightLbs} lbs` : null,
            v.o2Saturation  ? `O2 ${v.o2Saturation}%` : null,
          ].filter(Boolean).join(', ')
          setObjective(`Vitals: ${vStr}\n\nPhysical exam: `)
        }

        // Suggest ICD-10 codes from intake conditions
        const suggested: string[] = []
        for (const cond of (enc.intake?.conditions || [])) {
          const code = typeof cond === 'string' ? CONDITION_TO_ICD10[cond] : null
          if (code && !suggested.includes(code)) suggested.push(code)
        }
        if (suggested.length) setIcd10Codes(suggested)
      })
      .catch(() => {
        setLoading(false)
        setFetchError(true)
      })
  }, [id])

  // Auto-suggest CPT when ICD10 codes or subjective changes
  useEffect(() => {
    if (!data) return
    const suggestion = suggestCPT(icd10Codes, data.appointment.visitType, subjective.length)
    setCptCode(suggestion.code)
  }, [icd10Codes, data, subjective.length])

  function addIcd10(code: string) {
    if (!icd10Codes.includes(code)) setIcd10Codes(prev => [...prev, code])
    setIcd10Search('')
  }

  function removeIcd10(code: string) {
    setIcd10Codes(prev => prev.filter(c => c !== code))
  }

  function toggleLab(name: string) {
    setSelectedLabs(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name])
  }

  async function handleSign() {
    if (!id || !icd10Codes.length || !cptCode) return
    setSigning(true)
    try {
      // Save orders first
      if (selectedLabs.length) {
        await apiSaveOrders(parseInt(id), selectedLabs.map(name => {
          const lab = LAB_ORDERS.find(l => l.name === name)
          return { orderName: name, orderCode: lab?.code, orderType: 'lab' }
        }))
      }
      const result = await apiSignNote(id, { subjective, objective, assessment, plan, icd10Codes, cptCode, cptModifier: cptModifier || undefined })
      setSignResult(result)
      setSigned(true)
    } catch {
      alert('Sign failed. Check that all required fields are complete.')
    } finally {
      setSigning(false)
    }
  }

  if (isLoading) return <><Topbar title="Patient Encounter" /><div style={{ padding: 24 }}><PageLoader /></div></>
  if (fetchError || !data) return <><Topbar title="Patient Encounter" /><div style={{ padding: 24 }}><ErrorMessage message="Could not load encounter." /></div></>

  const { appointment, patient, provider, intake, vitals, previousVisits } = data
  const cptSuggestion = suggestCPT(icd10Codes, appointment.visitType, subjective.length)
  const alerts        = qualityAlerts(icd10Codes, vitals)

  const filteredIcd10 = icd10Search.trim()
    ? COMMON_ICD10.filter(c =>
        c.code.toLowerCase().includes(icd10Search.toLowerCase()) ||
        c.description.toLowerCase().includes(icd10Search.toLowerCase())
      ).slice(0, 6)
    : []

  // Pre-sign checklist
  const checks = [
    { label: 'Chief complaint documented', ok: subjective.length > 20 },
    { label: 'Vitals recorded',            ok: !!vitals },
    { label: 'Physical exam documented',   ok: objective.length > 30 },
    { label: 'Assessment complete',        ok: icd10Codes.length > 0 },
    { label: 'CPT code selected',          ok: !!cptCode },
  ]
  const allChecksPass = checks.every(c => c.ok)

  // CPT → billed amount
  const CPT_AMOUNTS: Record<string, number> = {
    '99202': 180, '99203': 200, '99204': 250, '99205': 320,
    '99211': 75,  '99212': 110, '99213': 150, '99214': 220, '99215': 280,
    '99385': 280, '99395': 280,
  }
  const billedAmount = CPT_AMOUNTS[cptCode] || 200
  const estimatedPayment = appointment.eligibilityStatus === 'active'
    ? Math.round(billedAmount * 0.75)
    : null

  return (
    <>
      <Topbar
        title={`${patient.name} — ${appointment.visitType}`}
        subtitle={formatDate(appointment.date)}
      />
      <div style={{ flex: 1, padding: '16px 20px', background: '#f5f5f5', overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 14, maxWidth: 1200 }}>

          {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

            <SideSection title="">
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: '50%', background: '#111',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 auto 10px',
                }}>
                  {patient.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <p style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>{patient.name}</p>
                {patient.dob && (
                  <p style={{ fontSize: 12, color: '#777', marginTop: 2 }}>
                    DOB {formatDate(patient.dob)} · {calcAge(patient.dob)}
                  </p>
                )}
              </div>
              <div style={{
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                textAlign: 'center',
                background: appointment.eligibilityStatus === 'active' ? '#dcfce7' : '#fee2e2',
                color: appointment.eligibilityStatus === 'active' ? '#166534' : '#991b1b',
              }}>
                {appointment.eligibilityStatus === 'active' ? '✓ Eligible' : `⚠ ${appointment.eligibilityStatus || 'Unknown'}`}
              </div>
            </SideSection>

            <SideSection title="Insurance">
              <SRow label="Payer"       value={patient.payerName ?? '—'} />
              <SRow label="Member ID"   value={patient.memberId ?? '—'} />
              <SRow label="Copay"       value={appointment.copay != null ? `$${appointment.copay}` : '—'} />
              <SRow label="Deductible"  value={appointment.deductibleRemaining != null ? `$${appointment.deductibleRemaining} rem.` : '—'} />
            </SideSection>

            <SideSection title="Vitals">
              <VitalsRow v={vitals} />
            </SideSection>

            <SideSection title="Allergies">
              {intake?.allergies?.length
                ? intake.allergies.map(a => (
                    <span key={a} style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 99, background: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 600, marginRight: 4, marginBottom: 4 }}>{a}</span>
                  ))
                : <p style={{ fontSize: 12, color: '#aaa' }}>None reported</p>}
            </SideSection>

            <SideSection title="Medications">
              {intake?.currentMedications?.length
                ? intake.currentMedications.map(m => (
                    <p key={m} style={{ fontSize: 12, color: '#333', marginBottom: 3 }}>• {m}</p>
                  ))
                : <p style={{ fontSize: 12, color: '#aaa' }}>None reported</p>}
            </SideSection>

            <SideSection title="Chief Complaint">
              {intake?.chiefComplaint
                ? <>
                    <p style={{ fontSize: 13, color: '#333', lineHeight: 1.5, fontStyle: 'italic' }}>
                      &ldquo;{intake.chiefComplaint}&rdquo;
                    </p>
                    {intake.complaintDuration && <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Duration: {intake.complaintDuration}</p>}
                    {intake.severity         && <p style={{ fontSize: 12, color: '#888' }}>Severity: {intake.severity}/10</p>}
                  </>
                : <p style={{ fontSize: 12, color: '#aaa' }}>No intake completed</p>}
            </SideSection>

            {previousVisits.length > 0 && (
              <SideSection title="Visit History">
                {previousVisits.map(v => (
                  <div key={v.id} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #f0f0f0' }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>{formatDate(v.date)} · {v.visitType}</p>
                    {v.icd10Codes?.length > 0 && <p style={{ fontSize: 11, color: '#888' }}>{v.icd10Codes.join(', ')}</p>}
                  </div>
                ))}
              </SideSection>
            )}
          </div>

          {/* ── RIGHT PANEL ─────────────────────────────────────────────────── */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e5e5e5' }}>
              {TABS.map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: '12px 20px', fontSize: 13, fontWeight: 600,
                  background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: tab === t ? '2px solid #111' : '2px solid transparent',
                  color: tab === t ? '#111' : '#999', marginBottom: -1,
                }}>
                  {t}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px' }}>
              {/* Note / Orders / Billing content */}
              <div style={{ padding: 20, borderRight: '1px solid #e5e5e5' }}>

                {/* NOTE TAB */}
                {tab === 'Note' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {(['Subjective', 'Objective', 'Assessment', 'Plan'] as const).map(section => (
                      <div key={section}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{section}</p>

                        {section === 'Assessment' ? (
                          <>
                            {/* ICD-10 pills */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                              {icd10Codes.map(code => {
                                const meta = COMMON_ICD10.find(c => c.code === code)
                                return (
                                  <span key={code} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    padding: '4px 10px', borderRadius: 6,
                                    background: 'transparent', border: '0.5px solid #1d4ed8',
                                    color: '#1d4ed8', fontSize: 12, fontWeight: 600,
                                  }}>
                                    {code} {meta ? `— ${meta.description.split(',')[0]}` : ''}
                                    <button onClick={() => removeIcd10(code)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#93c5fd', fontSize: 14, padding: 0 }}>✕</button>
                                  </span>
                                )
                              })}
                            </div>
                            {/* ICD-10 search */}
                            <div style={{ position: 'relative' }}>
                              <input
                                value={icd10Search}
                                onChange={e => setIcd10Search(e.target.value)}
                                placeholder="Search ICD-10 codes…"
                                style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #e5e5e5', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }}
                              />
                              {filteredIcd10.length > 0 && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8, zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                                  {filteredIcd10.map(c => (
                                    <button
                                      key={c.code}
                                      onClick={() => addIcd10(c.code)}
                                      style={{ display: 'block', width: '100%', padding: '10px 12px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid #f5f5f5' }}
                                    >
                                      <strong>{c.code}</strong> — {c.description}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <textarea
                              value={assessment}
                              onChange={e => setAssessment(e.target.value)}
                              placeholder="Clinical assessment…"
                              rows={2}
                              style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #e5e5e5', borderRadius: 6, resize: 'vertical', outline: 'none', marginTop: 8, boxSizing: 'border-box' }}
                            />
                          </>
                        ) : (
                          <textarea
                            value={section === 'Subjective' ? subjective : section === 'Objective' ? objective : plan}
                            onChange={e => {
                              if (section === 'Subjective') setSubjective(e.target.value)
                              else if (section === 'Objective') setObjective(e.target.value)
                              else setPlan(e.target.value)
                            }}
                            placeholder={
                              section === 'Subjective' ? 'Patient history, chief complaint…' :
                              section === 'Objective'  ? 'Vitals, physical exam findings…' :
                              'Treatment plan, medications, labs, follow-up…'
                            }
                            rows={section === 'Plan' ? 4 : 3}
                            style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #e5e5e5', borderRadius: 6, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                          />
                        )}
                      </div>
                    ))}

                    {/* CPT selector */}
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>CPT Code</p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          value={cptCode}
                          onChange={e => setCptCode(e.target.value)}
                          placeholder="99214"
                          style={{ width: 100, padding: '8px 10px', fontSize: 14, fontWeight: 700, border: '1px solid #e5e5e5', borderRadius: 6, outline: 'none' }}
                        />
                        <input
                          value={cptModifier}
                          onChange={e => setCptModifier(e.target.value)}
                          placeholder="Modifier (opt)"
                          style={{ flex: 1, padding: '8px 10px', fontSize: 13, border: '1px solid #e5e5e5', borderRadius: 6, outline: 'none' }}
                        />
                      </div>
                    </div>

                    {/* Pre-sign checklist + sign button */}
                    {!signed ? (
                      <>
                        <div style={{ background: '#f8f8f8', borderRadius: 8, padding: 14 }}>
                          {checks.map(c => (
                            <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 16, color: c.ok ? '#16a34a' : '#d1d5db' }}>{c.ok ? '✓' : '○'}</span>
                              <span style={{ fontSize: 13, color: c.ok ? '#111' : '#9ca3af' }}>{c.label}</span>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={handleSign}
                          disabled={!allChecksPass || signing}
                          style={{
                            width: '100%', padding: '13px 24px', fontSize: 14, fontWeight: 700,
                            background: !allChecksPass || signing ? '#e5e5e5' : '#111',
                            color: !allChecksPass || signing ? '#999' : '#fff',
                            border: 'none', borderRadius: 8, cursor: !allChecksPass || signing ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {signing ? 'Running scrub…' : 'Sign note & generate claim'}
                        </button>
                      </>
                    ) : (
                      <div>
                        {signResult?.scrub.passed ? (
                          <div style={{ padding: 16, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                            <p style={{ fontSize: 14, fontWeight: 700, color: '#166534', marginBottom: 8 }}>✓ Claim generated — ready for clearinghouse</p>
                            {signResult.claim && (
                              <>
                                <p style={{ fontSize: 13, color: '#166534' }}>Claim #{signResult.claim.claimNumber}</p>
                                <p style={{ fontSize: 13, color: '#166534' }}>CPT {cptCode} · ICD-10: {icd10Codes.join(', ')} · Billed: ${signResult.claim.billedAmount}</p>
                                <p style={{ fontSize: 13, color: '#166534' }}>Payer: {patient.payerName} · Status: {signResult.claim.status}</p>
                              </>
                            )}
                          </div>
                        ) : (
                          <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
                            <p style={{ fontSize: 14, fontWeight: 700, color: '#991b1b', marginBottom: 8 }}>Claim scrub failed — fix before submitting:</p>
                            {signResult?.scrub.errors.map((e, i) => (
                              <p key={i} style={{ fontSize: 13, color: '#991b1b', marginBottom: 4 }}>• {e.message}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ORDERS TAB */}
                {tab === 'Orders' && (
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 16 }}>Lab orders</p>
                    {LAB_ORDERS.map(lab => (
                      <label key={lab.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selectedLabs.includes(lab.name)}
                          onChange={() => toggleLab(lab.name)}
                          style={{ width: 18, height: 18, accentColor: '#111', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 14, color: '#333' }}>{lab.name}</span>
                        <span style={{ fontSize: 12, color: '#aaa', marginLeft: 'auto' }}>{lab.code}</span>
                      </label>
                    ))}
                    {selectedLabs.length > 0 && (
                      <div style={{ marginTop: 16, padding: 12, background: '#eff6ff', borderRadius: 8 }}>
                        <p style={{ fontSize: 13, color: '#1d4ed8', fontWeight: 600 }}>
                          {selectedLabs.length} order{selectedLabs.length !== 1 ? 's' : ''} selected — saved when note is signed
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* BILLING TAB */}
                {tab === 'Billing' && (
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 16 }}>Claim preview</p>
                    <div style={{ background: '#f8f8f8', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <BRow label="CPT code"     value={cptCode || '—'} />
                      <BRow label="ICD-10 codes"  value={icd10Codes.length ? icd10Codes.join(', ') : '—'} />
                      <BRow label="Modifier"      value={cptModifier || '—'} />
                      <BRow label="Place of service" value="11 — Office" />
                      <BRow label="Payer"          value={patient.payerName || '—'} />
                      <BRow label="Member ID"      value={patient.memberId || '—'} />
                    </div>
                    <div style={{ background: '#f0fdf4', borderRadius: 8, padding: 16 }}>
                      <BRow label="Billed amount"      value={`$${billedAmount}`} />
                      <BRow label="Est. contracted rate" value={estimatedPayment ? `~$${estimatedPayment}` : 'N/A'} />
                      <BRow label="Copay"              value={appointment.copay != null ? `$${appointment.copay}` : '—'} />
                    </div>
                    {!signed && !allChecksPass && (
                      <p style={{ fontSize: 13, color: '#dc2626', marginTop: 12 }}>
                        Complete the note before generating the claim.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* AI Assist Panel */}
              <div style={{ padding: 16, background: '#fafafa' }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>AI Assist</p>

                {/* CPT suggestion */}
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', marginBottom: 4 }}>Suggested CPT</p>
                  <p style={{ fontSize: 16, fontWeight: 700, color: '#1e3a8a' }}>{cptSuggestion.code}</p>
                  <p style={{ fontSize: 11, color: '#3b82f6', lineHeight: 1.5, marginTop: 4 }}>{cptSuggestion.reasoning}</p>
                </div>

                {/* Quality alerts */}
                {alerts.length > 0 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>Quality Alerts</p>
                    {alerts.map(a => (
                      <p key={a} style={{ fontSize: 11, color: '#78350f', marginBottom: 4, lineHeight: 1.5 }}>• {a}</p>
                    ))}
                  </div>
                )}

                {/* Documentation completeness */}
                <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#666', marginBottom: 8 }}>Completeness</p>
                  {checks.map(c => (
                    <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                      <span style={{ fontSize: 13, color: c.ok ? '#16a34a' : '#d1d5db' }}>{c.ok ? '✓' : '○'}</span>
                      <span style={{ fontSize: 11, color: c.ok ? '#374151' : '#9ca3af', lineHeight: 1.4 }}>{c.label}</span>
                    </div>
                  ))}
                </div>

                {/* Provider info */}
                <p style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>{provider.name}</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}

function SRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: '#aaa' }}>{label}</span>
      <span style={{ fontSize: 11, color: '#111', fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  )
}

function BRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 13, color: '#666' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{value}</span>
    </div>
  )
}
