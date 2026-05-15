'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/lib/auth'
import { useClaims } from '@/hooks/useClaims'
import { apiDenialTrend } from '@/lib/api'
import { DenialTrend } from '@/lib/types'
import { Topbar } from '@/components/layout/Topbar'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { ClaimsTable } from '@/components/claims/ClaimsTable'
import { ARAgingChart } from '@/components/claims/ARAgingChart'
import { PageLoader, ErrorMessage } from '@/components/ui/LoadingSpinner'
import { formatCurrency } from '@/lib/utils'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'

const FILTERS = ['all', 'denied', 'needs_action', 'pending'] as const
type Filter = typeof FILTERS[number]

export default function ClaimsPage() {
  const router = useRouter()
  useEffect(() => { if (!getToken()) router.replace('/login') }, [router])

  const [filter, setFilter] = useState<Filter>('all')
  const { data, isLoading, error } = useClaims(filter === 'all' ? undefined : { status: filter })

  const { data: denialTrend } = useQuery<DenialTrend>({
    queryKey: ['claims-denial-trend'],
    queryFn: apiDenialTrend,
    staleTime: 60_000,
  })

  const claims = data?.claims ?? []
  const totalBilled    = claims.reduce((s, c) => s + c.billedAmount, 0)
  const totalCollected = claims.reduce((s, c) => s + c.paidAmount, 0)
  const totalPending   = claims.filter(c => c.status === 'pending').reduce((s, c) => s + c.billedAmount, 0)
  const totalDenied    = claims.filter(c => c.status === 'denied').reduce((s, c) => s + c.billedAmount, 0)

  const trend = denialTrend?.trend ?? []
  const currentRate = trend.length > 0 ? trend[trend.length - 1].denialRate : null
  const prevRate    = trend.length > 1 ? trend[trend.length - 2].denialRate : null
  const rateImproved = currentRate !== null && prevRate !== null && currentRate < prevRate

  return (
    <>
      <Topbar title="Claims Manager" subtitle={data ? `${data.total} claims · Revenue at risk: ${formatCurrency(data.revenueAtRisk)}` : undefined} />
      <div style={{ flex: 1, padding: 24, background: '#f5f5f5', overflowY: 'auto' }}>
        {isLoading && <PageLoader />}
        {error && <ErrorMessage message="Could not reach the API." />}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1200 }}>
            {/* ── Inline stats bar ── */}
            <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.12)', borderRadius: 8, display: 'flex' }}>
              {[
                { label: 'Total Billed', value: formatCurrency(totalBilled), color: '#1a1a1a' },
                { label: 'Collected',    value: formatCurrency(totalCollected), color: '#1e7e34' },
                { label: 'Pending',      value: formatCurrency(totalPending),   color: '#b45309' },
                { label: 'Denied',       value: formatCurrency(totalDenied),    color: '#c0392b' },
              ].map((stat, i, arr) => (
                <div key={stat.label} style={{
                  flex: 1, padding: '12px 16px',
                  borderRight: i < arr.length - 1 ? '0.5px solid rgba(0,0,0,0.08)' : undefined,
                }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{stat.label}</p>
                  <p style={{ fontSize: 18, fontWeight: 700, color: stat.color, letterSpacing: '-0.02em', lineHeight: 1.2 }}>{stat.value}</p>
                  {stat.label === 'Denied' && currentRate !== null && prevRate !== null && (
                    <p style={{ fontSize: 11, marginTop: 4, color: rateImproved ? '#1e7e34' : '#c0392b' }}>
                      {rateImproved ? '↓' : '↑'} {Math.abs(currentRate - prevRate).toFixed(1)}% denial rate vs last month
                    </p>
                  )}
                </div>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>A/R Aging</CardTitle>
              </CardHeader>
              <ARAgingChart claims={claims} />
            </Card>

            {trend.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
                <Card>
                  <CardHeader>
                    <CardTitle>Denial Rate Trend</CardTitle>
                    {currentRate !== null && prevRate !== null && (
                      <span style={{ fontSize: 12, color: '#666' }}>
                        This month:&nbsp;
                        <strong style={{ color: rateImproved ? '#1e7e34' : '#c0392b' }}>
                          {currentRate}%
                        </strong>
                        &nbsp;vs {prevRate}%&nbsp;
                        <span style={{ fontSize: 14 }}>{rateImproved ? '↓' : '↑'}</span>
                      </span>
                    )}
                  </CardHeader>
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                        <YAxis unit="%" domain={[0, 25]} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => [`${Number(v)}%`, 'Denial Rate']} />
                        <ReferenceLine
                          y={15}
                          stroke="#c0392b"
                          strokeDasharray="4 4"
                          label={{ value: '15% target', position: 'insideTopRight', fontSize: 10, fill: '#c0392b' }}
                        />
                        <Line type="monotone" dataKey="denialRate" name="Denial Rate" stroke="#c0392b" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card>
                  <CardHeader><CardTitle>Top Denial Codes</CardTitle></CardHeader>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {(denialTrend?.topCodes ?? []).map(code => (
                      <div key={code.code} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                        padding: '8px 0', borderBottom: '1px solid #f0f0f0'
                      }}>
                        <div>
                          <p style={{ fontWeight: 600, fontSize: 13, color: '#1a1a1a' }}>{code.code}</p>
                          {code.description && (
                            <p style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{code.description}</p>
                          )}
                        </div>
                        <span style={{
                          fontSize: 13, color: '#c0392b', fontWeight: 700,
                          background: '#fef2f2', borderRadius: 6, padding: '2px 8px'
                        }}>{code.count}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            <Card padding={false}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', gap: 6 }}>
                {FILTERS.map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      padding: '5px 14px', fontSize: 12, fontWeight: 600,
                      borderRadius: 99, border: '1px solid',
                      borderColor: filter === f ? '#1a1a1a' : '#e5e5e5',
                      background: filter === f ? '#1a1a1a' : '#fff',
                      color: filter === f ? '#fff' : '#666',
                      cursor: 'pointer',
                    }}
                  >
                    {f === 'all' ? 'All' : f === 'needs_action' ? 'Missing Info' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <div style={{ padding: 0 }}>
                <ClaimsTable claims={claims} />
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  )
}
