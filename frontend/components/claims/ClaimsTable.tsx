'use client'
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Claim } from '@/lib/types'
import { formatCurrency, formatShortDate } from '@/lib/utils'

function statusVariant(s: string) {
  if (s === 'denied')        return 'danger'  as const
  if (s === 'needs_action')  return 'warning' as const
  if (s === 'paid')          return 'success' as const
  return 'gray' as const
}

export function ClaimsTable({ claims }: { claims: Claim[] }) {
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <div style={{ border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f5f5f5', borderBottom: '1px solid #e5e5e5' }}>
            {['Patient', 'Date', 'CPT', 'Billed', 'Paid', 'Status', 'Denial', ''].map(h => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {claims.map((c, i) => (
            <>
              <tr
                key={c.id}
                style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}
              >
                <td style={{ padding: '9px 12px', fontWeight: 500 }}>{c.patientName}</td>
                <td style={{ padding: '9px 12px', color: '#666', whiteSpace: 'nowrap' }}>{formatShortDate(c.dateOfService)}</td>
                <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>{c.procedureCode ?? '—'}</td>
                <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{formatCurrency(c.billedAmount)}</td>
                <td style={{ padding: '9px 12px', color: '#666', whiteSpace: 'nowrap' }}>{formatCurrency(c.paidAmount)}</td>
                <td style={{ padding: '9px 12px' }}>
                  <Badge variant={statusVariant(c.status)}>{c.status.replace('_', ' ')}</Badge>
                </td>
                <td style={{ padding: '9px 12px', color: '#666', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.denialCode ? `${c.denialCode}: ${c.denialPlain ?? ''}` : '—'}
                </td>
                <td style={{ padding: '9px 12px' }}>
                  {c.aiInstruction && (
                    <button
                      onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                      style={{
                        fontSize: 11, fontWeight: 600, color: '#1a5fb4',
                        background: '#e8f1fd', border: 'none', borderRadius: 4,
                        padding: '3px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                      }}
                    >
                      AI fix {expanded === c.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </button>
                  )}
                </td>
              </tr>
              {expanded === c.id && c.aiInstruction && (
                <tr key={`${c.id}-ai`} style={{ background: '#f0f6ff' }}>
                  <td colSpan={8} style={{ padding: '10px 12px 10px 24px' }}>
                    <p style={{ fontSize: 12, color: '#1a5fb4', lineHeight: 1.5 }}>
                      <strong>AI Instruction:</strong> {c.aiInstruction}
                    </p>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      {claims.length === 0 && (
        <p style={{ padding: 24, color: '#999', textAlign: 'center', fontSize: 13 }}>No claims match this filter.</p>
      )}
    </div>
  )
}
