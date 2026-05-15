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
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/schedule',     label: 'Schedule',      icon: Calendar },
  { href: '/claims',       label: 'Claims',        icon: FileText },
  { href: '/credentials',  label: 'Credentials',   icon: Award },
  { href: '/financials',   label: 'Financials',    icon: BarChart2 },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { data } = useDashboard()

  const actionCount = data?.metrics?.claimsNeedingAction ?? 0
  const credAlerts  = data?.credentialAlerts?.filter(c => c.priority <= 1).length ?? 0

  function logout() { clearAuth(); router.replace('/login') }

  return (
    <aside style={{ width: 220, minHeight: '100vh', background: '#1a1a1a', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #333' }}>
        <p style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Clearpath</p>
        <p style={{ color: '#999', fontSize: 11, marginTop: 2 }}>Practice Management</p>
      </div>

      <nav style={{ flex: 1, padding: '8px 0' }}>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          const badge = href === '/claims' && actionCount > 0 ? actionCount
                      : href === '/credentials' && credAlerts > 0 ? credAlerts
                      : 0
          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 16px', textDecoration: 'none',
              background: active ? '#2a2a2a' : 'transparent',
              borderLeft: active ? '3px solid #fff' : '3px solid transparent',
              color: active ? '#fff' : '#999',
              fontSize: 13, fontWeight: active ? 600 : 400,
              transition: 'background 0.15s',
            }}>
              <Icon size={16} />
              <span style={{ flex: 1 }}>{label}</span>
              {badge > 0 && (
                <span style={{
                  background: '#c0392b', color: '#fff',
                  borderRadius: 99, fontSize: 10, fontWeight: 700,
                  padding: '1px 6px', minWidth: 18, textAlign: 'center'
                }}>{badge}</span>
              )}
            </Link>
          )
        })}
      </nav>

      <button onClick={logout} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', background: 'none', border: 'none',
        color: '#666', fontSize: 13, cursor: 'pointer', width: '100%',
        borderTop: '1px solid #333',
      }}>
        <LogOut size={15} />
        Sign out
      </button>
    </aside>
  )
}
