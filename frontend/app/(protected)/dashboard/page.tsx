'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import { useDashboard } from '@/hooks/useDashboard'
import { Topbar } from '@/components/layout/Topbar'
import { MetricsRow } from '@/components/dashboard/MetricsRow'
import { ScheduleCard } from '@/components/dashboard/ScheduleCard'
import { ActionItemsCard } from '@/components/dashboard/ActionItemsCard'
import { AIInsightBar } from '@/components/dashboard/AIInsightBar'
import { PageLoader, ErrorMessage } from '@/components/ui/LoadingSpinner'

export default function DashboardPage() {
  const router = useRouter()
  useEffect(() => { if (!getToken()) router.replace('/login') }, [router])

  const { data, isLoading, error } = useDashboard()

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const apptCount = data?.todayAppointments?.length ?? 0

  return (
    <>
      <Topbar
        title={data ? `Good morning, ${data.provider.name}` : 'Dashboard'}
        subtitle={`${today} · ${apptCount} appointment${apptCount !== 1 ? 's' : ''} today`}
      />
      <div style={{ flex: 1, padding: 24, background: '#f5f5f5', overflowY: 'auto' }}>
        {isLoading && <PageLoader />}
        {error && <ErrorMessage message="Could not reach the API. Make sure the server is running on port 3001." />}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1200 }}>
            <MetricsRow metrics={data.metrics} sparklines={data.sparklines} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <ScheduleCard appointments={data.todayAppointments} />
              <ActionItemsCard items={data.actionItems} />
            </div>

            {data.payerPatterns.length > 0 && (
              <AIInsightBar patterns={data.payerPatterns} />
            )}
          </div>
        )}
      </div>
    </>
  )
}
