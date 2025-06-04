const bcrypt = require('bcrypt');
const prisma = require('../utils/database');
const TokenService = require('../services/tokenService');
const { registerSchema, loginSchema, refreshSchema, changePasswordSchema } = require('../validators/authValidator');
const logger = require('../utils/logger');

class AuthController {
  /**
   * Inscription d'un nouvel utilisateur
   */
  static async register(req, res) {
    try {
      const { error, value } = registerSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { username, mail, password, nom, prenom, telephone } = value;

      // Vérifier si l'utilisateur existe déjà
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ mail }, { username }]
        }
      });

      if (existingUser) {
        const field = existingUser.mail === mail ? 'email' : 'username';
        return res.status(409).json({ 
          error: 'User already exists',
          message: `This ${field} is already taken`
        });
      }

      // Récupérer le rôle par défaut
      const userRole = await prisma.role.findFirst({
        where: { role: 'USER' }
      });

      if (!userRole) {
        logger.error('Default USER role not found in database');
        return res.status(500).json({ error: 'System configuration error' });
      }

      // Hasher le mot de passe
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const password_hash = await bcrypt.hash(password, saltRounds);

      // Créer l'utilisateur
      const user = await prisma.user.create({
        data: {
          username,
          mail,
          password_hash,
          nom: nom || null,
          prenom: prenom || null,
          telephone: telephone || null,
          id_role: userRole.id_role
        },
        select: {
          id_user: true,
          username: true,
          mail: true,
          nom: true,
          prenom: true,
          created_at: true
        }
      });

      // Générer les tokens
      const { accessToken, refreshToken } = TokenService.generateTokens(user.id_user);

      logger.info(`New user registered: ${user.username} (${user.mail})`);

      res.status(201).json({
        message: 'User created successfully',
        user,
        accessToken,
        refreshToken
      });
    } catch (error) {
      logger.error('Register error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Connexion d'un utilisateur
   */
  static async login(req, res) {
    try {
      const { error, value } = loginSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { mail, password } = value;

      // Rechercher l'utilisateur
      const user = await prisma.user.findUnique({
        where: { mail },
        include: { role: true }
      });

      if (!user || !user.is_active) {
        return res.status(401).json({ 
          error: 'Invalid credentials',
          message: 'Email or password is incorrect'
        });
      }

      // Vérifier le mot de passe
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        return res.status(401).json({ 
          error: 'Invalid credentials',
          message: 'Email or password is incorrect'
        });
      }

      // Générer les tokens
      const { accessToken, refreshToken } = TokenService.generateTokens(user.id_user);

      logger.info(`User logged in: ${user.username} (${user.mail})`);

      res.json({
        message: 'Login successful',
        user: {
          id_user: user.id_user,
          username: user.username,
          mail: user.mail,
          nom: user.nom,
          prenom: user.prenom,
          role: user.role.role,
          certified: user.certified,
          photo_profil: user.photo_profil
        },
        accessToken,
        refreshToken
      });
    } catch (error) {
      logger.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Rafraîchissement du token d'accès
   */
  static async refresh(req, res) {
    try {
      const { error, value } = refreshSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { refreshToken } = value;

      // Vérifier le refresh token
      const decoded = TokenService.verifyRefreshToken(refreshToken);
      
      // Vérifier que l'utilisateur existe toujours et est actif
      const user = await prisma.user.findUnique({
        where: { id_user: decoded.userId },
        select: { id_user: true, is_active: true }
      });

      if (!user || !user.is_active) {
        return res.status(401).json({ error: 'User not found or inactive' });
      }

      // Générer un nouveau token d'accès
      const { accessToken: newAccessToken } = TokenService.generateTokens(decoded.userId);

      res.json({ 
        accessToken: newAccessToken,
        message: 'Token refreshed successfully'
      });
    } catch (error) {
      logger.error('Refresh token error:', error);
      
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(403).json({ 
          error: 'Invalid refresh token',
          message: 'Please login again'
        });
      }
      
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Changement de mot de passe
   */
  static async changePassword(req, res) {
    try {
      const { error, value } = changePasswordSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { currentPassword, newPassword } = value;

      // Récupérer l'utilisateur avec son mot de passe
      const user = await prisma.user.findUnique({
        where: { id_user: req.user.id_user },
        select: { id_user: true, password_hash: true, username: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Vérifier le mot de passe actuel
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({ 
          error: 'Invalid current password',
          message: 'The current password you entered is incorrect'
        });
      }

      // Hasher le nouveau mot de passe
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

      // Mettre à jour le mot de passe
      await prisma.user.update({
        where: { id_user: req.user.id_user },
        data: { password_hash: newPasswordHash }
      });

      logger.info(`Password changed for user: ${user.username}`);

      res.json({ 
        message: 'Password changed successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Change password error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Déconnexion (côté client principalement, invalide les tokens)
   */
  static async logout(req, res) {
    try {
      logger.info(`User logged out: ${req.user.username}`);
      
      res.json({ 
        message: 'Logout successful',
        note: 'Please remove tokens from client storage'
      });
    } catch (error) {
      logger.error('Logout error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les informations de l'utilisateur connecté
   */
  static async me(req, res) {
    try {
      const user = await prisma.user.findUnique({
        where: { id_user: req.user.id_user },
        include: { 
          role: true,
          _count: {
            select: {
              posts: { where: { active: true } },
              followers: { where: { active: true, pending: false } },
              following: { where: { active: true, pending: false } }
            }
          }
        }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        id_user: user.id_user,
        username: user.username,
        mail: user.mail,
        nom: user.nom,
        prenom: user.prenom,
        bio: user.bio,
        photo_profil: user.photo_profil,
        private: user.private,
        certified: user.certified,
        role: user.role.role,
        created_at: user.created_at,
        stats: {
          posts: user._count.posts,
          followers: user._count.followers,
          following: user._count.following
        }
      });
    } catch (error) {
      logger.error('Get me error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = AuthController;