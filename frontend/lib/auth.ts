import { Provider } from './types'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('clearpath_token')
}

export function getProvider(): Provider | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem('clearpath_provider')
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function setAuth(token: string, provider: Provider) {
  localStorage.setItem('clearpath_token', token)
  localStorage.setItem('clearpath_provider', JSON.stringify(provider))
}

export function clearAuth() {
  localStorage.removeItem('clearpath_token')
  localStorage.removeItem('clearpath_provider')
}

export function isAuthenticated(): boolean {
  return !!getToken()
}
