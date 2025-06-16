// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

/**
 * ✅ CORRECTION: Middleware d'authentification requis
 * Vérifie que l'utilisateur est connecté et actif
 */
const authenticateToken = async (req, res, next) => {
  try {
    // Récupérer le token depuis le header Authorization
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        error: 'Access denied',
        message: 'No token provided'
      });
    }

    // Vérifier et décoder le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // Vérifier que l'utilisateur existe et est actif
    const user = await prisma.user.findFirst({
      where: { 
        id_user: decoded.id_user,
        is_active: true
      },
      select: {
        id_user: true,
        username: true,
        email: true,
        nom: true,
        prenom: true,
        photo_profil: true,
        certified: true,
        private: true,
        is_active: true
      }
    });

    if (!user) {
      return res.status(401).json({ 
        error: 'Access denied',
        message: 'User not found or inactive'
      });
    }

    // Ajouter l'utilisateur à la requête
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
 * ✅ CORRECTION: Middleware d'authentification optionnel
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
    
    // Vérifier que l'utilisateur existe et est actif
    const user = await prisma.user.findFirst({
      where: { 
        id_user: decoded.id_user,
        is_active: true
      },
      select: {
        id_user: true,
        username: true,
        email: true,
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
 * ✅ NOUVEAU: Middleware pour vérifier les permissions sur un post
 */
const checkPostPermissions = async (req, res, next) => {
  try {
    const { id: postId } = req.params;
    
    if (!postId) {
      return res.status(400).json({ error: 'Post ID is required' });
    }

    // Récupérer le post avec l'auteur
    const post = await prisma.post.findFirst({
      where: { 
        id_post: parseInt(postId),
        active: true
      },
      include: {
        author: {
          select: {
            id_user: true,
            private: true,
            is_active: true
          }
        }
      }
    });

    if (!post || !post.author.is_active) {
      return res.status(404).json({ error: 'Post not found or author inactive' });
    }

    // Si le post est d'un compte privé et que ce n'est pas le propriétaire
    if (post.author.private && (!req.user || post.author.id_user !== req.user.id_user)) {
      // Vérifier si l'utilisateur suit le compte privé
      if (req.user) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: post.author.id_user
            }
          },
          select: { active: true, pending: true }
        });

        if (!isFollowing || !isFollowing.active || isFollowing.pending) {
          return res.status(403).json({ error: 'Access denied to private post' });
        }
      } else {
        return res.status(403).json({ error: 'Access denied to private post' });
      }
    }

    req.post = post;
    next();

  } catch (error) {
    logger.error('Post permissions check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * ✅ NOUVEAU: Middleware pour vérifier la propriété d'un post
 */
const checkPostOwnership = async (req, res, next) => {
  try {
    const { id: postId } = req.params;
    
    if (!postId) {
      return res.status(400).json({ error: 'Post ID is required' });
    }

    // Récupérer le post
    const post = await prisma.post.findFirst({
      where: { 
        id_post: parseInt(postId),
        active: true,
        id_user: req.user.id_user // L'utilisateur doit être le propriétaire
      }
    });

    if (!post) {
      return res.status(404).json({ 
        error: 'Post not found or access denied',
        message: 'You can only modify your own posts'
      });
    }

    req.post = post;
    next();

  } catch (error) {
    logger.error('Post ownership check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * ✅ NOUVEAU: Middleware pour limiter les actions par utilisateur
 */
const rateLimitPerUser = (maxRequests = 10, windowMs = 60000) => {
  const userRequests = new Map();

  return (req, res, next) => {
    if (!req.user) {
      return next();
    }

    const userId = req.user.id_user;
    const now = Date.now();
    
    if (!userRequests.has(userId)) {
      userRequests.set(userId, []);
    }

    const userRequestTimes = userRequests.get(userId);
    
    // Nettoyer les anciennes requêtes
    while (userRequestTimes.length > 0 && now - userRequestTimes[0] > windowMs) {
      userRequestTimes.shift();
    }

    if (userRequestTimes.length >= maxRequests) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Limit: ${maxRequests} per ${windowMs/1000} seconds`
      });
    }

    userRequestTimes.push(now);
    next();
  };
};

/**
 * ✅ NOUVEAU: Middleware pour vérifier le rôle admin
 */
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Vérifier le rôle de l'utilisateur
    const userWithRole = await prisma.user.findFirst({
      where: { 
        id_user: req.user.id_user,
        is_active: true
      },
      include: {
        role: true
      }
    });

    if (!userWithRole || userWithRole.role.role !== 'administrator') {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'Administrator privileges required'
      });
    }

    next();

  } catch (error) {
    logger.error('Admin check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  authenticateToken,
  optionalAuth,
  checkPostPermissions,
  checkPostOwnership,
  rateLimitPerUser,
  requireAdmin
};