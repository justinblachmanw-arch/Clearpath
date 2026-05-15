import { Credential } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { ExternalLink } from 'lucide-react'

function urgencyColor(days: number | null) {
  if (days === null) return { bar: '#999', text: '#666', bg: '#f5f5f5' }
  if (days < 30)  return { bar: '#c0392b', text: '#c0392b', bg: '#fef2f2' }
  if (days < 60)  return { bar: '#b45309', text: '#b45309', bg: '#fffbeb' }
  return { bar: '#1e7e34', text: '#1e7e34', bg: '#f0fdf4' }
}

export function CredentialCard({ cred }: { cred: Credential }) {
  const colors = urgencyColor(cred.daysRemaining)
  const pct = cred.daysRemaining == null ? 100
    : Math.min(100, Math.max(0, (cred.daysRemaining / 365) * 100))

  return (
    <div style={{
      border: '1px solid #e5e5e5', borderRadius: 8,
      padding: 16, background: colors.bg,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontWeight: 600, fontSize: 13, color: '#1a1a1a' }}>
            {cred.credentialType.replace(/_/g, ' ')}
          </p>
          {cred.issuingBody && (
            <p style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{cred.issuingBody}</p>
          )}
        </div>
        {cred.daysRemaining != null && (
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 28, fontWeight: 700, color: colors.text, lineHeight: 1 }}>
              {cred.daysRemaining}
            </p>
            <p style={{ fontSize: 10, color: colors.text, marginTop: 1 }}>days left</p>
          </div>
        )}
      </div>

      <div style={{ margin: '12px 0 8px', height: 4, background: '#e5e5e5', borderRadius: 99 }}>
        <div style={{ height: '100%', background: colors.bar, borderRadius: 99, width: `${pct}%`, transition: 'width 0.3s' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 12, color: '#666' }}>
          {cred.expiryDate ? `Expires ${formatDate(cred.expiryDate)}` : 'No expiry'}
        </p>
        {cred.renewalUrl && cred.daysRemaining != null && cred.daysRemaining < 60 && (
          <a href={cred.renewalUrl} target="_blank" rel="noreferrer" style={{
            fontSize: 12, color: '#1a5fb4', display: 'flex', alignItems: 'center', gap: 4,
            textDecoration: 'none', fontWeight: 600,
          }}>
            Renew now <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  )
}
