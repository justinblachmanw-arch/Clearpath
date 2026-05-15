import { BotEvent, MedplumClient } from '@medplum/core'
import { Encounter, Composition, Condition } from '@medplum/fhirtypes'

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<Encounter>
): Promise<void> {
  const encounter = event.input

  // Only fire when encounter is finished
  if (encounter.status !== 'finished') return

  // Get SOAP note (Composition)
  const compositions = await medplum.searchResources('Composition', 'encounter=Encounter/' + encounter.id)
  const composition = compositions[0] as Composition | undefined
  if (!composition) return

  // Extract note sections
  const noteContent = {
    subjective: composition.section?.find(s => s.title === 'Subjective')?.text?.div || '',
    objective:  composition.section?.find(s => s.title === 'Objective')?.text?.div  || '',
    assessment: composition.section?.find(s => s.title === 'Assessment')?.text?.div || '',
    plan:       composition.section?.find(s => s.title === 'Plan')?.text?.div       || ''
  }

  // ICD-10 codes from linked Conditions
  const conditions = await medplum.searchResources('Condition', 'encounter=Encounter/' + encounter.id) as Condition[]
  const icd10Codes = conditions.map(c => c.code?.coding?.[0]?.code || '').filter(Boolean)

  // CPT code from Composition extension
  const cptCode = composition.extension?.find(
    e => e.url === 'https://clearpath.health/fhir/cpt-code'
  )?.valueString || '99213'

  const patientId = encounter.subject?.reference?.replace('Patient/', '')

  // Call claim scrub agent
  const response = await fetch('http://localhost:3001/api/agents/claimScrub', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': process.env['WEBHOOK_SECRET'] || ''
    },
    body: JSON.stringify({
      medplumEncounterId: encounter.id,
      medplumPatientId: patientId,
      noteContent,
      icd10Codes,
      cptCode,
      payerCode: 'AETNA',
      providerId: 1
    })
  })

  const result = await response.json()

  if (result.passed) {
    await medplum.createResource({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      priority: 'routine',
      code: { coding: [{ system: 'https://clearpath.health/tasks', code: 'claim-ready' }] },
      description: 'Claim passed scrub — ready for clearinghouse submission',
      for: patientId ? { reference: 'Patient/' + patientId } : undefined,
      focus: { reference: 'Encounter/' + encounter.id }
    })
  } else {
    for (const issue of (result.issues || [])) {
      await medplum.createResource({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        priority: 'urgent',
        code: { coding: [{ system: 'https://clearpath.health/tasks', code: 'claim-scrub-failed' }] },
        description: issue,
        for: patientId ? { reference: 'Patient/' + patientId } : undefined,
        focus: { reference: 'Encounter/' + encounter.id }
      })
    }
  }
}
