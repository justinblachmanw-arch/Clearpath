'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiMALogin, apiMASchedule, apiSaveVitals, apiCheckIn, apiMarkReady } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleEntry {
  id: number
  patientName: string
  dob: string
  visitType: string
  scheduledTime: string | null
  eligibilityStatus: string | null
  copay: number | null
  payerName: string | null
  payerCode: string | null
  status: string
  hasIntake: boolean
  hasVitals: boolean
  checkInTime: string | null
}

type View = 'schedule' | 'checkin' | 'vitals' | 'ready'

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  booked:         { label: 'WAITING',        bg: '#e5e7eb', color: '#374151' },
  intake_complete:{ label: 'INTAKE DONE',    bg: '#dbeafe', color: '#1e40af' },
  checked_in:     { label: 'CHECKED IN',     bg: '#fef08a', color: '#854d0e' },
  vitals_done:    { label: 'VITALS DONE',    bg: '#fed7aa', color: '#9a3412' },
  provider_ready: { label: 'READY',          bg: '#bbf7d0', color: '#14532d' },
  with_provider:  { label: 'WITH PROVIDER',  bg: '#e9d5ff', color: '#6b21a8' },
  complete:       { label: 'COMPLETE',       bg: '#d1d5db', color: '#111827' },
}

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG['booked']
}

function getPrimaryAction(status: string): string | null {
  if (status === 'booked' || status === 'intake_complete') return 'Check in patient'
  if (status === 'checked_in')    return 'Enter vitals'
  if (status === 'vitals_done')   return 'Mark ready for provider'
  return null
}

function formatTime(t: string | null): string {
  if (!t) return '—'
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

function calcAge(dob: string): string {
  if (!dob) return ''
  const birth = new Date(dob + 'T00:00:00')
  const today = new Date()
  const age = today.getFullYear() - birth.getFullYear() -
    (today.getMonth() < birth.getMonth() ||
      (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate()) ? 1 : 0)
  return `${age} yrs`
}

// ─── PIN Login ────────────────────────────────────────────────────────────────

function PinLogin({ onLogin }: { onLogin: (token: string, name: string) => void }) {
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (pin.length < 4) { setError('Enter your 4-digit PIN'); return }
    setLoading(true)
    setError('')
    try {
      const result = await apiMALogin(pin)
      onLogin(result.token, result.ma.name)
    } catch {
      setError('Invalid PIN. Please try again.')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  function appendDigit(d: string) {
    if (pin.length < 4) setPin(p => p + d)
  }

  function backspace() {
    setPin(p => p.slice(0, -1))
  }

  useEffect(() => {
    if (pin.length === 4) submit()
  }, [pin]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#fff', padding: 24,
    }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>MA Sign In</h1>
      <p style={{ fontSize: 18, color: '#666', marginBottom: 40, textAlign: 'center' }}>Enter your PIN</p>

      {/* PIN dots */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            width: 20, height: 20, borderRadius: '50%',
            background: i < pin.length ? '#111' : '#e5e5e5',
            transition: 'background 0.15s',
          }} />
        ))}
      </div>

      {error && (
        <p style={{ color: '#dc2626', fontSize: 16, marginBottom: 20 }}>{error}</p>
      )}

      {/* Numpad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 80px)', gap: 12 }}>
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
          <button
            key={i}
            onClick={() => d === '⌫' ? backspace() : d ? appendDigit(d) : null}
            disabled={!d || loading}
            style={{
              width: 80, height: 80, borderRadius: 12, fontSize: 24, fontWeight: 600,
              background: d === '⌫' ? '#fee2e2' : d ? '#f5f5f5' : 'transparent',
              color: d === '⌫' ? '#dc2626' : '#111',
              border: 'none', cursor: d ? 'pointer' : 'default',
            }}
          >
            {d}
          </button>
        ))}
      </div>

      {loading && <p style={{ marginTop: 24, color: '#666', fontSize: 16 }}>Signing in…</p>}
    </div>
  )
}

// ─── Check-in Modal ───────────────────────────────────────────────────────────

function CheckInModal({
  appt, token,
  onDone, onCancel,
}: {
  appt: ScheduleEntry
  token: string
  onDone: () => void
  onCancel: () => void
}) {
  const [loading, setLoading] = useState(false)

  async function confirm() {
    setLoading(true)
    try {
      await apiCheckIn(token, appt.id)
      onDone()
    } catch {
      alert('Check-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const eligOk = appt.eligibilityStatus === 'active'

  return (
    <div style={overlay}>
      <div style={modal}>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{appt.patientName}</h2>
        <p style={{ fontSize: 16, color: '#666', marginBottom: 24 }}>
          DOB {appt.dob} · {calcAge(appt.dob)} · {appt.visitType}
        </p>

        <div style={{ marginBottom: 20 }}>
          <Row label="Insurance"  value={appt.payerName || '—'} />
          <Row label="Eligibility" value={eligOk ? '✓ Active' : '⚠ ' + (appt.eligibilityStatus || 'Unknown')} color={eligOk ? '#16a34a' : '#dc2626'} />
          <Row label="Copay"       value={appt.copay != null ? `$${appt.copay}` : '—'} />
        </div>

        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Intake checklist</p>
          <Check label="Tablet intake completed" ok={appt.hasIntake} />
          <Check label="Insurance verified"      ok={eligOk} />
          <Check label="Consents signed"         ok={appt.hasIntake} />
        </div>

        {!eligOk && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <p style={{ color: '#dc2626', fontSize: 15, fontWeight: 600 }}>⚠ Insurance not verified — confirm with patient</p>
          </div>
        )}

        <button
          onClick={confirm}
          disabled={loading}
          style={{ width: '100%', padding: 18, fontSize: 18, fontWeight: 700, background: loading ? '#ccc' : '#16a34a', color: '#fff', border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 12, minHeight: 56 }}
        >
          {loading ? 'Checking in…' : '✓ Confirm check-in'}
        </button>
        <button onClick={onCancel} style={{ width: '100%', padding: 16, fontSize: 16, background: 'none', border: '1px solid #e5e5e5', borderRadius: 12, cursor: 'pointer', color: '#666' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Vitals Modal ─────────────────────────────────────────────────────────────

function VitalsModal({
  appt, token,
  onDone, onCancel,
}: {
  appt: ScheduleEntry
  token: string
  onDone: () => void
  onCancel: () => void
}) {
  const [bp1, setBp1]       = useState('')
  const [bp2, setBp2]       = useState('')
  const [hr, setHr]         = useState('')
  const [temp, setTemp]     = useState('')
  const [weight, setWeight] = useState('')
  const [o2, setO2]         = useState('')
  const [htFt, setHtFt]     = useState('')
  const [htIn, setHtIn]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  async function save() {
    if (!bp1 || !bp2 || !hr || !temp || !weight) {
      setError('BP, heart rate, temperature, and weight are required.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const heightInches = htFt || htIn
        ? (parseFloat(htFt || '0') * 12) + parseFloat(htIn || '0')
        : undefined

      await apiSaveVitals(token, {
        appointmentId: appt.id,
        bpSystolic:    parseInt(bp1),
        bpDiastolic:   parseInt(bp2),
        heartRate:     parseInt(hr),
        temperature:   parseFloat(temp),
        weightLbs:     parseFloat(weight),
        o2Saturation:  o2 ? parseInt(o2) : undefined,
        heightInches,
        recordedBy:    'MA',
      })
      onDone()
    } catch {
      setError('Failed to save vitals. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const labelStyle = { display: 'block' as const, fontSize: 15, fontWeight: 600, color: '#555', marginBottom: 6 }
  const numInput = (val: string, set: (v: string) => void, ph: string, suffix?: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
      <input
        inputMode="decimal"
        value={val}
        onChange={e => set(e.target.value)}
        placeholder={ph}
        style={{ flex: 1, padding: '16px', fontSize: 22, fontWeight: 700, border: '2px solid #e0e0e0', borderRadius: 10, outline: 'none', textAlign: 'center' as const }}
      />
      {suffix && <span style={{ fontSize: 16, color: '#888', whiteSpace: 'nowrap' as const }}>{suffix}</span>}
    </div>
  )

  return (
    <div style={overlay}>
      <div style={{ ...modal, maxHeight: '90vh', overflowY: 'auto' as const }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Vitals — {appt.patientName}</h2>
        <p style={{ fontSize: 15, color: '#666', marginBottom: 24 }}>{appt.visitType}</p>

        {error && <div style={{ color: '#dc2626', fontSize: 15, marginBottom: 16, padding: '10px 14px', background: '#fef2f2', borderRadius: 8 }}>{error}</div>}

        <label style={labelStyle}>Blood pressure</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <input inputMode="numeric" value={bp1} onChange={e => setBp1(e.target.value)} placeholder="128" style={{ flex: 1, padding: '16px', fontSize: 22, fontWeight: 700, border: '2px solid #e0e0e0', borderRadius: 10, outline: 'none', textAlign: 'center' as const }} />
          <span style={{ fontSize: 22, fontWeight: 700 }}>/</span>
          <input inputMode="numeric" value={bp2} onChange={e => setBp2(e.target.value)} placeholder="82" style={{ flex: 1, padding: '16px', fontSize: 22, fontWeight: 700, border: '2px solid #e0e0e0', borderRadius: 10, outline: 'none', textAlign: 'center' as const }} />
          <span style={{ fontSize: 16, color: '#888' }}>mmHg</span>
        </div>

        <label style={labelStyle}>Heart rate</label>
        {numInput(hr, setHr, '72', 'bpm')}

        <label style={labelStyle}>Temperature</label>
        {numInput(temp, setTemp, '98.4', '°F')}

        <label style={labelStyle}>Weight</label>
        {numInput(weight, setWeight, '165', 'lbs')}

        <label style={labelStyle}>O₂ saturation</label>
        {numInput(o2, setO2, '98', '%')}

        <label style={labelStyle}>Height (if new patient)</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <input inputMode="numeric" value={htFt} onChange={e => setHtFt(e.target.value)} placeholder="5" style={{ flex: 1, padding: '14px', fontSize: 20, fontWeight: 700, border: '2px solid #e0e0e0', borderRadius: 10, outline: 'none', textAlign: 'center' as const }} />
          <span style={{ fontSize: 16, color: '#888', alignSelf: 'center' }}>ft</span>
          <input inputMode="numeric" value={htIn} onChange={e => setHtIn(e.target.value)} placeholder="6" style={{ flex: 1, padding: '14px', fontSize: 20, fontWeight: 700, border: '2px solid #e0e0e0', borderRadius: 10, outline: 'none', textAlign: 'center' as const }} />
          <span style={{ fontSize: 16, color: '#888', alignSelf: 'center' }}>in</span>
        </div>

        <button
          onClick={save}
          disabled={loading}
          style={{ width: '100%', padding: 18, fontSize: 18, fontWeight: 700, background: loading ? '#ccc' : '#16a34a', color: '#fff', border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 12, minHeight: 56 }}
        >
          {loading ? 'Saving…' : '✓ Save vitals'}
        </button>
        <button onClick={onCancel} style={{ width: '100%', padding: 16, fontSize: 16, background: 'none', border: '1px solid #e5e5e5', borderRadius: 12, cursor: 'pointer', color: '#666' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Ready Modal ──────────────────────────────────────────────────────────────

function ReadyModal({ appt, token, onDone, onCancel }: { appt: ScheduleEntry; token: string; onDone: () => void; onCancel: () => void }) {
  const [loading, setLoading] = useState(false)

  async function confirm() {
    setLoading(true)
    try {
      await apiMarkReady(token, appt.id)
      onDone()
    } catch {
      alert('Failed to update status.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={overlay}>
      <div style={modal}>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Mark Ready</h2>
        <p style={{ fontSize: 18, color: '#444', marginBottom: 28 }}>
          Mark <strong>{appt.patientName}</strong> as ready for the provider?
        </p>
        <button
          onClick={confirm}
          disabled={loading}
          style={{ width: '100%', padding: 18, fontSize: 18, fontWeight: 700, background: loading ? '#ccc' : '#16a34a', color: '#fff', border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 12, minHeight: 56 }}
        >
          {loading ? 'Updating…' : 'Yes, mark ready'}
        </button>
        <button onClick={onCancel} style={{ width: '100%', padding: 16, fontSize: 16, background: 'none', border: '1px solid #e5e5e5', borderRadius: 12, cursor: 'pointer', color: '#666' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Patient Card ─────────────────────────────────────────────────────────────

function PatientCard({ appt, onAction }: { appt: ScheduleEntry; onAction: (appt: ScheduleEntry, action: View) => void }) {
  const statusCfg = getStatusConfig(appt.status)
  const action    = getPrimaryAction(appt.status)

  return (
    <div style={{
      background: '#fff',
      borderRadius: 16,
      border: '1px solid #e5e5e5',
      padding: 20,
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <p style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 2 }}>{appt.patientName}</p>
          <p style={{ fontSize: 15, color: '#666' }}>{formatTime(appt.scheduledTime)} · {appt.visitType}</p>
        </div>
        <span style={{
          padding: '6px 12px',
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 700,
          background: statusCfg.bg,
          color: statusCfg.color,
          whiteSpace: 'nowrap' as const,
        }}>
          {statusCfg.label}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: action ? 16 : 0 }}>
        {appt.payerName && <span style={{ fontSize: 14, color: '#888' }}>{appt.payerName}</span>}
        {appt.copay != null && <span style={{ fontSize: 14, color: '#888' }}>Copay ${appt.copay}</span>}
        {appt.eligibilityStatus === 'inactive' && (
          <span style={{ fontSize: 14, color: '#dc2626', fontWeight: 600 }}>⚠ Inactive insurance</span>
        )}
        {appt.eligibilityStatus === 'not_found' && (
          <span style={{ fontSize: 14, color: '#dc2626', fontWeight: 600 }}>⚠ Insurance not found</span>
        )}
      </div>

      {action && (
        <button
          onClick={() => {
            const view: View = appt.status === 'checked_in' ? 'vitals'
                             : appt.status === 'vitals_done' ? 'ready'
                             : 'checkin'
            onAction(appt, view)
          }}
          style={{
            width: '100%',
            padding: '14px 16px',
            fontSize: 16,
            fontWeight: 700,
            background: '#111',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            cursor: 'pointer',
            minHeight: 48,
          }}
        >
          {action}
        </button>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MAPage() {
  const [maToken, setMAToken]   = useState<string | null>(null)
  const [maName, setMAName]     = useState('')
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([])
  const [loading, setLoading]   = useState(false)
  const [selectedAppt, setSelectedAppt] = useState<ScheduleEntry | null>(null)
  const [activeView, setActiveView]     = useState<View>('schedule')
  const [lastRefresh, setLastRefresh]   = useState<Date | null>(null)

  const loadSchedule = useCallback(async (token: string) => {
    setLoading(true)
    try {
      const data = await apiMASchedule(token)
      setSchedule(data.schedule || [])
      setLastRefresh(new Date())
    } catch {
      // token expired — force re-login
      setMAToken(null)
      setMAName('')
      localStorage.removeItem('clearpath_ma_token')
      localStorage.removeItem('clearpath_ma_name')
    } finally {
      setLoading(false)
    }
  }, [])

  // Restore session on mount
  useEffect(() => {
    const tok  = localStorage.getItem('clearpath_ma_token')
    const name = localStorage.getItem('clearpath_ma_name')
    if (tok && name) {
      setMAToken(tok)
      setMAName(name)
    }
  }, [])

  useEffect(() => {
    if (maToken) loadSchedule(maToken)
  }, [maToken, loadSchedule])

  function handleLogin(token: string, name: string) {
    localStorage.setItem('clearpath_ma_token', token)
    localStorage.setItem('clearpath_ma_name', name)
    setMAToken(token)
    setMAName(name)
  }

  function handleLogout() {
    localStorage.removeItem('clearpath_ma_token')
    localStorage.removeItem('clearpath_ma_name')
    setMAToken(null)
    setMAName('')
    setSchedule([])
  }

  function handleAction(appt: ScheduleEntry, view: View) {
    setSelectedAppt(appt)
    setActiveView(view)
  }

  function handleModalDone() {
    setSelectedAppt(null)
    setActiveView('schedule')
    if (maToken) loadSchedule(maToken)
  }

  if (!maToken) return <PinLogin onLogin={handleLogin} />

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const waiting   = schedule.filter(a => ['booked', 'intake_complete'].includes(a.status)).length
  const inProgress = schedule.filter(a => ['checked_in', 'vitals_done', 'provider_ready'].includes(a.status)).length

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e5e5', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>Hi, {maName}</p>
          <p style={{ fontSize: 14, color: '#888' }}>{today}</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            onClick={() => maToken && loadSchedule(maToken)}
            style={{ padding: '8px 16px', fontSize: 14, background: '#f0f0f0', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#333' }}
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <button
            onClick={handleLogout}
            style={{ padding: '8px 16px', fontSize: 14, background: 'none', border: '1px solid #e5e5e5', borderRadius: 8, cursor: 'pointer', color: '#666' }}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e5e5', padding: '12px 24px', display: 'flex', gap: 24 }}>
        <StatPill label="Total today" value={schedule.length} color="#111" />
        <StatPill label="Waiting" value={waiting} color="#6b7280" />
        <StatPill label="In progress" value={inProgress} color="#d97706" />
        <StatPill label="Complete" value={schedule.filter(a => a.status === 'complete').length} color="#16a34a" />
      </div>

      {/* Schedule */}
      <div style={{ padding: '20px 20px 48px', maxWidth: 680, margin: '0 auto' }}>
        {lastRefresh && (
          <p style={{ fontSize: 13, color: '#aaa', marginBottom: 16 }}>
            Updated {lastRefresh.toLocaleTimeString()}
          </p>
        )}

        {loading && !schedule.length && (
          <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 18 }}>Loading schedule…</div>
        )}

        {!loading && !schedule.length && (
          <div style={{ textAlign: 'center', padding: 48, color: '#888', fontSize: 18 }}>No appointments scheduled today.</div>
        )}

        {schedule.map(appt => (
          <PatientCard key={appt.id} appt={appt} onAction={handleAction} />
        ))}
      </div>

      {/* Modals */}
      {selectedAppt && activeView === 'checkin' && (
        <CheckInModal
          appt={selectedAppt}
          token={maToken}
          onDone={handleModalDone}
          onCancel={() => { setSelectedAppt(null); setActiveView('schedule') }}
        />
      )}
      {selectedAppt && activeView === 'vitals' && (
        <VitalsModal
          appt={selectedAppt}
          token={maToken}
          onDone={handleModalDone}
          onCancel={() => { setSelectedAppt(null); setActiveView('schedule') }}
        />
      )}
      {selectedAppt && activeView === 'ready' && (
        <ReadyModal
          appt={selectedAppt}
          token={maToken}
          onDone={handleModalDone}
          onCancel={() => { setSelectedAppt(null); setActiveView('schedule') }}
        />
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
      <span style={{ fontSize: 15, color: '#888' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: color || '#111' }}>{value}</span>
    </div>
  )
}

function Check({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <span style={{ fontSize: 18, color: ok ? '#16a34a' : '#9ca3af' }}>{ok ? '✓' : '○'}</span>
      <span style={{ fontSize: 15, color: ok ? '#111' : '#9ca3af' }}>{label}</span>
    </div>
  )
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <p style={{ fontSize: 22, fontWeight: 700, color }}>{value}</p>
      <p style={{ fontSize: 12, color: '#888' }}>{label}</p>
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 20,
}

const modal: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: 28,
  width: '100%',
  maxWidth: 480,
}
