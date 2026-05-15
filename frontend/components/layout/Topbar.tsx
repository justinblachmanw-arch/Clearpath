interface TopbarProps {
  title: string
  subtitle?: string
}

export function Topbar({ title, subtitle }: TopbarProps) {
  return (
    <div style={{
      height: 56, borderBottom: '1px solid #e5e5e5',
      display: 'flex', alignItems: 'center',
      padding: '0 24px', background: '#fff',
      flexShrink: 0,
    }}>
      <div>
        <h1 style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 12, color: '#999', marginTop: 1 }}>{subtitle}</p>}
      </div>
    </div>
  )
}
