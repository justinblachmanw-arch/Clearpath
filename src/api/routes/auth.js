require('dotenv').config()
const { Router } = require('express')
const jwt      = require('jsonwebtoken')
const bcrypt   = require('bcryptjs')
const Joi      = require('joi')
const db       = require('../../db')

const router = Router()

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().required()
})

router.post('/auth/login', async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body)
    if (error) return res.status(400).json({ error: error.details[0].message })

    const { email, password } = value

    const result = await db.query(
      'SELECT id, name, email, specialty, password_hash FROM providers WHERE email = $1',
      [email]
    )
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    const provider = result.rows[0]

    // If password_hash is set verify it; otherwise accept any password (bootstrapping)
    if (provider.password_hash) {
      const valid = await bcrypt.compare(password, provider.password_hash)
      if (!valid) return res.status(401).json({ error: 'Invalid email or password' })
    }

    const token = jwt.sign(
      { providerId: provider.id, name: provider.name, email: provider.email },
      process.env.JWT_SECRET || 'clearpath_jwt_secret_dev',
      { expiresIn: '24h' }
    )

    return res.json({
      token,
      provider: { id: provider.id, name: provider.name, email: provider.email, specialty: provider.specialty }
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
