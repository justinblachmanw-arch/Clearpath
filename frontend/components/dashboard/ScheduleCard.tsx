'use client'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge, eligibilityVariant, eligibilityLabel } from '@/components/ui/Badge'
import { Appointment } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'

export function ScheduleCard({ appointments }: { appointments: Appointment[] }) {
  const router = useRouter()
  return (
    <Card padding={false}>
      <div className="p-4 pb-0">
        <CardHeader>
          <CardTitle>Today's Schedule</CardTitle>
          <span style={{ fontSize: 12, color: '#999' }}>{appointments.length} appointments</span>
        </CardHeader>
      </div>
      <div>
        {appointments.length === 0 && (
          <p style={{ color: '#999', fontSize: 13, padding: '16px 16px' }}>No appointments today.</p>
        )}
        {appointments.map((appt, i) => (
          <div
            key={appt.id}
            onClick={() => router.push(`/encounter/${appt.id}`)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 16px',
              borderTop: i === 0 ? '1px solid #e5e5e5' : undefined,
              borderBottom: '1px solid #f0f0f0',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f9f9f9')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600, fontSize: 13, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {appt.patientName}
              </p>
              <p style={{ fontSize: 12, color: '#666', marginTop: 1 }}>{appt.visitType}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
    </Card>
  )
}
