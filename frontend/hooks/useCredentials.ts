'use client'
import { useQuery } from '@tanstack/react-query'
import { apiCredentials } from '@/lib/api'
import { CredentialsData } from '@/lib/types'

export function useCredentials() {
  return useQuery<CredentialsData>({
    queryKey: ['credentials'],
    queryFn: apiCredentials,
    staleTime: 60_000,
  })
}
