// src/middleware/auth.js - CORRECTION FINALE
const jwt = require('jsonwebtoken');
const prisma = require('../utils/database');
const logger = require('../utils/logger');

/**
 * ✅ CORRECTION FINALE: Middleware d'authentification requis
 * Vérifie le token JWT et ajoute l'utilisateur à la requête
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ 
        error: 'Access denied',
        message: 'No token provided' 
      });
    }

    // Vérifier et décoder le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    console.log('🔍 Token decoded:', { id_user: decoded.id_user, username: decoded.username });
    
    // ✅ CORRECTION FINALE: Utiliser 'mail' au lieu d'email
    const user = await prisma.user.findFirst({
      where: { 
        id_user: decoded.id_user,
        is_active: true
      },
      select: {
        id_user: true,
        username: true,
        mail: true,          // ✅ CORRECTION: email -> mail
        nom: true,
        prenom: true,
        photo_profil: true,
        certified: true,
        private: true,
        is_active: true
      }
    });

    console.log('👤 User found from token:', user ? `${user.username} (ID: ${user.id_user})` : 'null');

    if (!user) {
      return res.status(401).json({ 
        error: 'Access denied',
        message: 'Invalid or expired token' 
      });
    }

    req.user = user;
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Access denied',
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Access denied',
        message: 'Token expired'
      });
    }

    logger.error('Authentication middleware error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Authentication failed'
    });
  }
};

/**
 * ✅ CORRECTION FINALE: Middleware d'authentification optionnel
 * Ajoute l'utilisateur à la requête s'il est connecté, sinon continue
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    // Vérifier et décoder le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // ✅ CORRECTION FINALE: Utiliser 'mail' au lieu d'email
    const user = await prisma.user.findFirst({
      where: { 
        id_user: decoded.id_user,
        is_active: true
      },
      select: {
        id_user: true,
        username: true,
        mail: true,          // ✅ CORRECTION: email -> mail
        nom: true,
        prenom: true,
        photo_profil: true,
        certified: true,
        private: true,
        is_active: true
      }
    });

    req.user = user || null;
    next();

  } catch (error) {
    // En cas d'erreur avec le token optionnel, on continue sans utilisateur
    req.user = null;
    next();
  }
};

/**
 * ✅ Middleware pour vérifier les permissions sur un post
 */
const checkPostPermissions = async (req, res, next) => {
  try {
    const { id: postId } = req.params;
    const userId = req.user?.id_user;

    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Vous devez être connecté pour accéder à ce contenu'
      });
    }

    const post = await prisma.post.findUnique({
      where: { id_post: parseInt(postId) },
      include: {
        user: {
          select: {
            id_user: true,
            private: true,
            is_active: true
          }
        }
      }
    });

    if (!post || !post.active) {
      return res.status(404).json({
        error: 'Post not found',
        message: 'Ce post n\'existe pas ou a été supprimé'
      });
    }

    // Vérifier si l'utilisateur peut voir ce post
    if (post.user.private && post.user.id_user !== userId) {
      // Vérifier si l'utilisateur suit l'auteur du post
      const isFollowing = await prisma.follow.findFirst({
        where: {
          follower: userId,
          account: post.user.id_user,
          active: true
        }
      });

      if (!isFollowing) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Ce contenu est privé'
        });
      }
    }

    req.post = post;
    next();

  } catch (error) {
    logger.error('Post permissions check error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Erreur lors de la vérification des permissions'
    });
  }
};

/**
 * ✅ Middleware pour vérifier les permissions sur un profil
 */
const checkProfilePermissions = async (req, res, next) => {
  try {
    const { id: profileId } = req.params;
    const userId = req.user?.id_user;
    const profileIdInt = parseInt(profileId);

    const profile = await prisma.user.findUnique({
      where: { id_user: profileIdInt },
      select: {
        id_user: true,
        username: true,
        private: true,
        is_active: true
      }
    });

    if (!profile || !profile.is_active) {
      return res.status(404).json({
        error: 'User not found',
        message: 'Cet utilisateur n\'existe pas'
      });
    }

    // Si le profil est privé et que ce n'est pas le propriétaire
    if (profile.private && profileIdInt !== userId) {
      // Vérifier si l'utilisateur connecté suit ce profil
      if (userId) {
        const isFollowing = await prisma.follow.findFirst({
          where: {
            follower: userId,
            account: profileIdInt,
            active: true
          }
        });

        if (!isFollowing) {
          return res.status(403).json({
            error: 'Private profile',
            message: 'Ce profil est privé'
          });
        }
      } else {
        return res.status(403).json({
          error: 'Private profile',
          message: 'Ce profil est privé'
        });
      }
    }

    req.profile = profile;
    next();

  } catch (error) {
    logger.error('Profile permissions check error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Erreur lors de la vérification des permissions'
    });
  }
};

/**
 * ✅ Middleware pour vérifier si l'utilisateur est le propriétaire
 */
const requireOwnership = (resourceType = 'resource') => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id_user;
      let resourceOwnerId;

      switch (resourceType) {
        case 'post':
          resourceOwnerId = req.post?.id_user;
          break;
        case 'profile':
          resourceOwnerId = req.profile?.id_user;
          break;
        case 'user':
          resourceOwnerId = parseInt(req.params.id);
          break;
        default:
          return res.status(400).json({
            error: 'Invalid resource type',
            message: 'Type de ressource invalide'
          });
      }

      if (!userId) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'Vous devez être connecté'
        });
      }

      if (userId !== resourceOwnerId) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Vous n\'avez pas les permissions nécessaires'
        });
      }

      next();

    } catch (error) {
      logger.error('Ownership check error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Erreur lors de la vérification des permissions'
      });
    }
  };
};

module.exports = {
  authenticateToken,
  optionalAuth,
  checkPostPermissions,
  checkProfilePermissions,
  requireOwnership
};