import { Metric } from '@/components/ui/Metric'
import { DashboardMetrics, Sparklines } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'

export function MetricsRow({ metrics, sparklines }: { metrics: DashboardMetrics; sparklines?: Sparklines }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
      <Metric
        label="Today's Revenue"
        value={formatCurrency(metrics.todayRevenue)}
        valueColor="#1e7e34"
        sparkline={sparklines?.revenue}
        sparklineColor="#1e7e34"
      />
      <Metric
        label="Claims Needing Action"
        value={String(metrics.claimsNeedingAction)}
        valueColor={metrics.claimsNeedingAction > 0 ? '#c0392b' : '#1a1a1a'}
        sparkline={sparklines?.claimsAction}
        sparklineColor="#c0392b"
      />
      <Metric
        label="Outstanding A/R"
        value={formatCurrency(metrics.outstandingAR)}
        valueColor="#b45309"
      />
      <Metric
        label="Clean Claim Rate"
        value={`${metrics.cleanClaimRate}%`}
        valueColor={metrics.cleanClaimRate >= 90 ? '#1e7e34' : '#b45309'}
        sparkline={sparklines?.cleanClaimRate}
        sparklineColor={metrics.cleanClaimRate >= 90 ? '#1e7e34' : '#b45309'}
      />
    </div>
  )
}
