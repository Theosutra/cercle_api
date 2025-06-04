const prisma = require('../utils/database');
const logger = require('../utils/logger');
const { userParamsSchema, paginationSchema } = require('../validators/userValidator');

class FollowController {
  /**
   * Suivre un utilisateur
   */
  static async followUser(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: userId } = req.params;

      // Ne peut pas se suivre soi-même
      if (userId === req.user.id_user) {
        return res.status(400).json({ error: 'Cannot follow yourself' });
      }

      // Vérifier que l'utilisateur cible existe
      const targetUser = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { 
          id_user: true, 
          username: true, 
          private: true, 
          is_active: true 
        }
      });

      if (!targetUser || !targetUser.is_active) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Vérifier si déjà suivi
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

      // Créer la relation de suivi
      const follow = await prisma.follow.create({
        data: {
          follower: req.user.id_user,
          account: userId,
          pending: targetUser.private // En attente si le compte est privé
        }
      });

      logger.info(`${req.user.username} ${targetUser.private ? 'requested to follow' : 'started following'} ${targetUser.username}`);

      res.status(201).json({
        message: targetUser.private ? 'Follow request sent' : 'User followed successfully',
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

      const { id: userId } = req.params;

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

      const targetUser = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { username: true }
      });

      logger.info(`${req.user.username} unfollowed ${targetUser?.username}`);

      res.json({ message: 'User unfollowed successfully' });
    } catch (error) {
      logger.error('Unfollow user error:', error);
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

      const { id: userId } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Vérifier que l'utilisateur existe
      const user = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { private: true, is_active: true }
      });

      if (!user || !user.is_active) {
        return res.status(404).json({ error: 'User not found' });
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
            active: true,
            pending: false
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
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.follow.count({
          where: { 
            account: userId,
            active: true,
            pending: false
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        followers: followers.map(follow => ({
          ...follow.follower_user,
          followedAt: follow.created_at
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
   * Obtenir la liste des utilisateurs suivis
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

      const { id: userId } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Vérifier que l'utilisateur existe
      const user = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { private: true, is_active: true }
      });

      if (!user || !user.is_active) {
        return res.status(404).json({ error: 'User not found' });
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
            active: true,
            pending: false
          },
          include: {
            followed_user: {
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
            follower: userId,
            active: true,
            pending: false
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        following: following.map(follow => ({
          ...follow.followed_user,
          followedAt: follow.created_at
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
   * Obtenir les demandes de suivi en attente
   */
  static async getPendingRequests(req, res) {
    try {
      const { error: queryError, value } = paginationSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const [pendingRequests, total] = await Promise.all([
        prisma.follow.findMany({
          where: { 
            account: req.user.id_user,
            pending: true,
            active: true
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
        requests: pendingRequests.map(request => ({
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

      const { id: userId } = req.params;

      const followRequest = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: userId,
            account: req.user.id_user
          }
        }
      });

      if (!followRequest || !followRequest.pending) {
        return res.status(404).json({ error: 'Follow request not found' });
      }

      await prisma.follow.update({
        where: {
          follower_account: {
            follower: userId,
            account: req.user.id_user
          }
        },
        data: { pending: false }
      });

      const requesterUser = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { username: true }
      });

      logger.info(`${req.user.username} accepted follow request from ${requesterUser?.username}`);

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

      const { id: userId } = req.params;

      const followRequest = await prisma.follow.findUnique({
        where: {
          follower_account: {
            follower: userId,
            account: req.user.id_user
          }
        }
      });

      if (!followRequest || !followRequest.pending) {
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

      const requesterUser = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { username: true }
      });

      logger.info(`${req.user.username} rejected follow request from ${requesterUser?.username}`);

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

      const { id: userId } = req.params;

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
}

module.exports = FollowController;