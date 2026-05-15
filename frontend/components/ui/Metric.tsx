import { Card } from './Card'
import { Sparkline } from './Sparkline'

interface MetricProps {
  label: string
  value: string
  sub?: string
  valueColor?: string
  sparkline?: number[]
  sparklineColor?: string
}

export function Metric({ label, value, sub, valueColor = '#1a1a1a', sparkline, sparklineColor }: MetricProps) {
  return (
    <Card>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color: valueColor }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      {sparkline && sparkline.length > 1 && (
        <Sparkline data={sparkline} color={sparklineColor || valueColor} />
      )}
    </Card>
  )
}
