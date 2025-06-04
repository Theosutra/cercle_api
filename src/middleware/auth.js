const jwt = require('jsonwebtoken');
const prisma = require('../utils/database');
const logger = require('../utils/logger');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await prisma.user.findUnique({
      where: { id_user: decoded.userId },
      select: { 
        id_user: true, 
        username: true, 
        mail: true, 
        id_role: true,
        is_active: true 
      }
    });

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: 'Invalid token' });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Token expired' });
    }
    
    return res.status(403).json({ error: 'Token verification failed' });
  }
};

const authorizeRoles = (...roleNames) => {
  return async (req, res, next) => {
    try {
      const userRole = await prisma.role.findUnique({
        where: { id_role: req.user.id_role }
      });

      if (!userRole || !roleNames.includes(userRole.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      next();
    } catch (error) {
      logger.error('Authorization error:', error);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
  };
};

// Middleware optionnel pour les routes publiques qui peuvent bénéficier d'un utilisateur connecté
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id_user: decoded.userId },
        select: { 
          id_user: true, 
          username: true, 
          mail: true, 
          id_role: true,
          is_active: true 
        }
      });

      if (user && user.is_active) {
        req.user = user;
      }
    }
    
    next();
  } catch (error) {
    // En cas d'erreur, on continue sans utilisateur authentifié
    next();
  }
};

module.exports = { authenticateToken, authorizeRoles, optionalAuth };