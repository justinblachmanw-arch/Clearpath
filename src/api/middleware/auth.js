require('dotenv').config()
const jwt = require('jsonwebtoken')

function verifyJWT(req, res, next) {
  const authHeader = req.headers['authorization']
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }
  const token = authHeader.slice(7)
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'clearpath_jwt_secret_dev')
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

module.exports = { verifyJWT }
