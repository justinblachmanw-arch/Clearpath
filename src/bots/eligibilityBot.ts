import { BotEvent, MedplumClient } from '@medplum/core'
import { Appointment, Patient, Coverage } from '@medplum/fhirtypes'

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<Appointment>
): Promise<void> {
  const appointment = event.input

  // Get patient reference from participants
  const patientRef = appointment.participant?.find(
    p => p.actor?.reference?.startsWith('Patient/')
  )?.actor?.reference
  if (!patientRef) return

  const patient = await medplum.readReference({ reference: patientRef }) as Patient

  // Get coverage (insurance)
  const coverages = await medplum.searchResources('Coverage', 'patient=' + patient.id)
  const coverage = coverages[0] as Coverage | undefined

  const memberId  = coverage?.subscriberId || 'UNKNOWN'
  const payerCode = coverage?.payor?.[0]?.display || 'UNKNOWN'

  // Call our eligibility agent
  const response = await fetch('http://localhost:3001/api/agents/eligibility', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': process.env['WEBHOOK_SECRET'] || ''
    },
    body: JSON.stringify({
      medplumAppointmentId: appointment.id,
      medplumPatientId: patient.id,
      memberId,
      payerCode,
      dateOfBirth: patient.birthDate,
      appointmentDate: appointment.start
    })
  })

  const result = await response.json()

  // Patch Appointment with eligibility result
  await medplum.patchResource('Appointment', appointment.id!, [
    {
      op: 'add',
      path: '/extension',
      value: [
        { url: 'https://clearpath.health/fhir/eligibility-status',  valueString:  result.status || 'unknown' },
        { url: 'https://clearpath.health/fhir/eligibility-summary', valueString:  result.summary || '' },
        { url: 'https://clearpath.health/fhir/copay',               valueDecimal: result.copay ?? 0 }
      ]
    }
  ])

  // Create Flag + Task if insurance is not active
  if (result.status !== 'active') {
    await medplum.createResource({
      resourceType: 'Flag',
      status: 'active',
      code: {
        coding: [{ system: 'https://clearpath.health/flags', code: 'insurance-issue', display: 'Insurance verification issue' }]
      },
      subject: { reference: 'Patient/' + patient.id },
      period: { start: new Date().toISOString() }
    })

    await medplum.createResource({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      priority: 'urgent',
      code: { coding: [{ system: 'https://clearpath.health/tasks', code: 'insurance-verification' }] },
      description: 'Insurance verification failed: ' + (result.error || result.status),
      for: { reference: 'Patient/' + patient.id },
      focus: { reference: 'Appointment/' + appointment.id }
    })
  }
}
