'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiLogin } from '@/lib/api'
import { setAuth } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('dr.patel@clearpathhealth.com')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token, provider } = await apiLogin(email, password || 'password')
      setAuth(token, provider)
      router.replace('/dashboard')
    } catch {
      setError('Invalid credentials. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#f5f5f5',
    }}>
      <div style={{
        background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8,
        padding: '36px 32px', width: '100%', maxWidth: 380,
      }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a' }}>Clearpath Health</h1>
          <p style={{ fontSize: 13, color: '#666', marginTop: 4 }}>Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: 5 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{
                width: '100%', padding: '9px 12px', fontSize: 13,
                border: '1px solid #e5e5e5', borderRadius: 8, outline: 'none',
                background: '#f9f9f9',
              }}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: 5 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Any password (demo)"
              style={{
                width: '100%', padding: '9px 12px', fontSize: 13,
                border: '1px solid #e5e5e5', borderRadius: 8, outline: 'none',
                background: '#f9f9f9',
              }}
            />
          </div>

          {error && (
            <p style={{ fontSize: 12, color: '#c0392b', marginBottom: 10 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '10px', fontSize: 13, fontWeight: 600,
              background: loading ? '#999' : '#1a1a1a', color: '#fff',
              border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: 12,
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{ marginTop: 20, padding: 12, background: '#f5f5f5', borderRadius: 6 }}>
          <p style={{ fontSize: 11, color: '#666', fontWeight: 600 }}>Demo credentials</p>
          <p style={{ fontSize: 11, color: '#999', marginTop: 3 }}>dr.patel@clearpathhealth.com / any password</p>
        </div>
      </div>
    </div>
  )
}
