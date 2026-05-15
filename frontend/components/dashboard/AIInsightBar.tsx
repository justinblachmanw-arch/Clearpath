import { PayerPattern } from '@/lib/types'
import { AlertTriangle } from 'lucide-react'

export function AIInsightBar({ patterns }: { patterns: PayerPattern[] }) {
  if (patterns.length === 0) return null
  return (
    <div style={{
      background: '#e8f1fd', border: '1px solid #c5d8fa',
      borderRadius: 8, padding: '10px 14px',
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <AlertTriangle size={15} style={{ color: '#1a5fb4', flexShrink: 0, marginTop: 2 }} />
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#1a5fb4', marginBottom: 4 }}>
          AI Pattern Detection
        </p>
        {patterns.map((p, i) => (
          <p key={i} style={{ fontSize: 12, color: '#1a5fb4', lineHeight: 1.5 }}>{p.message}</p>
        ))}
      </div>
    </div>
  )
}
