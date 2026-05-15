'use client'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { ActionItem } from '@/lib/types'

const BORDER_COLOR: Record<string, string> = {
  critical: '#c0392b',
  high:     '#e67e22',
  medium:   '#2563eb',
  low:      '#d1d5db',
}

const SOURCE_LABEL: Record<string, string> = {
  era_agent:         'ERA',
  claim_scrub:       'Claim',
  credentialing_agent: 'Cred',
  prior_auth_agent:  'Auth',
  referral_agent:    'Referral',
  practice_ops:      'Ops',
}

function priorityLevel(p: number): string {
  if (p <= 1) return 'critical'
  if (p <= 2) return 'high'
  if (p <= 3) return 'medium'
  return 'low'
}

export function ActionItemsCard({ items }: { items: ActionItem[] }) {
  const router = useRouter()
  return (
    <Card padding={false}>
      <div style={{ padding: '14px 16px 0' }}>
        <CardHeader>
          <CardTitle>Action Items</CardTitle>
          <span style={{ fontSize: 11, color: '#999' }}>{items.length} open</span>
        </CardHeader>
      </div>
      <div>
        {items.length === 0 && (
          <p style={{ color: '#999', fontSize: 13, padding: '16px' }}>All clear.</p>
        )}
        {items.slice(0, 10).map((item, i) => {
          const level        = priorityLevel(item.priority)
          const borderColor  = BORDER_COLOR[level] ?? '#d1d5db'
          const isClaimItem  = item.sourceAgent === 'era_agent' || item.sourceAgent === 'claim_scrub'
          const sourceLabel  = SOURCE_LABEL[item.sourceAgent] ?? item.sourceAgent?.replace('_agent', '') ?? 'system'

          return (
            <div
              key={item.id}
              onClick={() => isClaimItem ? router.push('/claims') : undefined}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 0,
                borderTop: i === 0 ? '1px solid #f0f0f0' : undefined,
                borderBottom: '1px solid #f5f5f5',
                cursor: isClaimItem ? 'pointer' : 'default',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => isClaimItem && (e.currentTarget.style.background = '#fafafa')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              {/* Left accent border */}
              <div style={{ width: 3, alignSelf: 'stretch', background: borderColor, flexShrink: 0, borderRadius: '0 2px 2px 0' }} />

              <div style={{ flex: 1, padding: '9px 12px 9px 11px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a', lineHeight: 1.3, flex: 1 }}>
                    {item.title}
                  </p>
                  <span style={{
                    fontSize: 10, color: '#999', flexShrink: 0,
                    background: '#f5f5f5', border: '0.5px solid #e0e0e0',
                    borderRadius: 4, padding: '1px 5px',
                    fontWeight: 500, letterSpacing: '0.02em',
                  }}>
                    {sourceLabel}
                  </span>
                </div>
                {item.description && (
                  <p style={{ fontSize: 12, color: '#888', marginTop: 3, lineHeight: 1.4 }}>
                    {item.description}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
