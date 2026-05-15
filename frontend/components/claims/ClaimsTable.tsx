'use client'
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Claim } from '@/lib/types'
import { formatCurrency, formatShortDate, toTitleCase } from '@/lib/utils'

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  denied:       { bg: '#fef2f2', color: '#c0392b', border: '#fecaca' },
  needs_action: { bg: '#fffbeb', color: '#b45309', border: '#fde68a' },
  pending:      { bg: '#fffbeb', color: '#b45309', border: '#fde68a' },
  paid:         { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { bg: '#f5f5f5', color: '#666', border: '#e5e5e5' }
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 99,
      background: s.bg, color: s.color, border: `0.5px solid ${s.border}`,
    }}>
      {status === 'needs_action' ? 'Missing Info' : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function DenialPill({ code, plain }: { code: string; plain?: string | null }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, padding: '2px 7px', borderRadius: 4,
      background: '#fef2f2', color: '#c0392b',
      border: '0.5px solid #fecaca', fontWeight: 600,
    }}
      title={plain ?? undefined}
    >
      {code}
    </span>
  )
}

export function ClaimsTable({ claims }: { claims: Claim[] }) {
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
            {['Patient', 'Date', 'CPT', 'Billed', 'Paid', 'Status', 'Denial', ''].map(h => (
              <th key={h} style={{
                padding: '7px 12px', textAlign: 'left',
                fontSize: 11, fontWeight: 600, color: '#999',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {claims.map((c, i) => (
            <>
              <tr
                key={c.id}
                style={{ borderBottom: '1px solid #f5f5f5', background: '#fff', transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
              >
                <td style={{ padding: '9px 12px', fontWeight: 500, color: '#1a1a1a' }}>
                  {toTitleCase(c.patientName)}
                </td>
                <td style={{ padding: '9px 12px', color: '#888', whiteSpace: 'nowrap', fontSize: 12 }}>
                  {formatShortDate(c.dateOfService)}
                </td>
                <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontSize: 12 }}>
                  {c.procedureCode ?? '—'}
                </td>
                <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(c.billedAmount)}
                </td>
                <td style={{ padding: '9px 12px', color: '#888', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(c.paidAmount)}
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <StatusPill status={c.status} />
                </td>
                <td style={{ padding: '9px 12px' }}>
                  {c.denialCode ? <DenialPill code={c.denialCode} plain={c.denialPlain} /> : <span style={{ color: '#d1d5db' }}>—</span>}
                </td>
                <td style={{ padding: '9px 12px' }}>
                  {c.aiInstruction && (
                    <button
                      onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                      style={{
                        fontSize: 11, fontWeight: 500, color: '#1a5fb4',
                        background: 'none', border: '0.5px solid #bfdbfe',
                        borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 3,
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#eff6ff')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      AI fix {expanded === c.id ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    </button>
                  )}
                </td>
              </tr>
              {expanded === c.id && c.aiInstruction && (
                <tr key={`${c.id}-ai`} style={{ background: '#f8fbff' }}>
                  <td colSpan={8} style={{ padding: '10px 12px 10px 24px', borderBottom: '1px solid #e8f1fd' }}>
                    <p style={{ fontSize: 12, color: '#1a5fb4', lineHeight: 1.6 }}>
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
