import { BotEvent, MedplumClient } from '@medplum/core'
import { ExplanationOfBenefit } from '@medplum/fhirtypes'

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<ExplanationOfBenefit>
): Promise<void> {
  const eob = event.input

  const payerName  = eob.insurer?.display || 'Unknown Payer'
  const patientRef = eob.patient?.reference

  // Map FHIR EOB items to our ERA format
  const eraData = {
    payerName,
    payerId:     eob.insurer?.identifier?.value || 'UNKNOWN',
    checkNumber: eob.identifier?.[0]?.value || 'EOB-' + eob.id,
    checkDate:   new Date().toISOString().split('T')[0],
    claims: (eob.item || []).map(item => ({
      claimId:      'EOB-' + eob.id + '-' + item.sequence,
      patientToken: patientRef?.replace('Patient/', 'PT-') || 'PT-UNKNOWN',
      dateOfService: item.servicedDate || new Date().toISOString().split('T')[0],
      billedAmount:  item.unitPrice?.value || 0,
      serviceLines: [{
        procedureCode: item.productOrService?.coding?.[0]?.code || 'UNKNOWN',
        billedAmount:  item.unitPrice?.value || 0,
        amountPaid:    item.adjudication?.find(
          a => a.category?.coding?.[0]?.code === 'benefit'
        )?.amount?.value || 0,
        adjustments: (item.adjudication || [])
          .filter(a => a.reason?.coding?.[0]?.code)
          .map(a => ({ code: a.reason?.coding?.[0]?.code || 'CO-45', amount: a.amount?.value || 0 }))
      }]
    }))
  }

  // Call our ERA webhook endpoint
  const response = await fetch('http://localhost:3001/api/webhooks/era', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': process.env['WEBHOOK_SECRET'] || ''
    },
    body: JSON.stringify({
      ediContent: null,
      eraData,
      payerName,
      payerId: eob.insurer?.identifier?.value
    })
  })

  const result = await response.json()

  // Create FHIR Task for each denial action item
  for (const item of (result.actionItems || [])) {
    await medplum.createResource({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      priority: item.priority === 'high' ? 'urgent' : 'routine',
      code: { coding: [{ system: 'https://clearpath.health/tasks', code: 'claim-denied' }] },
      description: item.plain,
      note: [{ text: item.aiInstruction }],
      for: patientRef ? { reference: patientRef } : undefined
    })
  }
}
