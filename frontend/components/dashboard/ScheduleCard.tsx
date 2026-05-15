'use client'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge, eligibilityVariant, eligibilityLabel } from '@/components/ui/Badge'
import { Appointment } from '@/lib/types'
import { formatCurrency, formatTime } from '@/lib/utils'

export function ScheduleCard({ appointments }: { appointments: Appointment[] }) {
  const router = useRouter()
  return (
    <Card padding={false}>
      <div style={{ padding: '14px 16px 0' }}>
        <CardHeader>
          <CardTitle>Today&apos;s Schedule</CardTitle>
          <span style={{ fontSize: 11, color: '#999' }}>{appointments.length} appointments</span>
        </CardHeader>
      </div>
      <div>
        {appointments.length === 0 && (
          <p style={{ color: '#999', fontSize: 13, padding: '16px' }}>No appointments today.</p>
        )}
        {appointments.map((appt, i) => (
          <div
            key={appt.id}
            onClick={() => router.push(`/encounter/${appt.id}`)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 16px',
              borderTop: i === 0 ? '1px solid #f0f0f0' : undefined,
              borderBottom: '1px solid #f5f5f5',
              cursor: 'pointer',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >
            {/* Time column */}
            <div style={{ width: 52, flexShrink: 0 }}>
              <p style={{ fontSize: 12, color: '#999', fontVariantNumeric: 'tabular-nums' }}>
                {appt.time ? formatTime(appt.time) : '—'}
              </p>
            </div>

            {/* Patient + visit type */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 500, fontSize: 13, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {appt.patientName}
              </p>
              <p style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{appt.visitType}</p>
            </div>

            {/* Copay + eligibility badge right-aligned */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {appt.copay != null && appt.eligibilityStatus === 'active' && (
                <span style={{ fontSize: 11, color: '#888' }}>{formatCurrency(appt.copay)} copay</span>
              )}
              <Badge variant={eligibilityVariant(appt.eligibilityStatus)}>
                {eligibilityLabel(appt.eligibilityStatus)}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
