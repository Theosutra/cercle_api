const prisma = require('../utils/database');
const logger = require('../utils/logger');

/**
 * Middleware pour vérifier si l'utilisateur est admin ou modérateur
 */
const requireAdminOrModerator = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id_user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Vous devez être connecté pour accéder au backoffice'
      });
    }

    // Récupérer l'utilisateur avec son rôle
    const user = await prisma.user.findFirst({
      where: {
        id_user: req.user.id_user,
        is_active: true
      },
      include: {
        role: true
      }
    });

    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        message: 'Utilisateur non trouvé ou inactif'
      });
    }

    // Vérifier si l'utilisateur a un rôle admin ou modérateur
    const allowedRoles = ['ADMIN', 'MODERATOR'];
    if (!allowedRoles.includes(user.role.role)) {
      logger.warn(`Access denied to backoffice for user: ${user.username} (${user.role.role})`);
      return res.status(403).json({
        error: 'Access denied',
        message: 'Accès réservé aux administrateurs et modérateurs'
      });
    }

    // Ajouter les informations de rôle à la requête
    req.user.role = user.role.role;
    req.user.isAdmin = user.role.role === 'ADMIN';
    req.user.isModerator = user.role.role === 'MODERATOR';

    logger.info(`Backoffice access granted to ${user.username} (${user.role.role})`);
    next();

  } catch (error) {
    logger.error('Admin middleware error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Erreur lors de la vérification des permissions'
    });
  }
};

/**
 * Middleware pour vérifier si l'utilisateur est strictement admin
 */
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id_user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Vous devez être connecté'
      });
    }

    // Récupérer l'utilisateur avec son rôle
    const user = await prisma.user.findFirst({
      where: {
        id_user: req.user.id_user,
        is_active: true
      },
      include: {
        role: true
      }
    });

    if (!user || user.role.role !== 'ADMIN') {
      logger.warn(`Admin access denied for user: ${user?.username || 'unknown'} (${user?.role?.role || 'unknown'})`);
      return res.status(403).json({
        error: 'Access denied',
        message: 'Accès réservé aux administrateurs'
      });
    }

    req.user.role = user.role.role;
    req.user.isAdmin = true;

    next();

  } catch (error) {
    logger.error('Admin-only middleware error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Erreur lors de la vérification des permissions'
    });
  }
};

/**
 * Middleware pour rediriger automatiquement vers le backoffice si admin/modo
 */
const checkAdminRedirect = async (req, res, next) => {
  try {
    // Ne pas rediriger si déjà sur une route du backoffice
    if (req.path.startsWith('/api/v1/admin')) {
      return next();
    }

    if (!req.user || !req.user.id_user) {
      return next();
    }

    // Récupérer l'utilisateur avec son rôle
    const user = await prisma.user.findFirst({
      where: {
        id_user: req.user.id_user,
        is_active: true
      },
      include: {
        role: true
      }
    });

    if (user && ['ADMIN', 'MODERATOR'].includes(user.role.role)) {
      // Ajouter un header pour indiquer au frontend qu'il faut rediriger
      res.setHeader('X-Admin-Redirect', 'true');
      res.setHeader('X-User-Role', user.role.role);
    }

    next();

  } catch (error) {
    logger.error('Admin redirect check error:', error);
    next(); // Continuer même en cas d'erreur
  }
};

module.exports = {
  requireAdminOrModerator,
  requireAdmin,
  checkAdminRedirect
};