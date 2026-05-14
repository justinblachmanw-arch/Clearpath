require('dotenv').config()
const axios = require('axios')

async function checkEligibility({ memberId, dateOfBirth, appointmentDate, payerCode }) {
  return mockEligibilityResponse({ memberId, payerCode })
}

function mockEligibilityResponse({ memberId, payerCode }) {
  const scenarios = {
    'INACTIVE': {
      status: 'inactive',
      copay: null,
      deductible: null,
      deductibleMet: null,
      planName: null,
      error: 'Coverage inactive as of appointment date'
    },
    'NOTFOUND': {
      status: 'not_found',
      copay: null,
      deductible: null,
      deductibleMet: null,
      planName: null,
      error: 'Member ID not found'
    }
  }

  if (scenarios[memberId]) return scenarios[memberId]

  return {
    status: 'active',
    planName: payerCode === 'AETNA' ? 'Aetna PPO Select' : 'Standard PPO',
    copay: 30,
    deductible: 1200,
    deductibleMet: 340,
    deductibleRemaining: 860,
    requiresReferral: false,
    error: null
  }
}

module.exports = { checkEligibility }