'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken, getProvider, clearAuth } from '@/lib/auth'
import { Provider } from '@/lib/types'

export function useAuth(requireAuth = true) {
  const router = useRouter()
  const [provider, setProvider] = useState<Provider | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    const prov = getProvider()
    if (!token && requireAuth) {
      router.replace('/login')
      return
    }
    setProvider(prov)
    setIsLoading(false)
  }, [requireAuth, router])

  function logout() {
    clearAuth()
    router.replace('/login')
  }

  return { provider, isLoading, logout, token: getToken() }
}
