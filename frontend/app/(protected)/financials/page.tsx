'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/lib/auth'
import { apiFinancials, apiMonthlyTrend, apiPayerTrend } from '@/lib/api'
import { FinancialSummary, MonthlyTrend, PayerTrend } from '@/lib/types'
import { Topbar } from '@/components/layout/Topbar'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { ExpensesList } from '@/components/financials/ExpensesList'
import { PageLoader, ErrorMessage } from '@/components/ui/LoadingSpinner'
import { formatCurrency, toTitleCase } from '@/lib/utils'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer, Cell,
} from 'recharts'

const PAYER_COLORS = ['#185FA5', '#639922', '#A32D2D', '#7c3aed', '#0891b2', '#be185d']

function MoMTrend({ trend, field }: { trend?: MonthlyTrend[]; field: 'revenue' | 'expenses' | 'net' }) {
  if (!trend || trend.length < 2) return null
  const prev = trend[trend.length - 2][field]
  const curr = trend[trend.length - 1][field]
  if (!prev) return null
  const pct = Math.round(((curr - prev) / Math.abs(prev)) * 100)
  const up  = pct > 0
  const color = field === 'expenses'
    ? (up ? '#c0392b' : '#1e7e34')
    : (up ? '#1e7e34' : '#c0392b')
  return (
    <p style={{ fontSize: 11, marginTop: 5, color }}>
      {up ? '↑' : '↓'} {Math.abs(pct)}% vs last month
    </p>
  )
}

function TopMetric({ label, value, color, trend, field }: {
  label: string; value: string; color: string
  trend?: MonthlyTrend[]; field: 'revenue' | 'expenses' | 'net'
}) {
  return (
    <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.12)', borderRadius: 8, padding: '14px 16px' }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color, lineHeight: 1.2 }}>{value}</p>
      <MoMTrend trend={trend} field={field} />
    </div>
  )
}

export default function FinancialsPage() {
  const router = useRouter()
  useEffect(() => { if (!getToken()) router.replace('/login') }, [router])

  const { data, isLoading, error } = useQuery<FinancialSummary>({
    queryKey: ['financials'],
    queryFn: apiFinancials,
    staleTime: 60_000,
  })

  const { data: trend } = useQuery<MonthlyTrend[]>({
    queryKey: ['financials-trend'],
    queryFn: apiMonthlyTrend,
    staleTime: 60_000,
  })

  const { data: payerTrend } = useQuery<PayerTrend>({
    queryKey: ['financials-payer-trend'],
    queryFn: apiPayerTrend,
    staleTime: 60_000,
  })

  const payerBarData = data?.revenueByPayer.map(p => ({
    payer:     toTitleCase(p.payer),
    Billed:    p.billed,
    Collected: p.collected,
  })) ?? []

  const payerStackData = payerTrend
    ? payerTrend.months.map((m, i) => {
        const point: Record<string, string | number> = { month: m }
        payerTrend.series.forEach(s => { point[toTitleCase(s.payer)] = s.data[i] })
        return point
      })
    : []

  return (
    <>
      <Topbar title="Financials" subtitle="Revenue, expenses, and net income" />
      <div style={{ flex: 1, padding: 24, background: '#f5f5f5', overflowY: 'auto' }}>
        {isLoading && <PageLoader />}
        {error && <ErrorMessage message="Could not reach the API." />}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100 }}>

            {/* ── Top 3 metric cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              <TopMetric label="Revenue Collected" value={formatCurrency(data.revenueCollected)} color="#1e7e34" trend={trend} field="revenue" />
              <TopMetric label="Total Expenses"    value={formatCurrency(data.totalExpenses)}    color="#c0392b" trend={trend} field="expenses" />
              <TopMetric label="Net Income"        value={formatCurrency(data.netIncome)}        color={data.netIncome >= 0 ? '#1e7e34' : '#c0392b'} trend={trend} field="net" />
            </div>

            {/* ── Revenue trend chart ── */}
            {trend && trend.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>6-Month Trend</CardTitle>
                </CardHeader>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="0" horizontal={true} vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={v => `$${(Number(v)/1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(v) => formatCurrency(Number(v))}
                        contentStyle={{ fontSize: 12, border: '0.5px solid #e5e5e5', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                        labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                      />
                      <Legend iconSize={12} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                      <Line type="monotone" dataKey="revenue"  name="Revenue"    stroke="#639922" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="expenses" name="Expenses"   stroke="#A32D2D" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="net"      name="Net Income" stroke="#185FA5" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {/* ── Revenue by payer horizontal bar ── */}
            {payerBarData.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Revenue by Payer</CardTitle></CardHeader>
                <div style={{ height: Math.max(160, payerBarData.length * 52) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={payerBarData} layout="vertical" margin={{ top: 4, right: 60, left: 100, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="0" horizontal={false} vertical={true} stroke="#f0f0f0" />
                      <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="payer" tick={{ fontSize: 12, fill: '#555' }} width={96} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(v) => formatCurrency(Number(v))}
                        contentStyle={{ fontSize: 12, border: '0.5px solid #e5e5e5', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                      />
                      <Legend iconSize={12} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                      <Bar dataKey="Billed"    fill="#e5e5e5" radius={[0, 3, 3, 0]} barSize={12} />
                      <Bar dataKey="Collected" fill="#185FA5" radius={[0, 3, 3, 0]} barSize={12} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {/* ── Monthly visits bar ── */}
            {trend && trend.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Monthly Visits</CardTitle></CardHeader>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="0" horizontal={true} vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(v) => [`${Number(v)} visits`, 'Visits']}
                        contentStyle={{ fontSize: 12, border: '0.5px solid #e5e5e5', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                      />
                      <Bar dataKey="visits" name="Visits" fill="#185FA5" radius={[3, 3, 0, 0]} barSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {/* ── Expenses breakdown ── */}
            <Card>
              <CardHeader><CardTitle>Monthly Expenses Breakdown</CardTitle></CardHeader>
              <ExpensesList expenses={data.expenses} />
            </Card>

          </div>
        )}
      </div>
    </>
  )
}
