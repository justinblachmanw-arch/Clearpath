'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'
import { useCredentials } from '@/hooks/useCredentials'
import { Topbar } from '@/components/layout/Topbar'
import { CredentialCard } from '@/components/credentials/CredentialCard'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PageLoader, ErrorMessage } from '@/components/ui/LoadingSpinner'
import { toTitleCase } from '@/lib/utils'

export default function CredentialsPage() {
  const router = useRouter()
  useEffect(() => { if (!getToken()) router.replace('/login') }, [router])

  const { data, isLoading, error } = useCredentials()

  return (
    <>
      <Topbar title="Credentials Tracker" subtitle="Licenses, enrollments, and certifications" />
      <div style={{ flex: 1, padding: 24, background: '#f5f5f5', overflowY: 'auto' }}>
        {isLoading && <PageLoader />}
        {error && <ErrorMessage message="Could not reach the API." />}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
              {data.credentials.map(c => (
                <CredentialCard key={c.id} cred={c} />
              ))}
            </div>

            {data.enrollments.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Payer Enrollments</CardTitle>
                </CardHeader>
                <div>
                  {data.enrollments.map((e, i) => (
                    <div key={e.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '9px 0',
                      borderBottom: i < data.enrollments.length - 1 ? '1px solid #f0f0f0' : undefined,
                    }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 500 }}>{toTitleCase(e.payerName)}</p>
                        <p style={{ fontSize: 11, color: '#999' }}>{e.payerCode}</p>
                      </div>
                      <Badge variant={e.status === 'active' ? 'success' : 'warning'}>{e.status}</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  )
}
