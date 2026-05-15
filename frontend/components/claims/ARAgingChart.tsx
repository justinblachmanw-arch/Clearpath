'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { formatCurrency } from '@/lib/utils'

const buckets = [
  { label: '0-30d',  color: '#1e7e34' },
  { label: '31-60d', color: '#b45309' },
  { label: '61-90d', color: '#c0392b' },
  { label: '90d+',   color: '#7f0000' },
]

interface ARAgingChartProps {
  claims: { billedAmount: number; paidAmount: number; dateOfService: string; status: string }[]
}

export function ARAgingChart({ claims }: ARAgingChartProps) {
  const today = new Date()
  const data = buckets.map(({ label, color }) => {
    const [lo, hi] = label === '90d+' ? [90, Infinity] : label.split('-').map(s => parseInt(s))
    const total = claims
      .filter(c => c.status !== 'paid')
      .filter(c => {
        const dos = new Date(c.dateOfService + 'T00:00:00')
        const age = (today.getTime() - dos.getTime()) / 86400000
        return age >= lo && age < hi
      })
      .reduce((s, c) => s + (c.billedAmount - c.paidAmount), 0)
    return { label, total, color }
  })

  return (
    <div style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 16, left: 16, bottom: 4 }}>
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => formatCurrency(Number(v))} />
          <Bar dataKey="total" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
