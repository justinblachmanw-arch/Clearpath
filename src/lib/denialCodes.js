const DENIAL_CODES = {
  'CO-4': {
    short: 'Procedure/modifier mismatch',
    plain: 'The procedure code and modifier combination is invalid. The modifier used does not apply to this procedure.',
    fix: 'Review the procedure code and modifier combination. Remove or correct the modifier and resubmit.',
    appealable: true
  },
  'CO-11': {
    short: 'Diagnosis inconsistent with procedure',
    plain: 'The diagnosis code does not support medical necessity for the procedure billed.',
    fix: 'Verify the diagnosis code accurately reflects the condition treated. Update and resubmit with the correct ICD-10 code.',
    appealable: true
  },
  'CO-15': {
    short: 'Authorization number missing',
    plain: 'The claim requires a prior authorization number that was not included.',
    fix: 'Obtain the prior authorization number from the payer and resubmit the claim with it included.',
    appealable: false
  },
  'CO-16': {
    short: 'Claim lacks information',
    plain: 'The claim is missing required information and cannot be processed.',
    fix: 'Review the claim for missing fields — commonly NPI, date of birth, or referring provider. Correct and resubmit.',
    appealable: false
  },
  'CO-22': {
    short: 'Coordination of benefits issue',
    plain: 'This patient has more than one insurance. The other insurance needs to process this claim first.',
    fix: 'Submit the claim to the primary insurance first. Once you have their explanation of benefits, resubmit to this payer.',
    appealable: false
  },
  'CO-29': {
    short: 'Claim filed too late',
    plain: 'The claim was submitted past the payer\'s timely filing deadline.',
    fix: 'Submit proof of timely filing — your clearinghouse acceptance report. File an appeal with that documentation.',
    appealable: true
  },
  'CO-45': {
    short: 'Charge exceeds contracted rate',
    plain: 'The billed amount is higher than your contracted rate with this payer. The difference is a contractual write-off.',
    fix: 'No action needed. Write off the adjusted amount per your contract. This is expected.',
    appealable: false
  },
  'CO-50': {
    short: 'Not medically necessary',
    plain: 'The payer determined this service was not medically necessary based on their coverage criteria.',
    fix: 'Appeal with clinical documentation supporting medical necessity. Reference the payer\'s own medical policy criteria.',
    appealable: true
  },
  'CO-96': {
    short: 'Non-covered charge',
    plain: 'This service is not covered under the patient\'s benefit plan.',
    fix: 'Verify patient benefits. If incorrectly denied appeal with policy documentation. Otherwise bill patient if permitted.',
    appealable: true
  },
  'CO-97': {
    short: 'Payment included in another service',
    plain: 'This procedure is considered bundled into another service already paid on this or a previous claim.',
    fix: 'Review whether the service was correctly billed separately. If clinically distinct, appeal with documentation supporting separate billing.',
    appealable: true
  },
  'CO-109': {
    short: 'Not covered by this payer',
    plain: 'The patient\'s plan does not cover this service.',
    fix: 'Verify patient benefits. If incorrectly denied, appeal. Otherwise bill the patient if allowed under your agreement.',
    appealable: true
  },
  'CO-167': {
    short: 'Diagnosis not covered',
    plain: 'The diagnosis code submitted is not covered under the patient\'s benefit plan.',
    fix: 'Review whether the diagnosis accurately reflects the encounter. If correct, appeal with clinical notes supporting medical necessity.',
    appealable: true
  },
  'CO-197': {
    short: 'Precertification absent',
    plain: 'This service required precertification or prior authorization that was not obtained.',
    fix: 'Obtain retroactive authorization if the payer allows it. Otherwise appeal with clinical urgency documentation.',
    appealable: true
  },
  'CO-236': {
    short: 'Procedure requires qualifying service',
    plain: 'This procedure requires another service to have been performed first which was not billed or documented.',
    fix: 'Review NCCI bundling edits. Ensure the qualifying service is documented and billed correctly.',
    appealable: true
  },
  'PR-1': {
    short: 'Patient deductible',
    plain: 'This amount has been applied to the patient\'s deductible. Bill the patient directly.',
    fix: 'Bill the patient for this amount. No appeal needed — this is standard deductible application.',
    appealable: false
  },
  'PR-2': {
    short: 'Patient coinsurance',
    plain: 'This is the patient\'s coinsurance responsibility after insurance payment.',
    fix: 'Bill the patient for this amount.',
    appealable: false
  },
  'PR-3': {
    short: 'Patient copay',
    plain: 'This is the patient\'s copay amount.',
    fix: 'Collect from patient at time of service or bill directly.',
    appealable: false
  },
  'OA-23': {
    short: 'Claim payment impact from prior claim',
    plain: 'Payment on this claim was adjusted because of a prior claim for the same patient.',
    fix: 'Review prior claims for this patient to identify the conflicting claim. Correct and resubmit.',
    appealable: true
  }
}

function getDenialInfo(code) {
  return DENIAL_CODES[code] || {
    short: 'Unknown adjustment code',
    plain: `Adjustment code ${code} was applied. Review the explanation of benefits from the payer for details.`,
    fix: 'Contact the payer for clarification on this adjustment code.',
    appealable: true
  }
}

function isPatientResponsibility(code) {
  return code.startsWith('PR-')
}

function isContractualAdjustment(code) {
  return code === 'CO-45'
}

function requiresAction(code) {
  const info = getDenialInfo(code)
  return info.appealable && !isContractualAdjustment(code)
}

module.exports = { getDenialInfo, isPatientResponsibility, isContractualAdjustment, requiresAction }