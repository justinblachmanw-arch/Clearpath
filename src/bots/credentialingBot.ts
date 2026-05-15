import { BotEvent, MedplumClient } from '@medplum/core'
import { Practitioner } from '@medplum/fhirtypes'

export async function handler(
  medplum: MedplumClient,
  event: BotEvent
): Promise<void> {
  const practitioners = await medplum.searchResources('Practitioner') as Practitioner[]

  for (const practitioner of practitioners) {
    const qualifications = practitioner.qualification || []

    for (const qual of qualifications) {
      const expiryDate = qual.period?.end
      if (!expiryDate) continue

      const daysRemaining = Math.floor(
        (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )

      if (daysRemaining > 90) continue

      // Skip if Task already exists for this credential
      const existing = await medplum.searchResources(
        'Task',
        'focus=Practitioner/' + practitioner.id + '&code=credential-expiry&status=requested'
      )
      if (existing.length > 0) continue

      const priority = daysRemaining < 30 ? 'stat' : daysRemaining < 60 ? 'asap' : 'routine'

      await medplum.createResource({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        priority,
        code: { coding: [{ system: 'https://clearpath.health/tasks', code: 'credential-expiry' }] },
        description: (qual.code?.text || 'Credential') + ' expires in ' + daysRemaining + ' days',
        focus: { reference: 'Practitioner/' + practitioner.id },
        restriction: { period: { end: expiryDate } }
      })
    }

    // Sync with PostgreSQL credentialing agent
    await fetch('http://localhost:3001/api/agents/credentialing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': process.env['WEBHOOK_SECRET'] || ''
      },
      body: JSON.stringify({ providerId: 1 })
    })
  }
}
