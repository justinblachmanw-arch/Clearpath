'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { RevenueByPayer as RBP } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'

export function RevenueByPayer({ data }: { data: RBP[] }) {
  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 80, bottom: 4 }}>
          <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="payer" tick={{ fontSize: 12 }} width={80} />
          <Tooltip formatter={(v) => formatCurrency(Number(v))} />
          <Legend />
          <Bar dataKey="billed"    name="Billed"    fill="#e5e5e5" radius={[0, 4, 4, 0]} />
          <Bar dataKey="collected" name="Collected" fill="#1e7e34" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
