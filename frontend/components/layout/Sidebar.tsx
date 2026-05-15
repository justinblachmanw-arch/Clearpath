'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Calendar, FileText, CreditCard,
  Award, BarChart2, LogOut
} from 'lucide-react'
import { clearAuth } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { useDashboard } from '@/hooks/useDashboard'

const nav = [
  { href: '/dashboard',    label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/schedule',     label: 'Schedule',     icon: Calendar },
  { href: '/claims',       label: 'Claims',       icon: FileText },
  { href: '/credentials',  label: 'Credentials',  icon: Award },
  { href: '/financials',   label: 'Financials',   icon: BarChart2 },
]

export function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const { data } = useDashboard()

  const actionCount = data?.metrics?.claimsNeedingAction ?? 0
  const credAlerts  = data?.credentialAlerts?.filter(c => c.priority <= 1).length ?? 0

  function logout() { clearAuth(); router.replace('/login') }

  return (
    <aside style={{
      width: 216, minHeight: '100vh',
      background: '#0f0f0f',
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid #222',
    }}>
      <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid #1e1e1e' }}>
        <p style={{ color: '#fff', fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em' }}>Clearpath</p>
        <p style={{ color: '#555', fontSize: 11, marginTop: 2 }}>Practice Management</p>
      </div>

      <nav style={{ flex: 1, padding: '6px 8px' }}>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          const badge  = href === '/claims'      && actionCount > 0 ? actionCount
                       : href === '/credentials' && credAlerts  > 0 ? credAlerts
                       : 0
          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '8px 10px', textDecoration: 'none', borderRadius: 6,
              background: active ? 'rgba(255,255,255,0.07)' : 'transparent',
              color: active ? '#fff' : '#666',
              fontSize: 13, fontWeight: 400,
              marginBottom: 1,
              transition: 'background 0.1s, color 0.1s',
            }}>
              <Icon size={15} strokeWidth={active ? 2 : 1.5} />
              <span style={{ flex: 1 }}>{label}</span>
              {badge > 0 && (
                <span style={{
                  background: '#c0392b', color: '#fff',
                  borderRadius: 99, fontSize: 10, fontWeight: 700,
                  padding: '1px 5px', minWidth: 16, textAlign: 'center',
                }}>{badge}</span>
              )}
            </Link>
          )
        })}
      </nav>

      <button onClick={logout} style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '11px 18px', background: 'none', border: 'none',
        color: '#444', fontSize: 13, cursor: 'pointer', width: '100%',
        borderTop: '1px solid #1e1e1e',
        transition: 'color 0.1s',
      }}
        onMouseEnter={e => (e.currentTarget.style.color = '#888')}
        onMouseLeave={e => (e.currentTarget.style.color = '#444')}
      >
        <LogOut size={14} />
        Sign out
      </button>
    </aside>
  )
}
