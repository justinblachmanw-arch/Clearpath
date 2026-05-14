const { getDenialInfo, isPatientResponsibility, isContractualAdjustment, requiresAction } = require('./denialCodes')

function parseERA(era835) {
  const results = {
    payerName: era835.payerName,
    payerId: era835.payerId,
    checkNumber: era835.checkNumber,
    checkDate: era835.checkDate,
    totalPaid: 0,
    claims: []
  }

  for (const claim of era835.claims) {
    const parsedClaim = parseClaim(claim)
    results.totalPaid += parsedClaim.amountPaid
    results.claims.push(parsedClaim)
  }

  return results
}

function parseClaim(claim) {
  const parsedClaim = {
    claimId: claim.claimId,
    patientToken: claim.patientToken,
    dateOfService: claim.dateOfService,
    billedAmount: claim.billedAmount,
    amountPaid: 0,
    patientResponsibility: 0,
    contractualAdjustment: 0,
    status: 'paid',
    servicelines: [],
    actionItems: [],
    needsAttention: false
  }

  for (const line of claim.serviceLines) {
    const parsedLine = parseServiceLine(line)
    parsedClaim.amountPaid += parsedLine.amountPaid
    parsedClaim.patientResponsibility += parsedLine.patientResponsibility
    parsedClaim.contractualAdjustment += parsedLine.contractualAdjustment
    parsedClaim.servicelines.push(parsedLine)

    if (parsedLine.actionItems.length > 0) {
      parsedClaim.actionItems.push(...parsedLine.actionItems)
      parsedClaim.needsAttention = true
      parsedClaim.status = 'needs_action'
    }
  }

  if (parsedClaim.amountPaid === 0 && parsedClaim.patientResponsibility === 0) {
    parsedClaim.status = 'denied'
  }

  return parsedClaim
}

function parseServiceLine(line) {
  const parsedLine = {
    procedureCode: line.procedureCode,
    billedAmount: line.billedAmount,
    amountPaid: line.amountPaid || 0,
    patientResponsibility: 0,
    contractualAdjustment: 0,
    adjustments: [],
    actionItems: []
  }

  for (const adjustment of line.adjustments || []) {
    const code = adjustment.code
    const amount = adjustment.amount
    const info = getDenialInfo(code)

    const parsedAdjustment = {
      code,
      amount,
      short: info.short,
      plain: info.plain,
      fix: info.fix,
      appealable: info.appealable
    }

    parsedLine.adjustments.push(parsedAdjustment)

    if (isPatientResponsibility(code)) {
      parsedLine.patientResponsibility += amount
    } else if (isContractualAdjustment(code)) {
      parsedLine.contractualAdjustment += amount
    } else if (requiresAction(code)) {
      parsedLine.actionItems.push({
        code,
        amount,
        procedureCode: line.procedureCode,
        plain: info.plain,
        fix: info.fix,
        appealable: info.appealable,
        priority: amount > 200 ? 'high' : 'medium'
      })
    }
  }

  return parsedLine
}

function detectPatterns(parsedERAs) {
  const denialsByPayer = {}
  const denialsByCode = {}

  for (const era of parsedERAs) {
    const payer = era.payerName

    if (!denialsByPayer[payer]) {
      denialsByPayer[payer] = { total: 0, denied: 0, codes: {} }
    }

    for (const claim of era.claims) {
      denialsByPayer[payer].total++

      if (claim.needsAttention) {
        denialsByPayer[payer].denied++

        for (const action of claim.actionItems) {
          const code = action.code

          if (!denialsByPayer[payer].codes[code]) {
            denialsByPayer[payer].codes[code] = 0
          }
          denialsByPayer[payer].codes[code]++

          if (!denialsByCode[code]) {
            denialsByCode[code] = 0
          }
          denialsByCode[code]++
        }
      }
    }
  }

  const patterns = []

  for (const [payer, data] of Object.entries(denialsByPayer)) {
    const denialRate = data.total > 0 ? (data.denied / data.total) * 100 : 0

    if (denialRate > 15) {
      const topCode = Object.entries(data.codes).sort((a, b) => b[1] - a[1])[0]
      patterns.push({
        type: 'high_denial_rate',
        payer,
        denialRate: denialRate.toFixed(1),
        topCode: topCode ? topCode[0] : null,
        topCodeCount: topCode ? topCode[1] : 0,
        message: `${payer} denial rate is ${denialRate.toFixed(1)}% — ${topCode ? `most common reason: ${topCode[0]}` : ''}`
      })
    }
  }

  return patterns
}

module.exports = { parseERA, detectPatterns }