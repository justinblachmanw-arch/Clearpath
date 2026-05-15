export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#ffffff' }}>
      {children}
    </div>
  )
}
