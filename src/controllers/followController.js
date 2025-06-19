// src/controllers/followController.js - Version complète CORRIGÉE avec la vraie syntaxe
const prisma = require('../utils/database');
const logger = require('../utils/logger');
const { userParamsSchema, paginationSchema } = require('../validators/userValidator');

class FollowController {
  /**
   * ✅ CORRIGÉ: Suivre un utilisateur (pour l'onboarding)
   * Accepte l'ID depuis le body pour POST /api/v1/follow
   */
  static async followUser(req, res) {
    try {
      const followerId = req.user.id_user;
      const { followed_id } = req.body; // ✅ Récupérer l'ID depuis le body

      console.log(`🔄 Follow request: ${followerId} -> ${followed_id}`);

      if (!followed_id) {
        return res.status(400).json({ error: 'followed_id is required in request body' });
      }

      // Convertir en entier si nécessaire
      const followedIdInt = parseInt(followed_id, 10);
      if (isNaN(followedIdInt)) {
        return res.status(400).json({ error: 'followed_id must be a valid number' });
      }

      // Vérifier que l'utilisateur ne se suit pas lui-même
      if (followerId === followedIdInt) {
        return res.status(400).json({ error: 'Cannot follow yourself' });
      }

      // Vérifier que l'utilisateur connecté existe et est actif
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: followerId,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!currentUser) {
        return res.status(404).json({ error: 'Current user not found or inactive' });
      }

      // Vérifier que l'utilisateur à suivre existe et est actif
      const targetUser = await prisma.user.findFirst({
        where: { 
          id_user: followedIdInt,
          is_active: true
        },
        select: { 
          id_user: true, 
          username: true, 
          private: true
        }
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // ✅ CORRIGÉ: Vérifier si une relation existe déjà avec la vraie syntaxe
      const existingFollow = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: followerId,
            account: followedIdInt
          }
        }
      });

      if (existingFollow) {
        const status = existingFollow.pending ? 'pending' : 'following';
        return res.status(409).json({ 
          error: `Already ${status} this user`,
          status,
          isFollowing: true 
        });
      }

      const now = new Date();

      // ✅ CORRIGÉ: Créer la relation de suivi avec la vraie syntaxe
      const follow = await prisma.follow.create({
        data: {
          follower: followerId,
          account: followedIdInt,
          pending: targetUser.private, // En attente si le compte est privé
          active: true,
          notif_view: false, // Notification non vue
          created_at: now,
          updated_at: now
        }
      });

      const message = targetUser.private ? 'Follow request sent' : 'User followed successfully';
      const action = targetUser.private ? 'requested to follow' : 'started following';

      console.log(`✅ Follow created: ${followerId} -> ${followedIdInt} (pending: ${follow.pending})`);
      logger.info(`${currentUser.username} ${action} ${targetUser.username}`);

      res.status(201).json({
        message,
        isPending: follow.pending,
        isFollowing: true,
        targetUser: {
          id_user: targetUser.id_user,
          username: targetUser.username
        }
      });
    } catch (error) {
      console.error('❌ Error following user:', error);
      logger.error('Follow user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * ✅ CORRIGÉ: Ne plus suivre un utilisateur 
   * Utilise l'ID depuis les params pour DELETE /api/v1/follow/:id
   */
  static async unfollowUser(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;
      
      // Convertir l'ID string en nombre
      const userId = parseInt(id, 10);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const followerId = req.user.id_user;

      console.log(`🔄 Unfollow request: ${followerId} -> ${userId}`);

      // Vérifier que l'utilisateur ne se désuit pas lui-même
      if (followerId === userId) {
        return res.status(400).json({ error: 'Cannot unfollow yourself' });
      }

      // Vérifier que l'utilisateur cible existe et est actif (optionnel pour unfollow)
      const targetUser = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { username: true, is_active: true }
      });

      // ✅ CORRIGÉ: Chercher la relation existante avec la vraie syntaxe
      const existingFollow = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: followerId,
            account: userId
          }
        }
      });

      if (!existingFollow) {
        return res.status(404).json({ 
          error: 'Not following this user',
          isFollowing: false 
        });
      }

      // ✅ CORRIGÉ: Supprimer la relation avec la vraie syntaxe
      await prisma.follow.delete({
        where: {
          follower_account: {
            follower: followerId,
            account: userId
          }
        }
      });

      console.log(`✅ Unfollowed: ${followerId} -> ${userId}`);
      logger.info(`${req.user.username} unfollowed ${targetUser?.username || `user ${userId}`}`);

      res.json({ 
        message: 'User unfollowed successfully',
        isFollowing: false
      });
    } catch (error) {
      console.error('❌ Error unfollowing user:', error);
      logger.error('Unfollow user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les demandes de suivi en attente
   */
  static async getPendingRequests(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const [pendingRequests, total] = await Promise.all([
        prisma.follow.findMany({
          where: {
            account: req.user.id_user,
            pending: true,
            active: true,
            follower_user: { is_active: true }
          },
          include: {
            follower_user: {
              select: {
                id_user: true,
                username: true,
                nom: true,
                prenom: true,
                photo_profil: true,
                certified: true
              }
            }
          },
          orderBy: { created_at: 'desc' },
          skip,
          take: limit
        }),
        prisma.follow.count({
          where: {
            account: req.user.id_user,
            pending: true,
            active: true,
            follower_user: { is_active: true }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        requests: pendingRequests.map(request => ({
          id: request.follower,
          user: request.follower_user,
          requestDate: request.created_at
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
      logger.error('Get pending requests error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Accepter une demande de suivi
   */
  static async acceptFollowRequest(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;
      const followerId = parseInt(id, 10);

      if (isNaN(followerId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const followRequest = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: followerId,
            account: req.user.id_user
          }
        },
        include: {
          follower_user: {
            select: { username: true }
          }
        }
      });

      if (!followRequest || !followRequest.pending) {
        return res.status(404).json({ error: 'Follow request not found' });
      }

      await prisma.follow.update({
        where: {
          follower_account: {
            follower: followerId,
            account: req.user.id_user
          }
        },
        data: { 
          pending: false,
          updated_at: new Date()
        }
      });

      logger.info(`Follow request accepted: ${followRequest.follower_user.username} -> ${req.user.username}`);

      res.json({ message: 'Follow request accepted' });
    } catch (error) {
      logger.error('Accept follow request error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Rejeter une demande de suivi
   */
  static async rejectFollowRequest(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;
      const followerId = parseInt(id, 10);

      if (isNaN(followerId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const followRequest = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: followerId,
            account: req.user.id_user
          }
        },
        include: {
          follower_user: {
            select: { username: true }
          }
        }
      });

      if (!followRequest || !followRequest.pending) {
        return res.status(404).json({ error: 'Follow request not found' });
      }

      await prisma.follow.delete({
        where: {
          follower_account: {
            follower: followerId,
            account: req.user.id_user
          }
        }
      });

      logger.info(`Follow request rejected: ${followRequest.follower_user.username} -> ${req.user.username}`);

      res.json({ message: 'Follow request rejected' });
    } catch (error) {
      logger.error('Reject follow request error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Vérifier le statut de suivi entre deux utilisateurs
   */
  static async getFollowStatus(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;
      
      // Convertir l'ID string en nombre
      const userId = parseInt(id, 10);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      if (userId === req.user.id_user) {
        return res.json({ status: 'self' });
      }

      const followRelation = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: req.user.id_user,
            account: userId
          }
        },
        select: { active: true, pending: true }
      });

      let status = 'not_following';
      if (followRelation) {
        if (followRelation.pending) {
          status = 'pending';
        } else if (followRelation.active) {
          status = 'following';
        }
      }

      res.json({ status });
    } catch (error) {
      logger.error('Get follow status error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir la liste des followers d'un utilisateur
   */
  static async getFollowers(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = paginationSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { id } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Convertir l'ID string en nombre
      const userId = parseInt(id, 10);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      // Vérifier que l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: { private: true, is_active: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Vérifier les permissions pour les comptes privés
      if (user.private && req.user && userId !== req.user.id_user) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: userId
            }
          },
          select: { active: true, pending: true }
        });

        if (!isFollowing || !isFollowing.active || isFollowing.pending) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const [followers, total] = await Promise.all([
        prisma.follow.findMany({
          where: {
            account: userId,
            pending: false,
            active: true,
            follower_user: { is_active: true }
          },
          select: {
            follower: true,
            created_at: true,
            follower_user: {
              select: {
                id_user: true,
                username: true,
                nom: true,
                prenom: true,
                bio: true,
                photo_profil: true,
                certified: true,
                private: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.follow.count({
          where: {
            account: userId,
            pending: false,
            active: true,
            follower_user: { is_active: true }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        followers: followers.map(follow => ({
          ...follow.follower_user,
          followDate: follow.created_at
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
      logger.error('Get followers error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir la liste des utilisateurs suivis par un utilisateur
   */
  static async getFollowing(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = paginationSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { id } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Convertir l'ID string en nombre
      const userId = parseInt(id, 10);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      // Vérifier que l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: { private: true, is_active: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Vérifier les permissions pour les comptes privés
      if (user.private && req.user && userId !== req.user.id_user) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: userId
            }
          },
          select: { active: true, pending: true }
        });

        if (!isFollowing || !isFollowing.active || isFollowing.pending) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const [following, total] = await Promise.all([
        prisma.follow.findMany({
          where: {
            follower: userId,
            pending: false,
            active: true,
            account_user: { is_active: true }
          },
          select: {
            account: true,
            created_at: true,
            account_user: {
              select: {
                id_user: true,
                username: true,
                nom: true,
                prenom: true,
                bio: true,
                photo_profil: true,
                certified: true,
                private: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.follow.count({
          where: {
            follower: userId,
            pending: false,
            active: true,
            account_user: { is_active: true }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        following: following.map(follow => ({
          ...follow.account_user,
          followDate: follow.created_at
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
      logger.error('Get following error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Annuler une demande de suivi en attente
   */
  static async cancelFollowRequest(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;
      
      // Convertir l'ID string en nombre
      const userId = parseInt(id, 10);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      // Vérifier que l'utilisateur connecté existe et est actif
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!currentUser) {
        return res.status(404).json({ error: 'Current user not found or inactive' });
      }

      // Vérifier que l'utilisateur cible existe et est actif
      const targetUser = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found or inactive' });
      }

      // Vérifier qu'une demande en attente existe
      const pendingRequest = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: req.user.id_user,
            account: userId
          }
        },
        select: { pending: true, active: true }
      });

      if (!pendingRequest || !pendingRequest.pending || !pendingRequest.active) {
        return res.status(404).json({ error: 'No pending follow request found' });
      }

      // Supprimer la relation
      await prisma.follow.delete({
        where: {
          follower_account: {
            follower: req.user.id_user,
            account: userId
          }
        }
      });

      logger.info(`${currentUser.username} cancelled follow request to ${targetUser.username}`);

      res.json({ message: 'Follow request cancelled successfully' });
    } catch (error) {
      logger.error('Cancel follow request error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Marquer une notification de suivi comme lue
   */
  static async markFollowNotificationAsRead(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;
      
      // Convertir l'ID string en nombre
      const userId = parseInt(id, 10);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      // Vérifier que la relation existe et que l'utilisateur connecté est le destinataire
      const followRelation = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: userId,
            account: req.user.id_user
          }
        }
      });

      if (!followRelation) {
        return res.status(404).json({ error: 'Follow relation not found' });
      }

      await prisma.follow.update({
        where: {
          follower_account: {
            follower: userId,
            account: req.user.id_user
          }
        },
        data: { 
          notif_view: true,
          updated_at: new Date()
        }
      });

      res.json({ message: 'Follow notification marked as read' });
    } catch (error) {
      logger.error('Mark follow notification as read error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = FollowController;