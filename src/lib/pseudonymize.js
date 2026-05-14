const crypto = require('crypto')

const tokenMap = new Map()
const reverseMap = new Map()

function pseudonymize(patientId) {
  if (tokenMap.has(patientId)) {
    return tokenMap.get(patientId)
  }
  const token = 'PT-' + crypto.randomBytes(4).toString('hex').toUpperCase()
  tokenMap.set(patientId, token)
  reverseMap.set(token, patientId)
  return token
}

function reIdentify(token) {
  return reverseMap.get(token) || null
}

module.exports = { pseudonymize, reIdentify }