import { Sparkline } from './Sparkline'

interface MetricProps {
  label: string
  value: string
  sub?: string
  valueColor?: string
  sparkline?: number[]
  sparklineColor?: string
  trend?: number
}

export function Metric({ label, value, sub, valueColor = '#1a1a1a', sparkline, sparklineColor, trend }: MetricProps) {
  const trendUp   = trend != null && trend > 0
  const trendDown = trend != null && trend < 0

  return (
    <div style={{
      background: '#fff',
      border: '0.5px solid rgba(0,0,0,0.12)',
      borderRadius: 8,
      padding: '14px 16px',
    }}>
      <p style={{
        fontSize: 11, fontWeight: 600, color: '#999',
        textTransform: 'uppercase', letterSpacing: '0.07em',
        marginBottom: 6,
      }}>{label}</p>

      <p style={{
        fontSize: 20, fontWeight: 700,
        letterSpacing: '-0.02em',
        color: valueColor, lineHeight: 1.2,
      }}>{value}</p>

      {trend != null && (
        <p style={{
          fontSize: 11, marginTop: 5,
          color: trendUp ? '#1e7e34' : trendDown ? '#c0392b' : '#999',
        }}>
          {trendUp ? '↑' : trendDown ? '↓' : '—'} {Math.abs(trend)}% vs last month
        </p>
      )}

      {sub && !trend && <p style={{ fontSize: 11, color: '#999', marginTop: 3 }}>{sub}</p>}

      {sparkline && sparkline.length > 1 && (
        <Sparkline data={sparkline} color={sparklineColor || valueColor} />
      )}
    </div>
  )
}
