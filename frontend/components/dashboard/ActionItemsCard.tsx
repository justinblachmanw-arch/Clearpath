'use client'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { ActionItem } from '@/lib/types'

const dotColor: Record<string, string> = {
  critical: '#c0392b',
  high:     '#c0392b',
  medium:   '#b45309',
  low:      '#1a5fb4',
}

function priorityLabel(p: number): string {
  if (p <= 1) return 'critical'
  if (p <= 2) return 'high'
  if (p <= 3) return 'medium'
  return 'low'
}

export function ActionItemsCard({ items }: { items: ActionItem[] }) {
  const router = useRouter()
  return (
    <Card padding={false}>
      <div className="p-4 pb-0">
        <CardHeader>
          <CardTitle>Action Items</CardTitle>
          <span style={{ fontSize: 12, color: '#999' }}>{items.length} open</span>
        </CardHeader>
      </div>
      <div>
        {items.length === 0 && (
          <p style={{ color: '#999', fontSize: 13, padding: '16px 16px' }}>All clear.</p>
        )}
        {items.slice(0, 10).map((item, i) => {
          const level = priorityLabel(item.priority)
          const isClaimItem = item.sourceAgent === 'era_agent' || item.sourceAgent === 'claim_scrub'
          return (
            <div
              key={item.id}
              onClick={() => isClaimItem ? router.push('/claims') : undefined}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 16px',
                borderTop: i === 0 ? '1px solid #e5e5e5' : undefined,
                borderBottom: '1px solid #f0f0f0',
                cursor: isClaimItem ? 'pointer' : 'default',
              }}
              onMouseEnter={e => isClaimItem && (e.currentTarget.style.background = '#f9f9f9')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 5,
                background: dotColor[level] ?? '#999',
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a', lineHeight: 1.3 }}>
                  {item.title}
                </p>
                {item.description && (
                  <p style={{ fontSize: 12, color: '#666', marginTop: 2, lineHeight: 1.4 }}>
                    {item.description}
                  </p>
                )}
              </div>
              <span style={{
                fontSize: 10, color: '#999', flexShrink: 0, marginTop: 3,
                background: '#f0f0f0', borderRadius: 4, padding: '1px 5px',
              }}>
                {item.sourceAgent?.replace('_agent', '') ?? 'system'}
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
