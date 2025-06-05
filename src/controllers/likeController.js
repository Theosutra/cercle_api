const prisma = require('../utils/database');
const logger = require('../utils/logger');
const Joi = require('joi');
const { postParamsSchema, userParamsSchema } = require('../validators/postValidator');
const { paginationSchema } = require('../validators/userValidator');

// Schémas de validation pour les likes
const likeNotificationParamsSchema = Joi.object({
  likeId: Joi.string().pattern(/^\d+_\d+$/).required().messages({
    'string.pattern.base': 'Like ID must be in format userId_postId',
    'any.required': 'Like ID is required'
  })
});

const trendingPostsSchema = Joi.object({
  period: Joi.string().valid('24h', '7d', '30d', 'all').default('24h').messages({
    'any.only': 'Period must be one of: 24h, 7d, 30d, all'
  }),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20)
});

const similarUsersSchema = Joi.object({
  minCommonLikes: Joi.number().integer().min(1).default(3).messages({
    'number.min': 'Minimum common likes must be at least 1'
  }),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20)
});

class LikeController {
  /**
   * Toggle like/unlike sur un post (amélioré)
   */
  static async toggleLike(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: postId } = req.params;

      // Vérifier que le post existe et est actif
      const post = await prisma.post.findFirst({
        where: { 
          id_post: postId,
          active: true
        },
        select: { 
          id_post: true,
          id_user: true,
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

      // Vérifier les permissions pour les comptes privés
      if (post.author.private && post.author.id_user !== req.user.id_user) {
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
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Vérifier si le like existe déjà
      const existingLike = await prisma.like.findUnique({
        where: {
          id_user_id_post: {
            id_user: req.user.id_user,
            id_post: postId
          }
        }
      });

      let isLiked;
      let message;
      const now = new Date();
      
      if (existingLike) {
        // Unlike - supprimer le like
        await prisma.like.delete({
          where: {
            id_user_id_post: {
              id_user: req.user.id_user,
              id_post: postId
            }
          }
        });
        isLiked = false;
        message = 'Post unliked';
        logger.info(`Post unliked by ${req.user.username}: ${postId}`);
      } else {
        // Like - créer le like
        await prisma.like.create({
          data: {
            id_user: req.user.id_user,
            id_post: postId,
            active: true,
            notif_view: false,
            created_at: now,
            updated_at: now
          }
        });
        isLiked = true;
        message = 'Post liked';
        logger.info(`Post liked by ${req.user.username}: ${postId}`);
      }

      // Obtenir le nombre total de likes mis à jour (utilisateurs actifs uniquement)
      const likeCount = await prisma.like.count({
        where: { 
          id_post: postId,
          active: true,
          user: {
            is_active: true
          }
        }
      });

      res.json({
        message,
        isLiked,
        likeCount
      });
    } catch (error) {
      logger.error('Toggle like error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir la liste des utilisateurs qui ont liké un post (amélioré)
   */
  static async getPostLikes(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = paginationSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { id: postId } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Vérifier que le post existe et est actif
      const post = await prisma.post.findFirst({
        where: { 
          id_post: postId,
          active: true
        },
        select: { 
          active: true,
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

      // Vérifier les permissions pour les comptes privés
      if (post.author.private && req.user && post.author.id_user !== req.user.id_user) {
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
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const [likes, total] = await Promise.all([
        prisma.like.findMany({
          where: { 
            id_post: postId,
            active: true,
            user: {
              is_active: true
            }
          },
          include: {
            user: {
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
        prisma.like.count({ 
          where: { 
            id_post: postId,
            active: true,
            user: {
              is_active: true
            }
          } 
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        users: likes.map(like => ({
          ...like.user,
          likedAt: like.created_at
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
      logger.error('Get post likes error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts likés par un utilisateur (amélioré)
   */
  static async getUserLikedPosts(req, res) {
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

      const [likedPosts, total] = await Promise.all([
        prisma.like.findMany({
          where: { 
            id_user: userId,
            active: true,
            post: {
              active: true,
              author: {
                is_active: true
              }
            }
          },
          include: {
            post: {
              include: {
                author: {
                  select: {
                    id_user: true,
                    username: true,
                    photo_profil: true,
                    certified: true
                  }
                },
                _count: {
                  select: {
                    likes: { 
                      where: { 
                        active: true,
                        user: { is_active: true }
                      }
                    },
                    mentions: true
                  }
                },
                ...(req.user && {
                  likes: {
                    where: { 
                      id_user: req.user.id_user,
                      active: true
                    },
                    select: { id_user: true }
                  }
                })
              }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.like.count({ 
          where: { 
            id_user: userId,
            active: true,
            post: {
              active: true,
              author: { is_active: true }
            }
          } 
        })
      ]);

      const posts = likedPosts.map(like => ({
        ...like.post,
        isLiked: req.user ? like.post.likes?.length > 0 : true,
        likeCount: like.post._count.likes,
        mentionCount: like.post._count.mentions,
        likedAt: like.created_at,
        likes: undefined,
        _count: undefined
      }));

      const totalPages = Math.ceil(total / limit);

      res.json({
        posts,
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
      logger.error('Get user liked posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les statistiques de likes d'un utilisateur (amélioré)
   */
  static async getUserLikeStats(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: userId } = req.params;

      // Vérifier que l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: { id_user: true, is_active: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      const [likesGiven, likesReceived] = await Promise.all([
        // Likes donnés par l'utilisateur (sur posts actifs d'auteurs actifs)
        prisma.like.count({
          where: { 
            id_user: userId,
            active: true,
            post: {
              active: true,
              author: { is_active: true }
            }
          }
        }),
        // Likes reçus sur ses posts (de likeurs actifs)
        prisma.like.count({
          where: {
            active: true,
            user: { is_active: true },
            post: {
              id_user: userId,
              active: true
            }
          }
        })
      ]);

      res.json({
        likesGiven,
        likesReceived,
        ratio: likesGiven > 0 ? (likesReceived / likesGiven).toFixed(2) : 0
      });
    } catch (error) {
      logger.error('Get user like stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les notifications de likes reçues
   */
  static async getUserLikeNotifications(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier que l'utilisateur connecté existe et est actif
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true }
      });

      if (!currentUser) {
        return res.status(404).json({ error: 'Current user not found or inactive' });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const [notifications, total] = await Promise.all([
        prisma.like.findMany({
          where: {
            notif_view: false,
            active: true,
            post: {
              id_user: req.user.id_user,
              active: true
            },
            user: {
              is_active: true
            }
          },
          include: {
            user: {
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                certified: true
              }
            },
            post: {
              select: {
                id_post: true,
                content: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.like.count({
          where: {
            notif_view: false,
            active: true,
            post: {
              id_user: req.user.id_user,
              active: true
            },
            user: {
              is_active: true
            }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        notifications: notifications.map(like => ({
          id: `${like.id_user}_${like.id_post}`,
          from_user: like.user,
          post: like.post,
          message: `${like.user.username} liked your post`,
          created_at: like.created_at,
          is_read: false
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
      logger.error('Get user like notifications error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Marquer une notification de like comme lue
   */
  static async markLikeNotificationAsRead(req, res) {
    try {
      const { error } = likeNotificationParamsSchema.validate(req.params);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { likeId } = req.params;
      const [userId, postId] = likeId.split('_');

      // Vérifier que le like existe et appartient à un post de l'utilisateur
      const like = await prisma.like.findFirst({
        where: {
          id_user: userId,
          id_post: postId,
          active: true,
          post: {
            id_user: req.user.id_user,
            active: true
          },
          user: {
            is_active: true
          }
        }
      });

      if (!like) {
        return res.status(404).json({ error: 'Like notification not found' });
      }

      await prisma.like.update({
        where: {
          id_user_id_post: {
            id_user: userId,
            id_post: postId
          }
        },
        data: {
          notif_view: true,
          updated_at: new Date()
        }
      });

      res.json({ message: 'Like notification marked as read' });
    } catch (error) {
      logger.error('Mark like notification as read error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Marquer toutes les notifications de likes comme lues
   */
  static async markAllLikeNotificationsAsRead(req, res) {
    try {
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

      const result = await prisma.like.updateMany({
        where: {
          notif_view: false,
          active: true,
          post: {
            id_user: req.user.id_user,
            active: true
          }
        },
        data: {
          notif_view: true,
          updated_at: new Date()
        }
      });

      logger.info(`${currentUser.username} marked ${result.count} like notifications as read`);

      res.json({
        message: 'All like notifications marked as read',
        count: result.count
      });
    } catch (error) {
      logger.error('Mark all like notifications as read error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts les plus likés (tendances)
   */
  static async getMostLikedPosts(req, res) {
    try {
      const { error, value } = trendingPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { period, page, limit } = value;
      const skip = (page - 1) * limit;

      // Calculer la date de début selon la période
      let startDate = null;
      if (period !== 'all') {
        startDate = new Date();
        switch (period) {
          case '24h':
            startDate.setHours(startDate.getHours() - 24);
            break;
          case '7d':
            startDate.setDate(startDate.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(startDate.getDate() - 30);
            break;
        }
      }

      // Construire la condition where pour les likes
      const likeWhere = {
        active: true,
        user: { is_active: true },
        ...(startDate && { created_at: { gte: startDate } })
      };

      const posts = await prisma.post.findMany({
        where: {
          active: true,
          author: { 
            is_active: true,
            private: false
          }
        },
        include: {
          author: {
            select: {
              id_user: true,
              username: true,
              photo_profil: true,
              certified: true
            }
          },
          _count: {
            select: {
              likes: { where: likeWhere },
              mentions: true
            }
          },
          ...(req.user && {
            likes: {
              where: { 
                id_user: req.user.id_user,
                active: true
              },
              select: { id_user: true }
            }
          })
        },
        orderBy: {
          likes: {
            _count: 'desc'
          }
        },
        skip,
        take: limit
      });

      // Filtrer les posts avec au moins 1 like dans la période
      const trendingPosts = posts
        .filter(post => post._count.likes > 0)
        .map(post => ({
          ...post,
          isLiked: req.user ? post.likes?.length > 0 : false,
          likeCount: post._count.likes,
          mentionCount: post._count.mentions,
          likes: undefined,
          _count: undefined
        }));

      res.json({
        posts: trendingPosts,
        period,
        pagination: {
          page,
          limit,
          hasNext: trendingPosts.length === limit,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get most liked posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir des utilisateurs avec des goûts similaires
   */
  static async getUsersWhoLikedSimilarPosts(req, res) {
    try {
      const { error, value } = similarUsersSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier que l'utilisateur connecté existe et est actif
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true }
      });

      if (!currentUser) {
        return res.status(404).json({ error: 'Current user not found or inactive' });
      }

      const { minCommonLikes, page, limit } = value;
      const skip = (page - 1) * limit;

      // Récupérer les posts likés par l'utilisateur connecté
      const userLikes = await prisma.like.findMany({
        where: {
          id_user: req.user.id_user,
          active: true,
          post: {
            active: true,
            author: { is_active: true }
          }
        },
        select: { id_post: true }
      });

      const likedPostIds = userLikes.map(like => like.id_post);

      if (likedPostIds.length === 0) {
        return res.json({
          users: [],
          pagination: { page, limit, total: 0, hasNext: false, hasPrev: false }
        });
      }

      // Récupérer les utilisateurs déjà suivis
      const followedUsers = await prisma.follow.findMany({
        where: {
          follower: req.user.id_user,
          active: true
        },
        select: { account: true }
      });

      const followedUserIds = followedUsers.map(f => f.account);
      followedUserIds.push(req.user.id_user);

      // Trouver les utilisateurs avec des likes similaires
      const similarUsers = await prisma.$queryRaw`
        SELECT 
          u.id_user,
          u.username,
          u.photo_profil,
          u.certified,
          COUNT(l.id_post) as common_likes
        FROM cercle.users u
        JOIN cercle.likes l ON u.id_user = l.id_user
        WHERE l.id_post = ANY(${likedPostIds})
          AND l.active = true
          AND u.is_active = true
          AND u.id_user != ALL(${followedUserIds})
        GROUP BY u.id_user, u.username, u.photo_profil, u.certified
        HAVING COUNT(l.id_post) >= ${minCommonLikes}
        ORDER BY common_likes DESC
        LIMIT ${limit} OFFSET ${skip}
      `;

      res.json({
        users: similarUsers.map(user => ({
          id_user: user.id_user,
          username: user.username,
          photo_profil: user.photo_profil,
          certified: user.certified,
          commonLikes: parseInt(user.common_likes)
        })),
        pagination: {
          page,
          limit,
          hasNext: similarUsers.length === limit,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get users with similar likes error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les statistiques globales des likes (admin)
   */
  static async getLikeActivity(req, res) {
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
          message: 'Only moderators and administrators can view like activity'
        });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Statistiques globales
      const [totalLikes, activeLikes, last24hLikes, topUsers] = await Promise.all([
        // Total des likes
        prisma.like.count(),
        
        // Likes actifs
        prisma.like.count({
          where: {
            active: true,
            user: { is_active: true },
            post: { 
              active: true,
              author: { is_active: true }
            }
          }
        }),

        // Likes des dernières 24h
        prisma.like.count({
          where: {
            active: true,
            created_at: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
            }
          }
        }),

        // Top utilisateurs par likes reçus
        prisma.user.findMany({
          where: { is_active: true },
          select: {
            id_user: true,
            username: true,
            _count: {
              select: {
                posts: {
                  where: {
                    active: true,
                    likes: {
                      some: {
                        active: true,
                        user: { is_active: true }
                      }
                    }
                  }
                }
              }
            }
          },
          orderBy: {
            posts: {
              _count: 'desc'
            }
          },
          skip,
          take: limit
        })
      ]);

      res.json({
        globalStats: {
          totalLikes,
          activeLikes,
          inactiveLikes: totalLikes - activeLikes,
          last24hLikes
        },
        topUsers: topUsers.map(user => ({
          id_user: user.id_user,
          username: user.username,
          likesReceived: user._count.posts
        })),
        pagination: {
          page,
          limit,
          hasNext: topUsers.length === limit,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get like activity error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Nettoyer les likes d'utilisateurs inactifs (admin)
   */
  static async removeLikesFromInactiveUsers(req, res) {
    try {
      // Vérifier que l'utilisateur connecté est admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || currentUser.role.role !== 'administrator') {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only administrators can clean like data'
        });
      }

      // Supprimer les likes d'utilisateurs inactifs
      const [likesFromInactiveUsers, likesOnInactivePosts, orphanedLikes] = await Promise.all([
        // Likes donnés par des utilisateurs inactifs
        prisma.like.deleteMany({
          where: {
            user: { is_active: false }
          }
        }),

        // Likes sur des posts d'auteurs inactifs
        prisma.like.deleteMany({
          where: {
            post: {
              author: { is_active: false }
            }
          }
        }),

        // Likes sur des posts supprimés
        prisma.like.deleteMany({
          where: {
            post: { active: false }
          }
        })
      ]);

      const totalCleaned = likesFromInactiveUsers.count + likesOnInactivePosts.count + orphanedLikes.count;

      logger.info(`Like cleanup performed by ${currentUser.username}: ${totalCleaned} likes removed`);

      res.json({
        message: 'Like cleanup completed successfully',
        cleaned: {
          likesFromInactiveUsers: likesFromInactiveUsers.count,
          likesOnInactivePosts: likesOnInactivePosts.count,
          orphanedLikes: orphanedLikes.count,
          total: totalCleaned
        }
      });
    } catch (error) {
      logger.error('Remove likes from inactive users error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = LikeController;
