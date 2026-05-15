'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import { useDashboard } from '@/hooks/useDashboard'
import { Topbar } from '@/components/layout/Topbar'
import { Badge, eligibilityVariant, eligibilityLabel } from '@/components/ui/Badge'
import { PageLoader, ErrorMessage } from '@/components/ui/LoadingSpinner'
import { formatCurrency } from '@/lib/utils'

export default function SchedulePage() {
  const router = useRouter()
  useEffect(() => { if (!getToken()) router.replace('/login') }, [router])

  const { data, isLoading, error } = useDashboard()
  const appts = data?.todayAppointments ?? []

  const verified  = appts.filter(a => a.eligibilityStatus === 'active').length
  const checkIns  = appts.filter(a => a.eligibilityStatus === 'not_found').length
  const pending   = appts.filter(a => !a.eligibilityStatus).length

  return (
    <>
      <Topbar title="Today's Schedule" subtitle={`${appts.length} appointments`} />
      <div style={{ flex: 1, padding: 24, background: '#f5f5f5', overflowY: 'auto' }}>
        {isLoading && <PageLoader />}
        {error && <ErrorMessage message="Could not reach the API." />}
        {data && (
          <div style={{ maxWidth: 900 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <Badge variant="success">{verified} verified</Badge>
              <Badge variant="warning">{checkIns} check ins.</Badge>
              <Badge variant="gray">{pending} pending</Badge>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
              {appts.length === 0 && (
                <p style={{ padding: 24, color: '#999', fontSize: 13 }}>No appointments scheduled today.</p>
              )}
              {appts.map((appt, i) => (
                <div
                  key={appt.id}
                  onClick={() => router.push(`/encounter/${appt.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '12px 20px',
                    borderBottom: i < appts.length - 1 ? '1px solid #f0f0f0' : undefined,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f9f9f9')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <div style={{ width: 60, fontSize: 12, color: '#999', flexShrink: 0 }}>
                    {appt.time ?? '—'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 600, fontSize: 14, color: '#1a1a1a' }}>{appt.patientName}</p>
                    <p style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{appt.visitType}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {appt.copay != null && appt.eligibilityStatus === 'active' && (
                      <span style={{ fontSize: 12, color: '#666' }}>{formatCurrency(appt.copay)} copay</span>
                    )}
                    <Badge variant={eligibilityVariant(appt.eligibilityStatus)}>
                      {eligibilityLabel(appt.eligibilityStatus)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
