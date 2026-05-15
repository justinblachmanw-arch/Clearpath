import { Credential } from '@/lib/types'
import { formatShortDate } from '@/lib/utils'
import { ExternalLink } from 'lucide-react'

function urgencyColor(days: number | null) {
  if (days === null) return { bar: '#999', text: '#666', bg: '#fff' }
  if (days < 30)  return { bar: '#c0392b', text: '#c0392b', bg: '#fef9f9' }
  if (days < 60)  return { bar: '#b45309', text: '#b45309', bg: '#fffdf5' }
  if (days < 90)  return { bar: '#1e7e34', text: '#1e7e34', bg: '#f9fef9' }
  return { bar: '#d1d5db', text: '#666', bg: '#fff' }
}

export function CredentialCard({ cred }: { cred: Credential }) {
  const colors = urgencyColor(cred.daysRemaining)
  const pct    = cred.daysRemaining == null ? 100
    : Math.min(100, Math.max(0, (cred.daysRemaining / 365) * 100))

  return (
    <div style={{
      border: '0.5px solid rgba(0,0,0,0.12)',
      borderRadius: 8,
      padding: '14px 16px',
      background: colors.bg,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: '#1a1a1a' }}>
            {cred.credentialType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </p>
          {cred.issuingBody && (
            <p style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{cred.issuingBody}</p>
          )}
        </div>
        {cred.daysRemaining != null && (
          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
            <p style={{ fontSize: 28, fontWeight: 700, color: colors.text, lineHeight: 1, letterSpacing: '-0.02em' }}>
              {cred.daysRemaining}
            </p>
            <p style={{ fontSize: 10, color: colors.text, marginTop: 2, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>days left</p>
          </div>
        )}
      </div>

      {/* Progress bar — 3px */}
      <div style={{ margin: '10px 0 6px', height: 3, background: '#ebebeb', borderRadius: 99 }}>
        <div style={{ height: '100%', background: colors.bar, borderRadius: 99, width: `${pct}%`, transition: 'width 0.3s' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 11, color: '#aaa' }}>
          {cred.expiryDate ? `Expires ${formatShortDate(cred.expiryDate)}` : 'No expiry'}
        </p>
        {cred.renewalUrl && (
          <a href={cred.renewalUrl} target="_blank" rel="noreferrer" style={{
            fontSize: 11, color: '#1a5fb4',
            display: 'flex', alignItems: 'center', gap: 3,
            textDecoration: 'none', fontWeight: 500,
          }}>
            Renew <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  )
}
