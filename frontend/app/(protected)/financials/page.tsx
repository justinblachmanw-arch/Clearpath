'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getToken } from '@/lib/auth'
import { apiFinancials, apiMonthlyTrend, apiPayerTrend } from '@/lib/api'
import { FinancialSummary, MonthlyTrend, PayerTrend } from '@/lib/types'
import { Topbar } from '@/components/layout/Topbar'
import { Metric } from '@/components/ui/Metric'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { RevenueByPayer } from '@/components/financials/RevenueByPayer'
import { ExpensesList } from '@/components/financials/ExpensesList'
import { PageLoader, ErrorMessage } from '@/components/ui/LoadingSpinner'
import { formatCurrency } from '@/lib/utils'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

const PAYER_COLORS = ['#1e7e34', '#2563eb', '#b45309', '#7c3aed', '#0891b2', '#be185d']

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

  const payerStackData = payerTrend
    ? payerTrend.months.map((m, i) => {
        const point: Record<string, string | number> = { month: m }
        payerTrend.series.forEach(s => { point[s.payer] = s.data[i] })
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              <Metric label="Revenue Collected" value={formatCurrency(data.revenueCollected)} valueColor="#1e7e34" />
              <Metric label="Total Expenses"    value={formatCurrency(data.totalExpenses)}    valueColor="#c0392b" />
              <Metric label="Net Income"        value={formatCurrency(data.netIncome)}        valueColor={data.netIncome >= 0 ? '#1e7e34' : '#c0392b'} />
            </div>

            {trend && trend.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Revenue Trend (6 Months)</CardTitle></CardHeader>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={v => `$${(Number(v)/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                      <Legend />
                      <Line type="monotone" dataKey="revenue"  name="Revenue"    stroke="#1e7e34" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="expenses" name="Expenses"   stroke="#c0392b" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="net"      name="Net Income" stroke="#2563eb" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {trend && trend.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Card>
                  <CardHeader><CardTitle>Monthly Visits</CardTitle></CardHeader>
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trend} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => [`${Number(v)} visits`, 'Visits']} />
                        <Bar dataKey="visits" name="Visits" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card>
                  <CardHeader><CardTitle>Revenue by Payer</CardTitle></CardHeader>
                  <RevenueByPayer data={data.revenueByPayer} />
                </Card>
              </div>
            )}

            {payerTrend && payerTrend.months.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Revenue by Payer (6-Month Trend)</CardTitle></CardHeader>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={payerStackData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={v => `$${(Number(v)/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                      <Legend />
                      {payerTrend.series.map((s, i) => (
                        <Bar key={s.payer} dataKey={s.payer} stackId="a" fill={PAYER_COLORS[i % PAYER_COLORS.length]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {!trend && (
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
                <Card>
                  <CardHeader><CardTitle>Revenue by Payer</CardTitle></CardHeader>
                  <RevenueByPayer data={data.revenueByPayer} />
                </Card>
                <Card>
                  <CardHeader><CardTitle>Monthly Expenses</CardTitle></CardHeader>
                  <ExpensesList expenses={data.expenses} />
                </Card>
              </div>
            )}

            {trend && (
              <Card>
                <CardHeader><CardTitle>Monthly Expenses Breakdown</CardTitle></CardHeader>
                <ExpensesList expenses={data.expenses} />
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  )
}
