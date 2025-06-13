// src/controllers/followController.js - Version complète corrigée
const prisma = require('../utils/database');
const logger = require('../utils/logger');
const { userParamsSchema, paginationSchema } = require('../validators/userValidator');

class FollowController {
  /**
   * Suivre un utilisateur ou demander à le suivre (compte privé)
   */
  static async followUser(req, res) {
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

      // Ne peut pas se suivre soi-même
      if (userId === req.user.id_user) {
        return res.status(400).json({ error: 'Cannot follow yourself' });
      }

      // Vérifier que l'utilisateur cible existe et est actif
      const targetUser = await prisma.user.findFirst({
        where: { 
          id_user: userId,
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

      // Vérifier si une relation existe déjà
      const existingFollow = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: req.user.id_user,
            account: userId
          }
        }
      });

      if (existingFollow) {
        const status = existingFollow.pending ? 'pending' : 'following';
        return res.status(409).json({ 
          error: `Already ${status} this user`,
          status
        });
      }

      const now = new Date();

      // Créer la relation de suivi
      const follow = await prisma.follow.create({
        data: {
          follower: req.user.id_user,
          account: userId,
          pending: targetUser.private, // En attente si le compte est privé
          active: true,
          notif_view: false, // Notification non vue
          created_at: now,
          updated_at: now
        }
      });

      const message = targetUser.private ? 'Follow request sent' : 'User followed successfully';
      const action = targetUser.private ? 'requested to follow' : 'started following';

      logger.info(`${currentUser.username} ${action} ${targetUser.username}`);

      res.status(201).json({
        message,
        isPending: follow.pending,
        targetUser: {
          id_user: targetUser.id_user,
          username: targetUser.username
        }
      });
    } catch (error) {
      logger.error('Follow user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Ne plus suivre un utilisateur
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

      // Vérifier que l'utilisateur cible existe et est actif (optionnel pour unfollow)
      const targetUser = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { username: true, is_active: true }
      });

      const existingFollow = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: req.user.id_user,
            account: userId
          }
        }
      });

      if (!existingFollow) {
        return res.status(404).json({ error: 'Not following this user' });
      }

      await prisma.follow.delete({
        where: {
          follower_account: {
            follower: req.user.id_user,
            account: userId
          }
        }
      });

      logger.info(`${req.user.username} unfollowed ${targetUser?.username || `user ${userId}`}`);

      res.json({ message: 'User unfollowed successfully' });
    } catch (error) {
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

      const [requests, total] = await Promise.all([
        prisma.follow.findMany({
          where: {
            account: req.user.id_user,
            pending: true,
            active: true
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
                photo_profil: true,
                certified: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.follow.count({
          where: {
            account: req.user.id_user,
            pending: true,
            active: true
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        requests: requests.map(request => ({
          ...request.follower_user,
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
      
      // Convertir l'ID string en nombre
      const userId = parseInt(id, 10);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      // Vérifier que le demandeur existe et est actif
      const requesterUser = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: { username: true }
      });

      if (!requesterUser) {
        return res.status(404).json({ error: 'Requester not found or inactive' });
      }

      const followRequest = await prisma.follow.findFirst({
        where: {
          follower: userId,
          account: req.user.id_user,
          pending: true,
          active: true
        }
      });

      if (!followRequest) {
        return res.status(404).json({ error: 'Follow request not found' });
      }

      await prisma.follow.update({
        where: {
          follower_account: {
            follower: userId,
            account: req.user.id_user
          }
        },
        data: { 
          pending: false,
          updated_at: new Date()
        }
      });

      logger.info(`${req.user.username} accepted follow request from ${requesterUser.username}`);

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
      
      // Convertir l'ID string en nombre
      const userId = parseInt(id, 10);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      // Vérifier que le demandeur existe et est actif
      const requesterUser = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: { username: true }
      });

      if (!requesterUser) {
        return res.status(404).json({ error: 'Requester not found or inactive' });
      }

      const followRequest = await prisma.follow.findFirst({
        where: {
          follower: userId,
          account: req.user.id_user,
          pending: true,
          active: true
        }
      });

      if (!followRequest) {
        return res.status(404).json({ error: 'Follow request not found' });
      }

      await prisma.follow.delete({
        where: {
          follower_account: {
            follower: userId,
            account: req.user.id_user
          }
        }
      });

      logger.info(`${req.user.username} rejected follow request from ${requesterUser.username}`);

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
   * Supprimer un abonné (retirer quelqu'un de ses followers)
   */
  static async removeFollower(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;
      
      // Convertir l'ID string en nombre
      const followerId = parseInt(id, 10);
      if (isNaN(followerId)) {
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

      // Vérifier que le follower existe et est actif
      const followerUser = await prisma.user.findFirst({
        where: { 
          id_user: followerId,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!followerUser) {
        return res.status(404).json({ error: 'Follower not found or inactive' });
      }

      // Vérifier qu'une relation de suivi existe (follower suit l'utilisateur connecté)
      const followRelation = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: followerId,
            account: req.user.id_user
          }
        }
      });

      if (!followRelation) {
        return res.status(404).json({ error: 'This user is not following you' });
      }

      // Supprimer la relation
      await prisma.follow.delete({
        where: {
          follower_account: {
            follower: followerId,
            account: req.user.id_user
          }
        }
      });

      logger.info(`${currentUser.username} removed follower ${followerUser.username}`);

      res.json({ 
        message: 'Follower removed successfully',
        removedUser: {
          id_user: followerUser.id_user,
          username: followerUser.username
        }
      });
    } catch (error) {
      logger.error('Remove follower error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Annuler une demande d'abonnement
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
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Vérifier qu'une demande en attente existe
      const pendingRequest = await prisma.follow.findFirst({
        where: {
          follower: req.user.id_user,
          account: userId,
          pending: true,
          active: true
        }
      });

      if (!pendingRequest) {
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