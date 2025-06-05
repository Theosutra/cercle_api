const prisma = require('../utils/database');
const Joi = require('joi');
const logger = require('../utils/logger');
const { userParamsSchema, paginationSchema } = require('../validators/userValidator');

// Schémas de validation pour les bans
const banUserSchema = Joi.object({
  user_banni: Joi.string().required().messages({
    'any.required': 'User to ban ID is required',
    'string.base': 'User to ban ID must be a string'
  }),
  raison: Joi.string().min(5).max(1024).required().messages({
    'string.min': 'Ban reason must be at least 5 characters long',
    'string.max': 'Ban reason must not exceed 1024 characters',
    'any.required': 'Ban reason is required'
  }),
  duree_heures: Joi.number().integer().min(1).max(8760).required().messages({
    'number.base': 'Duration must be a number',
    'number.integer': 'Duration must be an integer',
    'number.min': 'Duration must be at least 1 hour',
    'number.max': 'Duration must not exceed 8760 hours (1 year)',
    'any.required': 'Ban duration is required'
  })
});

const updateBanReasonSchema = Joi.object({
  raison: Joi.string().min(5).max(1024).required().messages({
    'string.min': 'Ban reason must be at least 5 characters long',
    'string.max': 'Ban reason must not exceed 1024 characters',
    'any.required': 'Ban reason is required'
  })
});

const updateBanDurationSchema = Joi.object({
  fin_ban: Joi.date().greater('now').required().messages({
    'date.base': 'End date must be a valid date',
    'date.greater': 'End date must be in the future',
    'any.required': 'End date is required'
  })
});

const banParamsSchema = Joi.object({
  banId: Joi.string().required().messages({
    'any.required': 'Ban ID is required',
    'string.base': 'Ban ID must be a string'
  })
});

class BanController {
  /**
   * Bannir un utilisateur
   */
  static async banUser(req, res) {
    try {
      const { error, value } = banUserSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { user_banni, raison, duree_heures } = value;

      // Vérifier que l'utilisateur connecté existe et est actif
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser) {
        return res.status(404).json({ error: 'Current user not found or inactive' });
      }

      // Vérifier que l'utilisateur connecté a les permissions (modérateur ou admin)
      if (!['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can ban users'
        });
      }

      // Empêcher de se bannir soi-même
      if (user_banni === req.user.id_user) {
        return res.status(400).json({ error: 'Cannot ban yourself' });
      }

      // Vérifier que l'utilisateur cible existe et est actif
      const targetUser = await prisma.user.findFirst({
        where: { 
          id_user: user_banni,
          is_active: true
        },
        include: { role: true }
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found or inactive' });
      }

      // Vérifier la hiérarchie des rôles (un modérateur ne peut pas bannir un admin)
      const roleHierarchy = { 'user': 1, 'moderator': 2, 'administrator': 3 };
      if (roleHierarchy[targetUser.role.role] >= roleHierarchy[currentUser.role.role]) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Cannot ban users with equal or higher privileges'
        });
      }

      // Vérifier qu'il n'existe pas déjà un ban actif
      const currentDate = new Date();
      const existingBan = await prisma.userBannissement.findFirst({
        where: {
          user_banni: user_banni,
          debut_ban: { lte: currentDate },
          fin_ban: { gte: currentDate }
        }
      });

      if (existingBan) {
        return res.status(409).json({ 
          error: 'User already banned',
          message: 'This user already has an active ban',
          existingBan: {
            reason: existingBan.raison,
            endsAt: existingBan.fin_ban
          }
        });
      }

      // Calculer la date de fin du ban
      const finBan = new Date(currentDate.getTime() + (duree_heures * 60 * 60 * 1000));

      // Créer le bannissement
      const ban = await prisma.userBannissement.create({
        data: {
          user_banni: user_banni,
          banni_by: req.user.id_user,
          raison,
          debut_ban: currentDate,
          fin_ban: finBan
        },
        include: {
          user_banni_rel: {
            select: { username: true }
          },
          banni_by_rel: {
            select: { username: true }
          }
        }
      });

      logger.info(`User ${targetUser.username} banned by ${currentUser.username} for: ${raison}`);

      res.status(201).json({
        message: 'User banned successfully',
        ban: {
          id_bannissement: ban.id_bannissement,
          user_banni: ban.user_banni_rel.username,
          banni_by: ban.banni_by_rel.username,
          raison: ban.raison,
          debut_ban: ban.debut_ban,
          fin_ban: ban.fin_ban
        }
      });
    } catch (error) {
      logger.error('Ban user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Vérifier si l'utilisateur connecté a un ban en cours
   */
  static async getUserBanStatus(req, res) {
    try {
      const currentDate = new Date();
      
      // Chercher un ban actif pour l'utilisateur connecté
      const activeBan = await prisma.userBannissement.findFirst({
        where: {
          user_banni: req.user.id_user,
          debut_ban: { lte: currentDate },
          fin_ban: { gte: currentDate }
        },
        include: {
          banni_by_rel: {
            select: { username: true }
          }
        }
      });

      if (!activeBan) {
        return res.json({ 
          isBanned: false,
          message: 'No active ban found'
        });
      }

      res.json({
        isBanned: true,
        ban: {
          raison: activeBan.raison,
          debut_ban: activeBan.debut_ban,
          fin_ban: activeBan.fin_ban,
          banni_by: activeBan.banni_by_rel.username,
          remainingTime: Math.max(0, activeBan.fin_ban - currentDate)
        }
      });
    } catch (error) {
      logger.error('Get user ban status error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Débannir manuellement un utilisateur
   */
  static async unbanUser(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: userId } = req.params;

      // Vérifier que l'utilisateur connecté a les permissions
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can unban users'
        });
      }

      // Vérifier que l'utilisateur cible existe
      const targetUser = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { username: true }
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found' });
      }

      // Chercher un ban actif
      const currentDate = new Date();
      const activeBan = await prisma.userBannissement.findFirst({
        where: {
          user_banni: userId,
          debut_ban: { lte: currentDate },
          fin_ban: { gte: currentDate }
        }
      });

      if (!activeBan) {
        return res.status(404).json({ error: 'No active ban found for this user' });
      }

      // Débannir en mettant fin_ban = maintenant
      await prisma.userBannissement.update({
        where: { id_bannissement: activeBan.id_bannissement },
        data: { fin_ban: currentDate }
      });

      logger.info(`User ${targetUser.username} unbanned by ${currentUser.username}`);

      res.json({ 
        message: 'User unbanned successfully',
        unbannedUser: targetUser.username
      });
    } catch (error) {
      logger.error('Unban user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Modifier la raison d'un ban
   */
  static async updateBanReason(req, res) {
    try {
      const { error: paramsError } = banParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = updateBanReasonSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { banId } = req.params;
      const { raison } = value;

      // Vérifier que l'utilisateur connecté a les permissions
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can modify bans'
        });
      }

      // Vérifier que le ban existe
      const ban = await prisma.userBannissement.findUnique({
        where: { id_bannissement: banId },
        include: {
          banni_by_rel: {
            include: { role: true }
          },
          user_banni_rel: {
            select: { username: true }
          }
        }
      });

      if (!ban) {
        return res.status(404).json({ error: 'Ban not found' });
      }

      // Vérifier la hiérarchie (seul un admin peut modifier le ban d'un autre admin)
      const roleHierarchy = { 'user': 1, 'moderator': 2, 'administrator': 3 };
      if (ban.banni_by !== req.user.id_user && 
          roleHierarchy[ban.banni_by_rel.role.role] >= roleHierarchy[currentUser.role.role]) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Cannot modify bans created by users with equal or higher privileges'
        });
      }

      // Mettre à jour la raison
      const updatedBan = await prisma.userBannissement.update({
        where: { id_bannissement: banId },
        data: { raison }
      });

      logger.info(`Ban reason updated by ${currentUser.username} for user ${ban.user_banni_rel.username}`);

      res.json({
        message: 'Ban reason updated successfully',
        ban: {
          id_bannissement: updatedBan.id_bannissement,
          raison: updatedBan.raison
        }
      });
    } catch (error) {
      logger.error('Update ban reason error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Modifier la durée d'un ban
   */
  static async updateBanDuration(req, res) {
    try {
      const { error: paramsError } = banParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = updateBanDurationSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { banId } = req.params;
      const { fin_ban } = value;

      // Vérifier que l'utilisateur connecté a les permissions
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can modify bans'
        });
      }

      // Vérifier que le ban existe
      const ban = await prisma.userBannissement.findUnique({
        where: { id_bannissement: banId },
        include: {
          banni_by_rel: {
            include: { role: true }
          },
          user_banni_rel: {
            select: { username: true }
          }
        }
      });

      if (!ban) {
        return res.status(404).json({ error: 'Ban not found' });
      }

      // Vérifier la hiérarchie
      const roleHierarchy = { 'user': 1, 'moderator': 2, 'administrator': 3 };
      if (ban.banni_by !== req.user.id_user && 
          roleHierarchy[ban.banni_by_rel.role.role] >= roleHierarchy[currentUser.role.role]) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Cannot modify bans created by users with equal or higher privileges'
        });
      }

      // Vérifier que fin_ban > debut_ban
      if (new Date(fin_ban) <= ban.debut_ban) {
        return res.status(400).json({ 
          error: 'Invalid end date',
          message: 'End date must be after start date'
        });
      }

      // Mettre à jour la durée
      const updatedBan = await prisma.userBannissement.update({
        where: { id_bannissement: banId },
        data: { fin_ban: new Date(fin_ban) }
      });

      logger.info(`Ban duration updated by ${currentUser.username} for user ${ban.user_banni_rel.username}`);

      res.json({
        message: 'Ban duration updated successfully',
        ban: {
          id_bannissement: updatedBan.id_bannissement,
          fin_ban: updatedBan.fin_ban
        }
      });
    } catch (error) {
      logger.error('Update ban duration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir tous les bans actifs (admin/modérateur)
   */
  static async getAllActiveBans(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier que l'utilisateur connecté a les permissions
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can view bans'
        });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;
      const currentDate = new Date();

      const [bans, total] = await Promise.all([
        prisma.userBannissement.findMany({
          where: {
            debut_ban: { lte: currentDate },
            fin_ban: { gte: currentDate }
          },
          include: {
            user_banni_rel: {
              select: { username: true, mail: true }
            },
            banni_by_rel: {
              select: { username: true }
            }
          },
          skip,
          take: limit,
          orderBy: { debut_ban: 'desc' }
        }),
        prisma.userBannissement.count({
          where: {
            debut_ban: { lte: currentDate },
            fin_ban: { gte: currentDate }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        bans: bans.map(ban => ({
          id_bannissement: ban.id_bannissement,
          user_banni: ban.user_banni_rel.username,
          user_email: ban.user_banni_rel.mail,
          banni_by: ban.banni_by_rel.username,
          raison: ban.raison,
          debut_ban: ban.debut_ban,
          fin_ban: ban.fin_ban,
          remainingTime: Math.max(0, ban.fin_ban - currentDate)
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get all active bans error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir l'historique des bans d'un utilisateur
   */
  static async getUserBanHistory(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = paginationSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      // Vérifier que l'utilisateur connecté a les permissions
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can view ban history'
        });
      }

      const { id: userId } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Vérifier que l'utilisateur cible existe
      const targetUser = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { username: true }
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      const [bans, total] = await Promise.all([
        prisma.userBannissement.findMany({
          where: { user_banni: userId },
          include: {
            banni_by_rel: {
              select: { username: true }
            }
          },
          skip,
          take: limit,
          orderBy: { debut_ban: 'desc' }
        }),
        prisma.userBannissement.count({
          where: { user_banni: userId }
        })
      ]);

      const totalPages = Math.ceil(total / limit);
      const currentDate = new Date();

      res.json({
        user: targetUser.username,
        bans: bans.map(ban => ({
          id_bannissement: ban.id_bannissement,
          banni_by: ban.banni_by_rel.username,
          raison: ban.raison,
          debut_ban: ban.debut_ban,
          fin_ban: ban.fin_ban,
          isActive: ban.debut_ban <= currentDate && ban.fin_ban >= currentDate
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get user ban history error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les détails d'un ban spécifique
   */
  static async getBanById(req, res) {
    try {
      const { error: paramsError } = banParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      // Vérifier que l'utilisateur connecté a les permissions
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can view ban details'
        });
      }

      const { banId } = req.params;

      const ban = await prisma.userBannissement.findUnique({
        where: { id_bannissement: banId },
        include: {
          user_banni_rel: {
            select: { username: true, mail: true }
          },
          banni_by_rel: {
            select: { username: true }
          }
        }
      });

      if (!ban) {
        return res.status(404).json({ error: 'Ban not found' });
      }

      const currentDate = new Date();

      res.json({
        id_bannissement: ban.id_bannissement,
        user_banni: ban.user_banni_rel.username,
        user_email: ban.user_banni_rel.mail,
        banni_by: ban.banni_by_rel.username,
        raison: ban.raison,
        debut_ban: ban.debut_ban,
        fin_ban: ban.fin_ban,
        isActive: ban.debut_ban <= currentDate && ban.fin_ban >= currentDate,
        remainingTime: ban.fin_ban > currentDate ? ban.fin_ban - currentDate : 0
      });
    } catch (error) {
      logger.error('Get ban by ID error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = BanController;
