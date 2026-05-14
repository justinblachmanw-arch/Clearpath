function errorHandler(err, req, res, next) {  // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500
  console.error(`[API] ${req.method} ${req.path} — ${status}: ${err.message}`)
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  })
}

module.exports = { errorHandler }
