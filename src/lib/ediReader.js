const { X12Parser } = require('node-x12')

function readERA835(rawEDI, payerOverrides = {}) {
  let interchange
  let parseWarning = null

  // Layer 1 — strict parsing
  try {
    const strictParser = new X12Parser(true)
    interchange = strictParser.parse(rawEDI.trim())
  } catch (strictErr) {
    // Layer 2 — lenient fallback
    try {
      const lenientParser = new X12Parser(false)
      interchange = lenientParser.parse(rawEDI.trim())
      parseWarning = `Non-standard EDI from ${payerOverrides.payerName || 'unknown payer'}: ${strictErr.message}. Processed with lenient parsing — flag for review.`
      console.warn(`[EDI READER] ${parseWarning}`)
    } catch (lenientErr) {
      throw new Error(`Failed to parse 835 EDI with both strict and lenient parsing: ${lenientErr.message}`)
    }
  }

  const era = {
    payerName: payerOverrides.payerName || null,
    payerId: payerOverrides.payerId || null,
    checkNumber: null,
    checkDate: null,
    parseWarning,
    claims: []
  }

  for (const group of interchange.functionalGroups) {
    for (const transaction of group.transactions) {
      const segments = transaction.segments

      for (const segment of segments) {
        const tag = segment.tag

        if (tag === 'N1') {
          const qualifier = getElement(segment, 0)
          if (qualifier === 'PR' && !payerOverrides.payerName) {
            era.payerName = getElement(segment, 1) || 'Unknown Payer'
            era.payerId = getElement(segment, 3) || 'UNKNOWN'
          }
        }

        if (tag === 'TRN') {
          era.checkNumber = getElement(segment, 1)
          era.checkDate = formatDate(getElement(segment, 2))
        }
      }

      era.claims = parseCLPLoops(segments)
    }
  }

  return era
}

function parseCLPLoops(segments) {
  const claims = []
  let currentClaim = null
  let currentServiceLine = null

  for (const segment of segments) {
    const tag = segment.tag

    if (tag === 'CLP') {
      // Save previous claim before starting new one
      if (currentClaim) {
        if (currentServiceLine) {
          currentClaim.serviceLines.push(currentServiceLine)
          currentServiceLine = null
        }
        promotClaimAdjustments(currentClaim)
        claims.push(currentClaim)
      }

      currentClaim = {
        claimId: getElement(segment, 0),
        patientToken: null,
        dateOfService: null,
        billedAmount: parseFloat(getElement(segment, 2)) || 0,
        amountPaid: parseFloat(getElement(segment, 3)) || 0,
        claimAdjustments: [],
        serviceLines: []
      }
    }

    // NM1 QC = patient — store member ID as token, never name
    if (tag === 'NM1' && currentClaim) {
      const qualifier = getElement(segment, 0)
      if (qualifier === 'QC') {
        const memberId = getElement(segment, 8)
        currentClaim.patientToken = 'PT-' + (memberId || 'UNKNOWN')
      }
    }

    // DTM 472 = date of service
    if (tag === 'DTM') {
      const qualifier = getElement(segment, 0)
      if (qualifier === '472') {
        const date = formatDate(getElement(segment, 1))
        if (currentClaim) currentClaim.dateOfService = date
      }
    }

    // CAS at claim level (before any SVC segment)
    if (tag === 'CAS' && currentClaim && !currentServiceLine) {
      currentClaim.claimAdjustments.push(...parseCASSegment(segment))
    }

    // SVC = new service line
    if (tag === 'SVC' && currentClaim) {
      if (currentServiceLine) {
        currentClaim.serviceLines.push(currentServiceLine)
      }

      currentServiceLine = {
        procedureCode: parseProcedureCode(getElement(segment, 0)),
        billedAmount: parseFloat(getElement(segment, 1)) || 0,
        amountPaid: parseFloat(getElement(segment, 2)) || 0,
        adjustments: []
      }
    }

    // CAS at service line level
    if (tag === 'CAS' && currentServiceLine) {
      currentServiceLine.adjustments.push(...parseCASSegment(segment))
    }
  }

  // Push final claim
  if (currentClaim) {
    if (currentServiceLine) {
      currentClaim.serviceLines.push(currentServiceLine)
    }
    promotClaimAdjustments(currentClaim)
    claims.push(currentClaim)
  }

  return claims
}

function promotClaimAdjustments(claim) {
  // If payer sent adjustments at claim level, push to first service line
  if (claim.claimAdjustments.length > 0 && claim.serviceLines.length > 0) {
    claim.serviceLines[0].adjustments.push(...claim.claimAdjustments)
  }
  // If no service lines at all, create one from claim-level data
  if (claim.claimAdjustments.length > 0 && claim.serviceLines.length === 0) {
    claim.serviceLines.push({
      procedureCode: 'UNKNOWN',
      billedAmount: claim.billedAmount,
      amountPaid: claim.amountPaid,
      adjustments: claim.claimAdjustments
    })
  }
}

function parseCASSegment(segment) {
  const adjustments = []
  const groupCode = getElement(segment, 0)

  if (!groupCode) return adjustments

  // CAS supports up to 6 reason/amount pairs
  // Structure: CAS01=group, CAS02=reason1, CAS03=amt1, CAS04=qty1,
  //            CAS05=reason2, CAS06=amt2, CAS07=qty2 ... etc
  // Pairs are at positions: [1,2] [4,5] [7,8] [10,11] [13,14] [16,17]
  const pairPositions = [
    [1, 2], [4, 5], [7, 8], [10, 11], [13, 14], [16, 17]
  ]

  for (const [codePos, amtPos] of pairPositions) {
    const code = getElement(segment, codePos)
    const amount = getElement(segment, amtPos)

    if (code && amount && parseFloat(amount) !== 0) {
      adjustments.push({
        code: normalizeAdjustmentCode(groupCode, code),
        amount: Math.abs(parseFloat(amount)) || 0
      })
    }
  }

  return adjustments
}

function normalizeAdjustmentCode(groupCode, reasonCode) {
  const code = String(reasonCode).trim()
  // Already normalized (e.g. CO-45)
  if (code.includes('-')) return code
  // Normalize group + code (e.g. CO + 45 = CO-45)
  return `${groupCode}-${code}`
}

function parseProcedureCode(svc01) {
  if (!svc01) return 'UNKNOWN'
  // Handle HC:99214 format or plain 99214
  if (svc01.includes(':')) return svc01.split(':')[1].trim()
  return svc01.trim()
}

function formatDate(rawDate) {
  if (!rawDate) return null
  // EDI dates are YYYYMMDD
  const d = String(rawDate).trim()
  if (d.length === 8) {
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  }
  return d
}

function getElement(segment, index) {
  try {
    if (!segment.elements || !segment.elements[index]) return null
    const el = segment.elements[index]
    // node-x12 elements may be strings directly or objects with value property
    if (typeof el === 'string') return el || null
    if (typeof el === 'object' && el !== null) {
      return el.value || el.element || String(el) || null
    }
    return null
  } catch {
    return null
  }
}

function getMockEDI835(scenario) {
  const scenarios = {
    aetna_mixed:
`ISA*00*          *00*          *ZZ*AETNA          *ZZ*1234567890     *260513*1200*^*00501*000000001*0*P*:~
GS*HP*AETNA*1234567890*20260513*1200*1*X*005010X221A1~
ST*835*0001~
BPR*I*182.00*C*ACH*CCP*01*123456789*DA*987654321*20260513~
TRN*1*CHK-88421*1234567890~
N1*PR*AETNA HEALTH PLAN*XV*AETNA~
N1*PE*DR PATEL PRIMARY CARE*XX*1234567890~
CLP*CLM-001*1*250.00*182.00*68.00*12*ABC123~
NM1*QC*1*SANTOS*MARIA****MI*AET992847~
DTM*472*20260501~
SVC*HC:99214*250.00*182.00**1~
CAS*CO*45*68.00~
AMT*B6*182.00~
CLP*CLM-002*4*250.00*0.00*250.00*12*ABC124~
NM1*QC*1*CHEN*JAMES****MI*AET887123~
DTM*472*20260502~
SVC*HC:99214*250.00*0.00**1~
CAS*CO*4*250.00~
CLP*CLM-003*4*250.00*0.00*250.00*12*ABC125~
NM1*QC*1*PARK*DAVID****MI*AET991234~
DTM*472*20260503~
SVC*HC:99214*250.00*0.00**1~
CAS*CO*97*250.00~
SE*22*0001~
GE*1*1~
IEA*1*000000001~`,

    medicare_clean:
`ISA*00*          *00*          *ZZ*MEDICARE       *ZZ*9876543210     *260513*1200*^*00501*000000002*0*P*:~
GS*HP*MEDICARE*9876543210*20260513*1200*2*X*005010X221A1~
ST*835*0002~
BPR*I*140.00*C*ACH*CCP*01*123456789*DA*987654321*20260513~
TRN*1*CHK-22819*9876543210~
N1*PR*MEDICARE*XV*MEDICARE~
N1*PE*DR PATEL PRIMARY CARE*XX*1234567890~
CLP*CLM-005*1*220.00*140.00*80.00*12*MED456~
NM1*QC*1*LEE*THOMAS****MI*1EG4TE5MK72~
DTM*472*20260505~
SVC*HC:99213*220.00*140.00**1~
CAS*CO*45*60.00~
CAS*PR*1*20.00~
AMT*B6*140.00~
SE*13*0002~
GE*1*2~
IEA*1*000000002~`
  }

  return scenarios[scenario] || null
}

module.exports = { readERA835, getMockEDI835 }