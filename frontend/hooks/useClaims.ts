'use client'
import { useQuery } from '@tanstack/react-query'
import { apiClaims } from '@/lib/api'
import { ClaimsData } from '@/lib/types'

export function useClaims(params?: { status?: string; payer?: string }) {
  return useQuery<ClaimsData>({
    queryKey: ['claims', params],
    queryFn: () => apiClaims(params),
    staleTime: 30_000,
  })
}
