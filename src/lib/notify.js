const twilio = require('twilio')

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

async function notifyPatient({ to, message }) {
  if (process.env.TWILIO_SANDBOX === 'true') {
    console.log(`[NOTIFY MOCK] To: ${to} | Message: ${message}`)
    return { success: true, mock: true }
  }

  const result = await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to
  })

  return { success: true, sid: result.sid }
}

function buildEligibilityMessage({ status, patientName, appointmentDate, copay, deductibleRemaining, error }) {
  if (status === 'active') {
    return `Hi ${patientName}, your insurance is verified for your ${appointmentDate} appointment. Copay: $${copay}. Remaining deductible: $${deductibleRemaining}. See you soon.`
  }

  if (status === 'inactive') {
    return `Hi ${patientName}, we had trouble verifying your insurance for your ${appointmentDate} appointment. ${error}. Please call us or update your insurance at the link below.`
  }

  if (status === 'not_found') {
    return `Hi ${patientName}, your member ID doesn't match what your insurer has on file. Please double-check your insurance card and reply with the correct ID or call us directly.`
  }

  return `Hi ${patientName}, please contact us about your upcoming appointment on ${appointmentDate}.`
}

module.exports = { notifyPatient, buildEligibilityMessage }