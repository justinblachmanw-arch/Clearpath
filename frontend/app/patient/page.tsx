'use client'
import { useState, useRef, useCallback } from 'react'
import {
  apiPatientLookup, apiPatientRegister,
  apiInsuranceExtract, apiSubmitIntake
} from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = 'identity' | 'insurance' | 'history' | 'visit' | 'consent' | 'done'

interface PatientData {
  id: number
  firstName: string
  lastName: string
  dob: string
  payerName?: string | null
  payerCode?: string | null
  memberId?: string | null
  phone?: string | null
  providerId?: number
  medplumPatientId?: string | null
}

interface AppointmentData {
  id: number
  visitType: string
  scheduledTime?: string | null
  eligibilityStatus?: string | null
  copay?: number | null
  status?: string
}

const STEPS: Screen[] = ['identity', 'insurance', 'history', 'visit', 'consent']
const STEP_LABELS = ['Verify', 'Insurance', 'History', 'Reason', 'Consent']

const CONDITIONS_LIST = [
  'High blood pressure',
  'Diabetes',
  'Asthma or breathing problems',
  'Heart disease',
  'Depression or anxiety',
  'Thyroid problems',
  'Cancer (current or history)',
  'Kidney disease',
]

const DURATION_OPTIONS = [
  'Today', 'A few days', 'About a week',
  '2–4 weeks', '1–3 months', 'More than 3 months',
]

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: {
    minHeight: '100vh',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '0 0 48px',
  },
  inner: {
    width: '100%',
    maxWidth: 640,
    padding: '0 24px',
  },
  progressBar: {
    width: '100%',
    maxWidth: 640,
    padding: '20px 24px 0',
    display: 'flex',
    gap: 8,
    marginBottom: 32,
  },
  heading: {
    fontSize: 28,
    fontWeight: 700,
    color: '#111',
    lineHeight: 1.3,
    marginBottom: 8,
  },
  subheading: {
    fontSize: 18,
    color: '#555',
    marginBottom: 32,
  },
  label: {
    display: 'block' as const,
    fontSize: 16,
    fontWeight: 600,
    color: '#333',
    marginBottom: 8,
  },
  input: {
    width: '100%',
    padding: '16px',
    fontSize: 18,
    border: '2px solid #e0e0e0',
    borderRadius: 12,
    outline: 'none',
    color: '#111',
    background: '#fafafa',
    boxSizing: 'border-box' as const,
    marginBottom: 20,
  },
  btn: {
    width: '100%',
    padding: '18px',
    fontSize: 18,
    fontWeight: 700,
    borderRadius: 12,
    border: 'none',
    cursor: 'pointer',
    minHeight: 56,
  },
  btnPrimary: {
    background: '#111',
    color: '#fff',
  },
  btnSecondary: {
    background: '#f0f0f0',
    color: '#333',
  },
  btnGreen: {
    background: '#16a34a',
    color: '#fff',
  },
  btnDisabled: {
    background: '#ccc',
    color: '#888',
    cursor: 'not-allowed' as const,
  },
  chip: {
    display: 'inline-flex' as const,
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderRadius: 999,
    fontSize: 16,
    fontWeight: 500,
    marginRight: 8,
    marginBottom: 8,
  },
  fieldGroup: {
    marginBottom: 28,
  },
  error: {
    color: '#dc2626',
    fontSize: 15,
    marginBottom: 16,
    padding: '12px 16px',
    background: '#fef2f2',
    borderRadius: 8,
  },
  card: {
    background: '#f8f8f8',
    border: '1px solid #e5e5e5',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
}

// ─── Camera Component ─────────────────────────────────────────────────────────

function CameraCapture({
  label,
  onCapture,
  captured,
}: {
  label: string
  onCapture: (base64: string) => void
  captured: string | null
}) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [streaming, setStreaming] = useState(false)

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
      setStreaming(true)
    } catch {
      alert('Camera not available. Please use "Enter manually" instead.')
    }
  }, [])

  const capture = useCallback(() => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width  = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0)
    const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
    onCapture(base64)
    streamRef.current?.getTracks().forEach(t => t.stop())
    setStreaming(false)
  }, [onCapture])

  if (captured) {
    return (
      <div style={{ ...S.card, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
        <p style={{ fontSize: 16, color: '#16a34a', fontWeight: 600 }}>{label} captured</p>
        <button
          onClick={() => { onCapture(''); setStreaming(false) }}
          style={{ marginTop: 12, fontSize: 15, color: '#666', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Retake
        </button>
      </div>
    )
  }

  if (streaming) {
    return (
      <div style={{ marginBottom: 20 }}>
        <video ref={videoRef} style={{ width: '100%', borderRadius: 12, background: '#000' }} playsInline muted />
        <button
          onClick={capture}
          style={{ ...S.btn, ...S.btnPrimary, marginTop: 12 }}
        >
          📸 Capture {label}
        </button>
      </div>
    )
  }

  return (
    <button onClick={startCamera} style={{ ...S.btn, ...S.btnSecondary, marginBottom: 12 }}>
      📷 Take photo of {label}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PatientPage() {
  const [screen, setScreen]       = useState<Screen>('identity')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  // Patient & appointment
  const [patient, setPatient]         = useState<PatientData | null>(null)
  const [appointment, setAppointment] = useState<AppointmentData | null>(null)

  // Identity form
  const [firstName, setFirstName]         = useState('')
  const [lastName, setLastName]           = useState('')
  const [dob, setDob]                     = useState('')
  const [phoneLastFour, setPhoneLastFour] = useState('')

  // Insurance
  const [insuranceMode, setInsuranceMode]       = useState<'none' | 'camera' | 'manual'>('none')
  const [frontImage, setFrontImage]             = useState<string | null>(null)
  const [backImage, setBackImage]               = useState<string | null>(null)
  const [extractedInsurance, setExtractedInsurance] = useState<Record<string, string | null> | null>(null)
  const [extracting, setExtracting]             = useState(false)
  const [insuranceConfirmed, setInsuranceConfirmed] = useState(false)
  const [editedInsurance, setEditedInsurance]   = useState<Record<string, string>>({})

  // Manual insurance fields
  const [manualInsurance, setManualInsurance] = useState({
    payerName: '', memberID: '', groupNumber: '', planName: '', subscriberName: ''
  })

  // History
  const [hasMeds, setHasMeds]         = useState<boolean | null>(null)
  const [medInput, setMedInput]       = useState('')
  const [medications, setMedications] = useState<string[]>([])
  const [hasAllergies, setHasAllergies]   = useState<boolean | null>(null)
  const [allergyInput, setAllergyInput]   = useState('')
  const [allergies, setAllergies]         = useState<string[]>([])
  const [conditions, setConditions]       = useState<string[]>([])
  const [noneOfAbove, setNoneOfAbove]     = useState(false)

  // Visit
  const [chiefComplaint, setChiefComplaint]     = useState('')
  const [complaintDuration, setComplaintDuration] = useState('')
  const [severity, setSeverity]                 = useState(5)
  const [showSeverity, setShowSeverity]         = useState(false)

  // Consent
  const [hipaa, setHipaa]       = useState(false)
  const [financial, setFinancial] = useState(false)
  const [consent, setConsent]   = useState(false)

  const stepIndex = STEPS.indexOf(screen as Screen)

  // ── Identity submit ──────────────────────────────────────────────────────────

  async function handleIdentitySubmit() {
    if (!firstName.trim() || !lastName.trim() || !dob) {
      setError('Please fill in all required fields.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const result = await apiPatientLookup({
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        dob,
        phoneLastFour: phoneLastFour || undefined,
      })

      if (result.found) {
        setPatient(result.patient)
        setAppointment(result.appointment)
      } else {
        const reg = await apiPatientRegister({
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          dob,
          phone: phoneLastFour ? `+1000000${phoneLastFour}` : undefined,
        })
        setPatient(reg.patient)
        setAppointment(reg.appointment)
      }
      setScreen('insurance')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Insurance extraction ──────────────────────────────────────────────────────

  async function handleExtract() {
    if (!frontImage) { setError('Please capture the front of your card first.'); return }
    setExtracting(true)
    setError('')
    try {
      const result = await apiInsuranceExtract(frontImage, backImage || undefined)
      setExtractedInsurance(result.extracted)
      const edits: Record<string, string> = {}
      Object.entries(result.extracted).forEach(([k, v]) => { edits[k] = v || '' })
      setEditedInsurance(edits)
    } catch {
      setError('Could not read the card. You can enter your insurance manually.')
    } finally {
      setExtracting(false)
    }
  }

  function handleInsuranceContinue() {
    setScreen('history')
  }

  // ── History helpers ──────────────────────────────────────────────────────────

  function addMedication() {
    if (medInput.trim()) {
      setMedications(m => [...m, medInput.trim()])
      setMedInput('')
    }
  }

  function addAllergy() {
    if (allergyInput.trim()) {
      setAllergies(a => [...a, allergyInput.trim()])
      setAllergyInput('')
    }
  }

  function toggleCondition(c: string) {
    setNoneOfAbove(false)
    setConditions(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    )
  }

  // ── Final submission ─────────────────────────────────────────────────────────

  async function handleCheckIn() {
    if (!appointment?.id) { setError('No appointment found.'); return }
    setLoading(true)
    setError('')
    try {
      const ins = extractedInsurance
        ? Object.fromEntries(Object.entries(editedInsurance).map(([k, v]) => [k, v || null]))
        : manualInsurance.payerName ? manualInsurance : null

      await apiSubmitIntake(appointment.id, {
        patientId:          patient?.id,
        chiefComplaint,
        complaintDuration,
        severity:           showSeverity ? severity : null,
        currentMedications: medications,
        allergies,
        conditions:         noneOfAbove ? [] : conditions,
        extractedInsurance: ins,
        hipaaAcknowledged:  hipaa,
        financialConsent:   financial,
        consentToTreat:     consent,
      })
      setScreen('done')
    } catch {
      setError('Check-in failed. Please see the front desk.')
    } finally {
      setLoading(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (screen === 'done') {
    return (
      <div style={{ ...S.page, justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ padding: '0 24px', maxWidth: 480 }}>
          <div style={{ fontSize: 80, marginBottom: 24 }}>✅</div>
          <h1 style={{ ...S.heading, fontSize: 32, marginBottom: 16 }}>You&apos;re all checked in!</h1>
          <p style={{ fontSize: 20, color: '#555', lineHeight: 1.6 }}>
            Please let the front desk know you&apos;re ready.
          </p>
          {appointment?.copay != null && (
            <div style={{ marginTop: 24, padding: '16px 20px', background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0' }}>
              <p style={{ fontSize: 18, color: '#166534', fontWeight: 600 }}>
                Your copay today is ${appointment.copay}
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={S.page}>
      {/* Progress bar */}
      <div style={S.progressBar}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{
              height: 6,
              width: '100%',
              borderRadius: 99,
              background: i <= stepIndex ? '#111' : '#e5e5e5',
              transition: 'background 0.3s',
            }} />
            <span style={{
              fontSize: 12,
              color: i <= stepIndex ? '#111' : '#aaa',
              fontWeight: i === stepIndex ? 700 : 400,
            }}>
              {STEP_LABELS[i]}
            </span>
          </div>
        ))}
      </div>

      <div style={S.inner}>

        {/* ── SCREEN 1: Identity ─────────────────────────────────────────────── */}
        {screen === 'identity' && (
          <>
            <h1 style={S.heading}>Welcome.<br />Let&apos;s get you checked in.</h1>
            <p style={S.subheading}>Enter your information below.</p>

            {error && <div style={S.error}>{error}</div>}

            <div style={S.fieldGroup}>
              <label style={S.label}>First name</label>
              <input
                style={S.input}
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="Maria"
                autoComplete="given-name"
              />
            </div>

            <div style={S.fieldGroup}>
              <label style={S.label}>Last name</label>
              <input
                style={S.input}
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Santos"
                autoComplete="family-name"
              />
            </div>

            <div style={S.fieldGroup}>
              <label style={S.label}>Date of birth</label>
              <input
                style={S.input}
                type="date"
                value={dob}
                onChange={e => setDob(e.target.value)}
              />
            </div>

            <div style={S.fieldGroup}>
              <label style={S.label}>Last 4 digits of phone <span style={{ fontWeight: 400, color: '#888' }}>(optional)</span></label>
              <input
                style={S.input}
                value={phoneLastFour}
                onChange={e => setPhoneLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="5678"
                inputMode="numeric"
                maxLength={4}
              />
            </div>

            <button
              onClick={handleIdentitySubmit}
              disabled={loading}
              style={{ ...S.btn, ...(loading ? S.btnDisabled : S.btnPrimary) }}
            >
              {loading ? 'Looking you up…' : 'Continue →'}
            </button>
          </>
        )}

        {/* ── SCREEN 2: Insurance ──────────────────────────────────────────────── */}
        {screen === 'insurance' && (
          <>
            <h1 style={S.heading}>Let&apos;s verify your insurance.</h1>
            <p style={S.subheading}>
              {patient?.payerName
                ? `We have ${patient.payerName} on file. You can update it below.`
                : 'How would you like to provide your insurance information?'}
            </p>

            {error && <div style={S.error}>{error}</div>}

            {insuranceMode === 'none' && (
              <>
                <button
                  onClick={() => setInsuranceMode('camera')}
                  style={{ ...S.btn, ...S.btnPrimary, marginBottom: 16 }}
                >
                  📷 Take photo of insurance card
                </button>
                <button
                  onClick={() => setInsuranceMode('manual')}
                  style={{ ...S.btn, ...S.btnSecondary, marginBottom: 16 }}
                >
                  ✏️ Enter manually instead
                </button>
                <button
                  onClick={handleInsuranceContinue}
                  style={{ ...S.btn, ...S.btnSecondary }}
                >
                  Skip — use insurance on file
                </button>
              </>
            )}

            {insuranceMode === 'camera' && !insuranceConfirmed && (
              <>
                <CameraCapture label="front of card" onCapture={setFrontImage} captured={frontImage} />
                <CameraCapture label="back of card"  onCapture={setBackImage}  captured={backImage} />

                {frontImage && !extractedInsurance && (
                  <button
                    onClick={handleExtract}
                    disabled={extracting}
                    style={{ ...S.btn, ...(extracting ? S.btnDisabled : S.btnPrimary), marginTop: 8 }}
                  >
                    {extracting ? 'Reading your card…' : '🔍 Read my card'}
                  </button>
                )}

                {extractedInsurance && (
                  <div style={{ marginTop: 8 }}>
                    <div style={S.card}>
                      <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>We found this on your card:</p>
                      {Object.entries(editedInsurance).map(([key, val]) => (
                        <div key={key} style={{ marginBottom: 14 }}>
                          <label style={{ ...S.label, fontSize: 14, marginBottom: 4 }}>
                            {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                          </label>
                          <input
                            style={{ ...S.input, fontSize: 16, marginBottom: 0 }}
                            value={val}
                            onChange={e => setEditedInsurance(prev => ({ ...prev, [key]: e.target.value }))}
                            placeholder="(not found)"
                          />
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => { setInsuranceConfirmed(true); handleInsuranceContinue() }}
                      style={{ ...S.btn, ...S.btnGreen }}
                    >
                      ✓ Yes, this looks correct
                    </button>
                    <button
                      onClick={() => { setExtractedInsurance(null); setFrontImage(null); setBackImage(null) }}
                      style={{ ...S.btn, ...S.btnSecondary, marginTop: 12 }}
                    >
                      Retake photos
                    </button>
                  </div>
                )}
              </>
            )}

            {insuranceMode === 'manual' && (
              <>
                {(['payerName', 'memberID', 'groupNumber', 'planName', 'subscriberName'] as const).map(field => (
                  <div key={field} style={S.fieldGroup}>
                    <label style={S.label}>
                      {field === 'payerName'      ? 'Insurance company' :
                       field === 'memberID'        ? 'Member ID' :
                       field === 'groupNumber'     ? 'Group number' :
                       field === 'planName'        ? 'Plan name' :
                                                     'Subscriber name'}
                    </label>
                    <input
                      style={S.input}
                      value={manualInsurance[field]}
                      onChange={e => setManualInsurance(prev => ({ ...prev, [field]: e.target.value }))}
                    />
                  </div>
                ))}
                <button
                  onClick={handleInsuranceContinue}
                  style={{ ...S.btn, ...S.btnPrimary }}
                >
                  Continue →
                </button>
              </>
            )}
          </>
        )}

        {/* ── SCREEN 3: History ────────────────────────────────────────────────── */}
        {screen === 'history' && (
          <>
            <h1 style={S.heading}>Medical history</h1>
            <p style={S.subheading}>This helps your provider prepare for your visit.</p>

            {/* Medications */}
            <div style={{ marginBottom: 32 }}>
              <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
                Are you currently taking any medications?
              </p>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <button
                  onClick={() => setHasMeds(true)}
                  style={{ ...S.btn, flex: 1, ...(hasMeds === true ? S.btnPrimary : S.btnSecondary) }}
                >
                  Yes
                </button>
                <button
                  onClick={() => setHasMeds(false)}
                  style={{ ...S.btn, flex: 1, ...(hasMeds === false ? S.btnPrimary : S.btnSecondary) }}
                >
                  No
                </button>
              </div>
              {hasMeds && (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <input
                      style={{ ...S.input, flex: 1, marginBottom: 0 }}
                      value={medInput}
                      onChange={e => setMedInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addMedication()}
                      placeholder="e.g. Lisinopril 10mg daily"
                    />
                    <button
                      onClick={addMedication}
                      style={{ padding: '0 20px', fontSize: 18, fontWeight: 700, background: '#111', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', minHeight: 56, whiteSpace: 'nowrap' as const }}
                    >
                      Add
                    </button>
                  </div>
                  <div>
                    {medications.map(m => (
                      <span key={m} style={{ ...S.chip, background: '#f0f0f0', color: '#333' }}>
                        {m}
                        <button
                          onClick={() => setMedications(prev => prev.filter(x => x !== m))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#999', padding: 0 }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Allergies */}
            <div style={{ marginBottom: 32 }}>
              <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
                Do you have any known allergies?
              </p>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <button
                  onClick={() => setHasAllergies(true)}
                  style={{ ...S.btn, flex: 1, ...(hasAllergies === true ? S.btnPrimary : S.btnSecondary) }}
                >
                  Yes
                </button>
                <button
                  onClick={() => setHasAllergies(false)}
                  style={{ ...S.btn, flex: 1, ...(hasAllergies === false ? S.btnPrimary : S.btnSecondary) }}
                >
                  No
                </button>
              </div>
              {hasAllergies && (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <input
                      style={{ ...S.input, flex: 1, marginBottom: 0 }}
                      value={allergyInput}
                      onChange={e => setAllergyInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addAllergy()}
                      placeholder="e.g. Penicillin"
                    />
                    <button
                      onClick={addAllergy}
                      style={{ padding: '0 20px', fontSize: 18, fontWeight: 700, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', minHeight: 56, whiteSpace: 'nowrap' as const }}
                    >
                      Add
                    </button>
                  </div>
                  <div>
                    {allergies.map(a => (
                      <span key={a} style={{ ...S.chip, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                        {a}
                        <button
                          onClick={() => setAllergies(prev => prev.filter(x => x !== a))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#dc2626', padding: 0 }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Conditions */}
            <div style={{ marginBottom: 32 }}>
              <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
                Do you have any of the following conditions?
              </p>
              {CONDITIONS_LIST.map(c => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={conditions.includes(c)}
                    onChange={() => toggleCondition(c)}
                    style={{ width: 24, height: 24, cursor: 'pointer', accentColor: '#111' }}
                  />
                  <span style={{ fontSize: 18 }}>{c}</span>
                </label>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={noneOfAbove}
                  onChange={() => { setNoneOfAbove(!noneOfAbove); setConditions([]) }}
                  style={{ width: 24, height: 24, cursor: 'pointer', accentColor: '#111' }}
                />
                <span style={{ fontSize: 18 }}>None of the above</span>
              </label>
            </div>

            <button
              onClick={() => setScreen('visit')}
              style={{ ...S.btn, ...S.btnPrimary }}
            >
              Continue →
            </button>
          </>
        )}

        {/* ── SCREEN 4: Visit ──────────────────────────────────────────────────── */}
        {screen === 'visit' && (
          <>
            <h1 style={S.heading}>About today&apos;s visit</h1>
            <p style={S.subheading}>Your provider will see this before they come in.</p>

            <div style={S.fieldGroup}>
              <label style={S.label}>What brings you in today?</label>
              <textarea
                value={chiefComplaint}
                onChange={e => setChiefComplaint(e.target.value)}
                placeholder="Describe your concern in your own words…"
                rows={5}
                style={{
                  ...S.input,
                  resize: 'vertical' as const,
                  lineHeight: 1.6,
                }}
              />
            </div>

            <div style={S.fieldGroup}>
              <label style={S.label}>How long have you had this concern?</label>
              <select
                value={complaintDuration}
                onChange={e => setComplaintDuration(e.target.value)}
                style={{ ...S.input }}
              >
                <option value="">Select…</option>
                {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            <div style={S.fieldGroup}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <p style={{ fontSize: 18, fontWeight: 700 }}>Rate your discomfort (if applicable)</p>
                <button
                  onClick={() => setShowSeverity(!showSeverity)}
                  style={{ fontSize: 14, color: '#666', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  {showSeverity ? 'Hide' : 'Add rating'}
                </button>
              </div>
              {showSeverity && (
                <>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={severity}
                    onChange={e => setSeverity(Number(e.target.value))}
                    style={{ width: '100%', height: 8, accentColor: '#111' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#888', marginTop: 8 }}>
                    <span>1 — None</span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>{severity}</span>
                    <span>10 — Severe</span>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setScreen('consent')}
              style={{ ...S.btn, ...S.btnPrimary }}
            >
              Continue →
            </button>
          </>
        )}

        {/* ── SCREEN 5: Consent ────────────────────────────────────────────────── */}
        {screen === 'consent' && (
          <>
            <h1 style={S.heading}>Almost done.</h1>
            <p style={S.subheading}>Please review and sign the following.</p>

            {error && <div style={S.error}>{error}</div>}

            {[
              {
                key: 'hipaa' as const,
                checked: hipaa,
                set: setHipaa,
                text: 'I have received the HIPAA Privacy Notice and understand my privacy rights.',
              },
              {
                key: 'financial' as const,
                checked: financial,
                set: setFinancial,
                text: 'I understand I am responsible for all copays, deductibles, and charges not covered by my insurance, and I authorize payment directly to the provider.',
              },
              {
                key: 'consent' as const,
                checked: consent,
                set: setConsent,
                text: `I consent to examination and treatment by ${patient ? 'the provider' : 'the provider'} and their clinical staff.`,
              },
            ].map(item => (
              <label
                key={item.key}
                style={{ display: 'flex', gap: 16, padding: '20px 0', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', alignItems: 'flex-start' }}
              >
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={() => item.set(!item.checked)}
                  style={{ width: 28, height: 28, cursor: 'pointer', accentColor: '#111', marginTop: 2, flexShrink: 0 }}
                />
                <span style={{ fontSize: 17, lineHeight: 1.6, color: '#333' }}>{item.text}</span>
              </label>
            ))}

            <button
              onClick={handleCheckIn}
              disabled={!hipaa || !financial || !consent || loading}
              style={{
                ...S.btn,
                marginTop: 28,
                ...(!hipaa || !financial || !consent || loading ? S.btnDisabled : S.btnGreen),
              }}
            >
              {loading ? 'Submitting…' : '✓ Complete check-in'}
            </button>
          </>
        )}

      </div>
    </div>
  )
}
