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

      // Vérifier si un compte ACTIF existe déjà avec le même mail
      const existingUserByMail = await prisma.user.findFirst({
        where: {
          mail: mail,
          is_active: true
        }
      });

      if (existingUserByMail) {
        return res.status(409).json({ 
          error: 'User already exists',
          message: 'This email is already taken by an active account'
        });
      }

      // Vérifier si un compte ACTIF existe déjà avec le même username
      const existingUserByUsername = await prisma.user.findFirst({
        where: {
          username: username,
          is_active: true
        }
      });

      if (existingUserByUsername) {
        return res.status(409).json({ 
          error: 'User already exists',
          message: 'This username is already taken by an active account'
        });
      }

      // Vérifier si un compte ACTIF existe déjà avec le même numéro de téléphone (si fourni)
      if (telephone) {
        const existingUserByPhone = await prisma.user.findFirst({
          where: {
            telephone: telephone,
            is_active: true
          }
        });

        if (existingUserByPhone) {
          return res.status(409).json({ 
            error: 'User already exists',
            message: 'This phone number is already taken by an active account'
          });
        }
      }

      // Récupérer le rôle USER par défaut
      const userRole = await prisma.role.findFirst({
        where: { role: 'user' }
      });

      if (!userRole) {
        logger.error('Default USER role not found in database');
        return res.status(500).json({ error: 'System configuration error' });
      }

      // Récupérer la langue française par défaut
      const frLanguage = await prisma.langue.findFirst({
        where: { langue: 'fr' }
      });

      if (!frLanguage) {
        logger.error('French language not found in database');
        return res.status(500).json({ error: 'System configuration error' });
      }

      // Récupérer le thème light par défaut
      const lightTheme = await prisma.theme.findFirst({
        where: { theme: 'light' }
      });

      if (!lightTheme) {
        logger.error('Light theme not found in database');
        return res.status(500).json({ error: 'System configuration error' });
      }

      // Hasher le mot de passe
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const password_hash = await bcrypt.hash(password, saltRounds);

      const now = new Date();

      // Créer l'utilisateur avec une transaction pour assurer la cohérence
      const result = await prisma.$transaction(async (tx) => {
        // Créer l'utilisateur
        const user = await tx.user.create({
          data: {
            username,
            mail,
            password_hash,
            nom,
            prenom,
            telephone: telephone || null,
            bio: null,
            photo_profil: null,
            id_role: userRole.id_role,
            private: false, // Public par défaut
            certified: false, // Non certifié par défaut
            is_active: true,
            created_at: now,
            updated_at: now,
            last_login: now
          }
        });

        // Créer les préférences utilisateur par défaut
        await tx.userPreferences.create({
          data: {
            id_user: user.id_user,
            id_langue: frLanguage.id_langue,
            email_notification: false, // False par défaut
            id_theme: lightTheme.id_theme
          }
        });

        return user;
      });

      // Générer les tokens
      const { accessToken, refreshToken } = TokenService.generateTokens(result.id_user);

      logger.info(`New user registered: ${result.username} (${result.mail})`);

      // Retourner les informations sans le hash du mot de passe
      const { password_hash: _, ...userResponse } = result;

      res.status(201).json({
        message: 'User created successfully',
        user: userResponse,
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

      // Rechercher l'utilisateur ACTIF avec ce mail
      const user = await prisma.user.findFirst({
        where: { 
          mail: mail,
          is_active: true
        },
        include: { 
          role: true 
        }
      });

      if (!user) {
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

      // Vérifier si l'utilisateur n'a pas de ban en cours
      const currentDate = new Date();
      const activeBan = await prisma.userBannissement.findFirst({
        where: {
          user_banni: user.id_user,
          debut_ban: { lte: currentDate },
          fin_ban: { gte: currentDate }
        }
      });

      if (activeBan) {
        return res.status(403).json({ 
          error: 'Account banned',
          message: 'Your account is currently banned',
          banInfo: {
            reason: activeBan.raison,
            bannedUntil: activeBan.fin_ban
          }
        });
      }

      // Mettre à jour last_login
      await prisma.user.update({
        where: { id_user: user.id_user },
        data: { last_login: currentDate }
      });

      // Générer les tokens
      const { accessToken, refreshToken } = TokenService.generateTokens(user.id_user);

      logger.info(`User logged in: ${user.username} (${user.mail})`);

      // Retourner les informations sans le hash du mot de passe
      const { password_hash: __, ...userResponse } = user;

      res.json({
        message: 'Login successful',
        user: {
          id_user: userResponse.id_user,
          username: userResponse.username,
          mail: userResponse.mail,
          nom: userResponse.nom,
          prenom: userResponse.prenom,
          role: userResponse.role.role,
          certified: userResponse.certified,
          photo_profil: userResponse.photo_profil,
          private: userResponse.private
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

      const { password } = value;

      // Vérifier que l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Hasher le nouveau mot de passe
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const newPasswordHash = await bcrypt.hash(password, saltRounds);

      // Mettre à jour le mot de passe et updated_at
      await prisma.user.update({
        where: { id_user: req.user.id_user },
        data: { 
          password_hash: newPasswordHash,
          updated_at: new Date()
        }
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
   * Obtenir toutes les informations de l'utilisateur connecté
   */
  static async me(req, res) {
    try {
      const user = await prisma.user.findUnique({
        where: { id_user: req.user.id_user },
        include: { 
          role: true,
          user_preferences: {
            include: {
              langue: true,
              theme: true
            }
          },
          _count: {
            select: {
              posts: { where: { active: true } },
              followers: { where: { active: true, pending: false } },
              following: { where: { active: true, pending: false } },
              likes: true,
              messages_sent: { where: { active: true } },
              messages_received: { where: { active: true } }
            }
          }
        }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Retourner toutes les informations sans le hash du mot de passe
      const { password_hash: ___, ...userInfo } = user;

      res.json({
        ...userInfo,
        preferences: userInfo.user_preferences,
        stats: {
          posts: userInfo._count.posts,
          followers: userInfo._count.followers,
          following: userInfo._count.following,
          likes: userInfo._count.likes,
          messagesSent: userInfo._count.messages_sent,
          messagesReceived: userInfo._count.messages_received
        },
        user_preferences: undefined,
        _count: undefined
      });
    } catch (error) {
      logger.error('Get me error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = AuthController;
