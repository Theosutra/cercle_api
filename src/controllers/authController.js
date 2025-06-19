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
        where: { role: 'USER' }
      });

      if (!userRole) {
        return res.status(500).json({ 
          error: 'System configuration error',
          message: 'Default user role not found'
        });
      }

      // Hasher le mot de passe
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Créer l'utilisateur avec toutes les relations
      const result = await prisma.$transaction(async (tx) => {
        const currentDate = new Date();

        // Créer l'utilisateur
        const user = await tx.user.create({
          data: {
            username,
            mail,
            password_hash: passwordHash,
            nom,
            prenom,
            telephone: telephone || null,
            bio: `Salut ! Je suis ${prenom}, ravi de rejoindre la communauté ! 👋`,
            photo_profil: null,
            id_role: userRole.id_role,
            private: false,
            certified: false,
            is_active: true,
            created_at: currentDate,
            updated_at: currentDate,
            last_login: null
          },
          include: {
            role: true
          }
        });

        // Créer les préférences par défaut
        const defaultLangue = await tx.langue.findFirst({ where: { langue: 'Français' } });
        const defaultTheme = await tx.theme.findFirst({ where: { theme: 'Clair' } });

        await tx.userPreferences.create({
          data: {
            id_user: user.id_user,
            id_langue: defaultLangue?.id_langue || 1,
            email_notification: true,
            id_theme: defaultTheme?.id_theme || 1
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
   * Connexion d'un utilisateur avec redirection automatique pour admin/modérateur
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
          role: true  // ✅ AJOUT: Inclure le rôle pour la redirection
        }
      });

      if (!user) {
        return res.status(401).json({ 
          error: 'Invalid credentials',
          message: 'Email or password is incorrect'
        });
      }

      // Vérifier le mot de passe
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        logger.warn(`Failed login attempt for user: ${mail}`);
        return res.status(401).json({ 
          error: 'Invalid credentials',
          message: 'Email or password is incorrect'
        });
      }

      // ✅ AJOUT: Vérifier si l'utilisateur est banni
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
          message: 'Your account is temporarily banned',
          ban_info: {
            reason: activeBan.raison,
            end_date: activeBan.fin_ban
          }
        });
      }

      // Générer les tokens
      const { accessToken, refreshToken } = TokenService.generateTokens(user.id_user);

      // Mettre à jour la dernière connexion
      await prisma.user.update({
        where: { id_user: user.id_user },
        data: { last_login: new Date() }
      });

      logger.info(`User logged in: ${user.username} (${user.role.role})`);

      // ✅ AJOUT: Déterminer la redirection basée sur le rôle
      let redirectTo = '/feed'; // Page par défaut pour les utilisateurs normaux
      const isAdminOrModerator = ['ADMIN', 'MODERATOR'].includes(user.role.role);
      
      if (isAdminOrModerator) {
        redirectTo = '/admin/dashboard'; // Redirection vers le backoffice
      }

      // Retourner les informations sans le hash du mot de passe
      const { password_hash: _, ...userResponse } = user;

      res.json({
        message: 'Login successful',
        user: userResponse,
        accessToken,
        refreshToken,
        // ✅ AJOUT: Informations de redirection
        redirect: {
          should_redirect: isAdminOrModerator,
          redirect_to: redirectTo,
          is_admin: user.role.role === 'ADMIN',
          is_moderator: user.role.role === 'MODERATOR'
        }
      });
    } catch (error) {
      logger.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Rafraîchir le token d'accès
   */
  static async refresh(req, res) {
    try {
      const { error, value } = refreshSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { refreshToken } = value;

      try {
        const decoded = TokenService.verifyRefreshToken(refreshToken);
        
        const user = await prisma.user.findFirst({
          where: { 
            id_user: decoded.id_user,
            is_active: true 
          }
        });

        if (!user) {
          return res.status(401).json({ 
            error: 'Invalid token',
            message: 'User not found or inactive'
          });
        }

        const newAccessToken = TokenService.generateAccessToken({
          id_user: user.id_user,
          username: user.username,
          mail: user.mail
        });

        res.json({
          accessToken: newAccessToken,
          expiresIn: 3600
        });

      } catch (tokenError) {
        return res.status(401).json({ 
          error: 'Invalid token',
          message: 'Refresh token is invalid or expired'
        });
      }
    } catch (error) {
      logger.error('Refresh token error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Changer le mot de passe
   */
  static async changePassword(req, res) {
    try {
      const { error, value } = changePasswordSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { currentPassword, newPassword } = value;

      const user = await prisma.user.findUnique({
        where: { id_user: req.user.id_user }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ 
          error: 'Invalid credentials',
          message: 'Current password is incorrect'
        });
      }

      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

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
   * Déconnexion (invalidation du token côté client)
   */
  static async logout(req, res) {
    try {
      logger.info(`User logged out: ${req.user.username}`);
      
      res.json({ 
        message: 'Logged out successfully',
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