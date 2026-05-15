'use client'
import { useQuery } from '@tanstack/react-query'
import { apiDashboard } from '@/lib/api'
import { DashboardData } from '@/lib/types'

export function useDashboard() {
  return useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: apiDashboard,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}
