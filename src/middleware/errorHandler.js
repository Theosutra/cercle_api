const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  // Log l'erreur
  logger.error('Error occurred:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Erreurs Prisma
  if (err.code === 'P2002') {
    const field = err.meta?.target;
    return res.status(409).json({ 
      error: 'Duplicate entry', 
      message: `${field} already exists`,
      field 
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({ 
      error: 'Record not found',
      message: 'The requested resource does not exist'
    });
  }

  if (err.code === 'P2003') {
    return res.status(400).json({
      error: 'Foreign key constraint failed',
      message: 'Referenced record does not exist'
    });
  }

  // Erreurs JWT
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ 
      error: 'Invalid token',
      message: 'The provided token is malformed or invalid'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ 
      error: 'Token expired',
      message: 'The provided token has expired'
    });
  }

  // Erreurs de validation Joi
  if (err.name === 'ValidationError' || err.isJoi) {
    return res.status(400).json({ 
      error: 'Validation failed',
      message: err.details ? err.details[0].message : err.message,
      details: err.details 
    });
  }

  // Erreurs de syntaxe JSON
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'Invalid JSON',
      message: 'Request body contains invalid JSON'
    });
  }

  // Erreurs de limite de taille
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Payload too large',
      message: 'Request body exceeds maximum size limit'
    });
  }

  // Erreurs de bcrypt
  if (err.message && err.message.includes('bcrypt')) {
    return res.status(500).json({
      error: 'Authentication error',
      message: 'Password processing failed'
    });
  }

  // Erreur par défaut
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;

  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : 'Request failed',
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;