import { Expense } from '@/lib/types'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'

export function ExpensesList({ expenses }: { expenses: Expense[] }) {
  const total = expenses.reduce((s, e) => s + e.amount, 0)
  return (
    <div>
      {expenses.map((e, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 0',
          borderBottom: i < expenses.length - 1 ? '1px solid #f0f0f0' : undefined,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#1a1a1a' }}>{e.category}</span>
            <Badge variant={e.type === 'fixed' ? 'gray' : 'info'}>{e.type}</Badge>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{formatCurrency(e.amount)}</span>
        </div>
      ))}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        paddingTop: 10, marginTop: 4,
        borderTop: '2px solid #e5e5e5',
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Total Expenses</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#c0392b' }}>{formatCurrency(total)}</span>
      </div>
    </div>
  )
}
