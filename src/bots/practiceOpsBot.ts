import { BotEvent, MedplumClient } from '@medplum/core'
import { Task } from '@medplum/fhirtypes'

export async function handler(
  medplum: MedplumClient,
  event: BotEvent
): Promise<void> {
  // Get all open FHIR Tasks
  const tasks = await medplum.searchResources(
    'Task',
    'status=requested,in-progress&_sort=-priority&_count=50'
  ) as Task[]

  const fhirTasks = tasks.map(t => ({
    id:          t.id,
    priority:    t.priority,
    description: t.description,
    code:        t.code?.coding?.[0]?.code,
    note:        t.note?.[0]?.text
  }))

  // Call our practice ops agent with FHIR task context
  const response = await fetch('http://localhost:3001/api/agents/practiceOps', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': process.env['WEBHOOK_SECRET'] || ''
    },
    body: JSON.stringify({ providerId: 1, fhirTasks })
  })

  const result = await response.json()

  // Create FHIR Communication resource for morning briefing
  await medplum.createResource({
    resourceType: 'Communication',
    status: 'completed',
    category: [{
      coding: [{ system: 'https://clearpath.health/communications', code: 'morning-briefing' }]
    }],
    payload: [{ contentString: result.summary }],
    sent: new Date().toISOString()
  })
}
