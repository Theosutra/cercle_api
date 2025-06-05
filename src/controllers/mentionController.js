const prisma = require('../utils/database');
const logger = require('../utils/logger');
const Joi = require('joi');
const { postParamsSchema, userParamsSchema, paginationSchema } = require('../validators/userValidator');

// Schémas de validation pour les mentions
const createMentionSchema = Joi.object({
  id_post: Joi.string().required().messages({
    'any.required': 'Post ID is required',
    'string.base': 'Post ID must be a string'
  }),
  username: Joi.string().alphanum().min(2).max(50).required().messages({
    'string.alphanum': 'Username must contain only alphanumeric characters',
    'string.min': 'Username must be at least 2 characters long',
    'string.max': 'Username must not exceed 50 characters',
    'any.required': 'Username is required'
  })
});

const mentionParamsSchema = Joi.object({
  mentionId: Joi.string().pattern(/^\d+_\d+$/).required().messages({
    'string.pattern.base': 'Mention ID must be in format userId_postId',
    'any.required': 'Mention ID is required'
  })
});

const searchMentionsSchema = Joi.object({
  search: Joi.string().min(1).max(100).optional().messages({
    'string.min': 'Search term must be at least 1 character long',
    'string.max': 'Search term must not exceed 100 characters'
  }),
  author: Joi.string().optional(),
  mentioned_user: Joi.string().optional(),
  start_date: Joi.date().optional(),
  end_date: Joi.date().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20)
});

const reportMentionSchema = Joi.object({
  reason: Joi.string().min(5).max(255).required().messages({
    'string.min': 'Report reason must be at least 5 characters',
    'string.max': 'Report reason must not exceed 255 characters',
    'any.required': 'Report reason is required'
  })
});

const moderateMentionSchema = Joi.object({
  action: Joi.string().valid('remove', 'warn', 'approve').required().messages({
    'any.only': 'Action must be one of: remove, warn, approve',
    'any.required': 'Action is required'
  }),
  reason: Joi.string().max(500).optional().messages({
    'string.max': 'Reason must not exceed 500 characters'
  })
});

const getMentionStatsSchema = Joi.object({
  period: Joi.string().valid('7d', '30d', '90d', 'all').default('30d').messages({
    'any.only': 'Period must be one of: 7d, 30d, 90d, all'
  })
});

class MentionController {
  /**
   * Créer une mention manuelle
   */
  static async createMention(req, res) {
    try {
      const { error, value } = createMentionSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { id_post, username } = value;

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

      // Vérifier que le post existe et est actif
      const post = await prisma.post.findFirst({
        where: { 
          id_post: id_post,
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

      // Vérifier permissions pour comptes privés
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
          return res.status(403).json({ error: 'Access denied to mention in private account post' });
        }
      }

      // Vérifier que l'utilisateur à mentionner existe et est actif
      const mentionedUser = await prisma.user.findFirst({
        where: { 
          username: username,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!mentionedUser) {
        return res.status(404).json({ error: 'Mentioned user not found or inactive' });
      }

      // Empêcher auto-mention
      if (mentionedUser.id_user === req.user.id_user) {
        return res.status(400).json({ error: 'Cannot mention yourself' });
      }

      // Vérifier si la mention existe déjà
      const existingMention = await prisma.mention.findUnique({
        where: {
          id_user_id_post: {
            id_user: mentionedUser.id_user,
            id_post: id_post
          }
        }
      });

      if (existingMention) {
        return res.status(409).json({ error: 'User already mentioned in this post' });
      }

      // Créer la mention
      const mention = await prisma.mention.create({
        data: {
          id_user: mentionedUser.id_user,
          id_post: id_post,
          notif_view: false
        }
      });

      logger.info(`Manual mention created by ${currentUser.username}: ${username} in post ${id_post}`);

      res.status(201).json({
        message: 'Mention created successfully',
        mention: {
          id: `${mention.id_user}_${mention.id_post}`,
          mentioned_user: mentionedUser.username,
          post_id: id_post,
          created_by: currentUser.username
        }
      });
    } catch (error) {
      logger.error('Create mention error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Supprimer une mention spécifique
   */
  static async deleteMention(req, res) {
    try {
      const { error } = mentionParamsSchema.validate(req.params);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { mentionId } = req.params;
      const [userId, postId] = mentionId.split('_');

      // Vérifier que la mention existe
      const mention = await prisma.mention.findFirst({
        where: {
          id_user: userId,
          id_post: postId
        },
        include: {
          post: {
            select: { 
              id_user: true,
              author: {
                select: { username: true }
              }
            }
          },
          user: {
            select: { username: true }
          }
        }
      });

      if (!mention) {
        return res.status(404).json({ error: 'Mention not found' });
      }

      // Vérifier que l'utilisateur connecté est l'auteur du post OU l'utilisateur mentionné
      if (mention.post.id_user !== req.user.id_user && userId !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Supprimer la mention
      await prisma.mention.delete({
        where: {
          id_user_id_post: {
            id_user: userId,
            id_post: postId
          }
        }
      });

      logger.info(`Mention deleted by ${req.user.username}: ${mention.user.username} from post ${postId}`);

      res.json({ 
        message: 'Mention deleted successfully',
        deleted_mention: {
          mentioned_user: mention.user.username,
          post_author: mention.post.author.username
        }
      });
    } catch (error) {
      logger.error('Delete mention error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les mentions reçues par l'utilisateur connecté
   */
  static async getUserMentions(req, res) {
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
        select: { id_user: true, username: true }
      });

      if (!currentUser) {
        return res.status(404).json({ error: 'Current user not found or inactive' });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const [mentions, total] = await Promise.all([
        prisma.mention.findMany({
          where: {
            id_user: req.user.id_user,
            post: {
              active: true,
              author: { is_active: true }
            }
          },
          include: {
            post: {
              select: {
                id_post: true,
                content: true,
                created_at: true,
                author: {
                  select: {
                    id_user: true,
                    username: true,
                    photo_profil: true,
                    certified: true,
                    private: true
                  }
                }
              }
            }
          },
          skip,
          take: limit,
          orderBy: { post: { created_at: 'desc' } }
        }),
        prisma.mention.count({
          where: {
            id_user: req.user.id_user,
            post: {
              active: true,
              author: { is_active: true }
            }
          }
        })
      ]);

      // Filtrer les mentions selon les permissions d'accès
      const accessibleMentions = [];
      for (const mention of mentions) {
        let canAccess = true;

        // Vérifier permissions pour comptes privés
        if (mention.post.author.private && mention.post.author.id_user !== req.user.id_user) {
          const isFollowing = await prisma.follow.findUnique({
            where: {
              follower_account: {
                follower: req.user.id_user,
                account: mention.post.author.id_user
              }
            },
            select: { active: true, pending: true }
          });

          canAccess = isFollowing && isFollowing.active && !isFollowing.pending;
        }

        if (canAccess) {
          accessibleMentions.push({
            id: `${mention.id_user}_${mention.id_post}`,
            post: mention.post,
            is_read: mention.notif_view,
            mentioned_at: mention.post.created_at
          });
        }
      }

      const totalPages = Math.ceil(total / limit);

      res.json({
        mentions: accessibleMentions,
        pagination: {
          page,
          limit,
          total: accessibleMentions.length,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get user mentions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les mentions d'un post spécifique
   */
  static async getPostMentions(req, res) {
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

      // Vérifier permissions d'accès au post
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

      // Récupérer toutes les mentions du post
      const mentions = await prisma.mention.findMany({
        where: { 
          id_post: postId,
          user: { is_active: true }
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
        orderBy: { user: { username: 'asc' } }
      });

      res.json({
        post_id: postId,
        mentions: mentions.map(mention => ({
          id: `${mention.id_user}_${mention.id_post}`,
          user: mention.user,
          notification_status: mention.notif_view ? 'read' : 'unread'
        })),
        count: mentions.length
      });
    } catch (error) {
      logger.error('Get post mentions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les notifications de mentions non lues
   */
  static async getMentionNotifications(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const [notifications, total] = await Promise.all([
        prisma.mention.findMany({
          where: {
            id_user: req.user.id_user,
            notif_view: false,
            post: {
              active: true,
              author: { is_active: true }
            }
          },
          include: {
            post: {
              select: {
                id_post: true,
                content: true,
                created_at: true,
                author: {
                  select: {
                    id_user: true,
                    username: true,
                    photo_profil: true,
                    certified: true
                  }
                }
              }
            }
          },
          skip,
          take: limit,
          orderBy: { post: { created_at: 'desc' } }
        }),
        prisma.mention.count({
          where: {
            id_user: req.user.id_user,
            notif_view: false,
            post: {
              active: true,
              author: { is_active: true }
            }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        notifications: notifications.map(mention => ({
          id: `${mention.id_user}_${mention.id_post}`,
          type: 'mention',
          from_user: mention.post.author,
          content: `${mention.post.author.username} mentioned you in a post`,
          related_post: {
            id_post: mention.post.id_post,
            content: mention.post.content.substring(0, 100) + (mention.post.content.length > 100 ? '...' : '')
          },
          created_at: mention.post.created_at,
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
      logger.error('Get mention notifications error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Marquer une mention comme lue
   */
  static async markMentionAsRead(req, res) {
    try {
      const { error } = mentionParamsSchema.validate(req.params);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { mentionId } = req.params;
      const [userId, postId] = mentionId.split('_');

      // Vérifier que la mention existe et appartient à l'utilisateur connecté
      const mention = await prisma.mention.findFirst({
        where: {
          id_user: req.user.id_user,
          id_post: postId
        }
      });

      if (!mention) {
        return res.status(404).json({ error: 'Mention not found' });
      }

      // Marquer comme lue
      await prisma.mention.update({
        where: {
          id_user_id_post: {
            id_user: req.user.id_user,
            id_post: postId
          }
        },
        data: {
          notif_view: true
        }
      });

      res.json({ message: 'Mention marked as read' });
    } catch (error) {
      logger.error('Mark mention as read error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Marquer toutes les mentions comme lues
   */
  static async markAllMentionsAsRead(req, res) {
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

      const result = await prisma.mention.updateMany({
        where: {
          id_user: req.user.id_user,
          notif_view: false,
          post: {
            active: true,
            author: { is_active: true }
          }
        },
        data: {
          notif_view: true
        }
      });

      logger.info(`${currentUser.username} marked ${result.count} mention notifications as read`);

      res.json({
        message: 'All mention notifications marked as read',
        count: result.count
      });
    } catch (error) {
      logger.error('Mark all mentions as read error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Rechercher des mentions avec filtres avancés
   */
  static async searchMentions(req, res) {
    try {
      const { error, value } = searchMentionsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { search, author, mentioned_user, start_date, end_date, page, limit } = value;
      const skip = (page - 1) * limit;

      // Construire les conditions where
      const where = {
        AND: [
          {
            post: {
              active: true,
              author: { 
                is_active: true,
                private: false // Seulement posts publics pour la recherche
              }
            }
          },
          {
            user: { is_active: true }
          }
        ]
      };

      // Filtres optionnels
      if (search) {
        where.AND.push({
          post: {
            content: { contains: search, mode: 'insensitive' }
          }
        });
      }

      if (author) {
        where.AND.push({
          post: {
            author: {
              username: { contains: author, mode: 'insensitive' }
            }
          }
        });
      }

      if (mentioned_user) {
        where.AND.push({
          user: {
            username: { contains: mentioned_user, mode: 'insensitive' }
          }
        });
      }

      if (start_date || end_date) {
        const dateFilter = {};
        if (start_date) dateFilter.gte = new Date(start_date);
        if (end_date) dateFilter.lte = new Date(end_date);
        
        where.AND.push({
          post: {
            created_at: dateFilter
          }
        });
      }

      const [mentions, total] = await Promise.all([
        prisma.mention.findMany({
          where,
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
                content: true,
                created_at: true,
                author: {
                  select: {
                    id_user: true,
                    username: true,
                    photo_profil: true,
                    certified: true
                  }
                }
              }
            }
          },
          skip,
          take: limit,
          orderBy: { post: { created_at: 'desc' } }
        }),
        prisma.mention.count({ where })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        mentions: mentions.map(mention => ({
          id: `${mention.id_user}_${mention.id_post}`,
          mentioned_user: mention.user,
          post: {
            ...mention.post,
            content: mention.post.content.substring(0, 200) + (mention.post.content.length > 200 ? '...' : '')
          }
        })),
        filters: { search, author, mentioned_user, start_date, end_date },
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
      logger.error('Search mentions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les mentions mutuelles entre deux utilisateurs
   */
  static async getMutualMentions(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = paginationSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { id: otherUserId } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Vérifier que l'autre utilisateur existe et est actif
      const otherUser = await prisma.user.findFirst({
        where: { 
          id_user: otherUserId,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!otherUser) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Récupérer les mentions mutuelles
      const [userMentionsOther, otherMentionsUser] = await Promise.all([
        // Posts où l'utilisateur connecté mentionne l'autre
        prisma.mention.findMany({
          where: {
            id_user: otherUserId,
            post: {
              id_user: req.user.id_user,
              active: true
            }
          },
          include: {
            post: {
              select: {
                id_post: true,
                content: true,
                created_at: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { post: { created_at: 'desc' } }
        }),

        // Posts où l'autre utilisateur mentionne l'utilisateur connecté
        prisma.mention.findMany({
          where: {
            id_user: req.user.id_user,
            post: {
              id_user: otherUserId,
              active: true
            }
          },
          include: {
            post: {
              select: {
                id_post: true,
                content: true,
                created_at: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { post: { created_at: 'desc' } }
        })
      ]);

      res.json({
        mutual_mentions: {
          you_mentioned_them: userMentionsOther.map(mention => ({
            id: `${mention.id_user}_${mention.id_post}`,
            post: mention.post,
            direction: 'outgoing'
          })),
          they_mentioned_you: otherMentionsUser.map(mention => ({
            id: `${mention.id_user}_${mention.id_post}`,
            post: mention.post,
            direction: 'incoming'
          }))
        },
        other_user: otherUser.username,
        counts: {
          you_mentioned_them: userMentionsOther.length,
          they_mentioned_you: otherMentionsUser.length
        }
      });
    } catch (error) {
      logger.error('Get mutual mentions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les statistiques de mentions d'un utilisateur
   */
  static async getMentionStats(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = getMentionStatsSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { id: userId } = req.params;
      const { period } = value;

      // Vérifier que l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: { id_user: true, username: true, private: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Vérifier permissions pour comptes privés
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

      // Calculer la date de début selon la période
      let startDate = null;
      if (period !== 'all') {
        startDate = new Date();
        switch (period) {
          case '7d':
            startDate.setDate(startDate.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(startDate.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(startDate.getDate() - 90);
            break;
        }
      }

      const dateFilter = startDate ? { gte: startDate } : {};

      const [mentionsReceived, mentionsGiven, topMentioners, topMentioned] = await Promise.all([
        // Mentions reçues
        prisma.mention.count({
          where: {
            id_user: userId,
            post: {
              active: true,
              author: { is_active: true },
              ...(startDate && { created_at: dateFilter })
            }
          }
        }),

        // Mentions données (dans ses propres posts)
        prisma.mention.count({
          where: {
            post: {
              id_user: userId,
              active: true,
              ...(startDate && { created_at: dateFilter })
            },
            user: { is_active: true }
          }
        }),

        // Top des utilisateurs qui mentionnent le plus cet utilisateur
        prisma.$queryRaw`
          SELECT 
            u.username,
            COUNT(*) as mention_count
          FROM cercle.mentions m
          JOIN cercle.post p ON m.id_post = p.id_post
          JOIN cercle.users u ON p.id_user = u.id_user
          WHERE m.id_user = ${userId}
            AND p.active = true
            AND u.is_active = true
            ${startDate ? `AND p.created_at >= '${startDate.toISOString()}'` : ''}
          GROUP BY u.username
          ORDER BY mention_count DESC
          LIMIT 5
        `,

        // Top des utilisateurs que cet utilisateur mentionne le plus
        prisma.$queryRaw`
          SELECT 
            u.username,
            COUNT(*) as mention_count
          FROM cercle.mentions m
          JOIN cercle.users u ON m.id_user = u.id_user
          JOIN cercle.post p ON m.id_post = p.id_post
          WHERE p.id_user = ${userId}
            AND p.active = true
            AND u.is_active = true
            ${startDate ? `AND p.created_at >= '${startDate.toISOString()}'` : ''}
          GROUP BY u.username
          ORDER BY mention_count DESC
          LIMIT 5
        `
      ]);

      res.json({
        user: user.username,
        period,
        stats: {
          mentions_received: mentionsReceived,
          mentions_given: mentionsGiven,
          ratio: mentionsGiven > 0 ? (mentionsReceived / mentionsGiven).toFixed(2) : 'N/A'
        },
        top_mentioners: topMentioners.map(item => ({
          username: item.username,
          count: parseInt(item.mention_count)
        })),
        top_mentioned: topMentioned.map(item => ({
          username: item.username,
          count: parseInt(item.mention_count)
        }))
      });
    } catch (error) {
      logger.error('Get mention stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir le réseau social basé sur les mentions
   */
  static async getMentionNetwork(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Récupérer les connexions basées sur les mentions
      const network = await prisma.$queryRaw`
        WITH mention_connections AS (
          SELECT 
            p.id_user as from_user,
            m.id_user as to_user,
            COUNT(*) as mention_count,
            MAX(p.created_at) as last_mention
          FROM cercle.mentions m
          JOIN cercle.post p ON m.id_post = p.id_post
          JOIN cercle.users u1 ON p.id_user = u1.id_user
          JOIN cercle.users u2 ON m.id_user = u2.id_user
          WHERE p.active = true
            AND u1.is_active = true
            AND u2.is_active = true
            AND p.created_at >= NOW() - INTERVAL '30 days'
          GROUP BY p.id_user, m.id_user
          HAVING COUNT(*) >= 2
        )
        SELECT 
          mc.*,
          u1.username as from_username,
          u2.username as to_username
        FROM mention_connections mc
        JOIN cercle.users u1 ON mc.from_user = u1.id_user
        JOIN cercle.users u2 ON mc.to_user = u2.id_user
        ORDER BY mc.mention_count DESC, mc.last_mention DESC
        LIMIT ${limit} OFFSET ${skip}
      `;

      res.json({
        network_connections: network.map(conn => ({
          from_user: conn.from_username,
          to_user: conn.to_username,
          mention_count: parseInt(conn.mention_count),
          last_mention: conn.last_mention,
          strength: parseInt(conn.mention_count) > 5 ? 'strong' : 'moderate'
        })),
        pagination: {
          page,
          limit,
          hasNext: network.length === limit,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get mention network error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les utilisateurs les plus influents (les plus mentionnés)
   */
  static async getInfluencers(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Calculer le score d'influence basé sur les mentions des 30 derniers jours
      const influencers = await prisma.$queryRaw`
        WITH mention_stats AS (
          SELECT 
            m.id_user,
            COUNT(*) as total_mentions,
            COUNT(DISTINCT p.id_user) as unique_mentioners,
            COUNT(DISTINCT CASE WHEN uf.certified = true THEN p.id_user END) as certified_mentioners
          FROM cercle.mentions m
          JOIN cercle.post p ON m.id_post = p.id_post
          JOIN cercle.users uf ON p.id_user = uf.id_user
          WHERE p.active = true
            AND p.created_at >= NOW() - INTERVAL '30 days'
            AND uf.is_active = true
          GROUP BY m.id_user
          HAVING COUNT(*) >= 5
        )
        SELECT 
          u.id_user,
          u.username,
          u.certified,
          u.photo_profil,
          ms.total_mentions,
          ms.unique_mentioners,
          ms.certified_mentioners,
          (ms.total_mentions * 0.4 + ms.unique_mentioners * 0.4 + ms.certified_mentioners * 0.2) as influence_score
        FROM mention_stats ms
        JOIN cercle.users u ON ms.id_user = u.id_user
        WHERE u.is_active = true
        ORDER BY influence_score DESC
        LIMIT ${limit} OFFSET ${skip}
      `;

      res.json({
        influencers: influencers.map((influencer, index) => ({
          rank: skip + index + 1,
          user: {
            id_user: influencer.id_user,
            username: influencer.username,
            certified: influencer.certified,
            photo_profil: influencer.photo_profil
          },
          stats: {
            total_mentions: parseInt(influencer.total_mentions),
            unique_mentioners: parseInt(influencer.unique_mentioners),
            certified_mentioners: parseInt(influencer.certified_mentioners),
            influence_score: parseFloat(influencer.influence_score).toFixed(2)
          }
        })),
        pagination: {
          page,
          limit,
          hasNext: influencers.length === limit,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get influencers error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Signaler une mention abusive
   */
  static async reportMention(req, res) {
    try {
      const { error: paramsError } = mentionParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = reportMentionSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { mentionId } = req.params;
      const { reason } = value;
      const [userId, postId] = mentionId.split('_');

      // Vérifier que la mention existe et est accessible
      const mention = await prisma.mention.findFirst({
        where: {
          id_user: userId,
          id_post: postId
        },
        include: {
          post: {
            select: { 
              id_post: true,
              author: {
                select: { 
                  private: true,
                  is_active: true,
                  id_user: true
                }
              }
            }
          }
        }
      });

      if (!mention || !mention.post.author.is_active) {
        return res.status(404).json({ error: 'Mention not found or post author inactive' });
      }

      // Vérifier permissions pour comptes privés
      if (mention.post.author.private && mention.post.author.id_user !== req.user.id_user) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: mention.post.author.id_user
            }
          },
          select: { active: true, pending: true }
        });

        if (!isFollowing || !isFollowing.active || isFollowing.pending) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Vérifier qu'il n'y a pas déjà un signalement du même utilisateur pour ce post
      const existingReport = await prisma.report.findUnique({
        where: {
          id_user_id_post: {
            id_user: req.user.id_user,
            id_post: postId
          }
        }
      });

      if (existingReport) {
        return res.status(409).json({ error: 'You have already reported this content' });
      }

      // Créer le signalement
      await prisma.report.create({
        data: {
          id_user: req.user.id_user,
          id_post: postId,
          raison: `Abusive mention: ${reason}`,
          reported_at: new Date()
        }
      });

      logger.info(`Mention reported by ${req.user.username}: ${mentionId} - ${reason}`);

      res.status(201).json({ message: 'Mention reported successfully' });
    } catch (error) {
      logger.error('Report mention error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Modération de mention (modérateurs/admin)
   */
  static async moderateMention(req, res) {
    try {
      const { error: paramsError } = mentionParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = moderateMentionSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { mentionId } = req.params;
      const { action, reason } = value;
      const [userId, postId] = mentionId.split('_');

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
          message: 'Only moderators and administrators can moderate mentions'
        });
      }

      // Vérifier que la mention existe
      const mention = await prisma.mention.findFirst({
        where: {
          id_user: userId,
          id_post: postId
        },
        include: {
          user: {
            select: { username: true }
          },
          post: {
            select: { 
              author: {
                select: { username: true }
              }
            }
          }
        }
      });

      if (!mention) {
        return res.status(404).json({ error: 'Mention not found' });
      }

      let actionTaken = '';

      switch (action) {
        case 'remove':
          // Supprimer la mention
          await prisma.mention.delete({
            where: {
              id_user_id_post: {
                id_user: userId,
                id_post: postId
              }
            }
          });
          actionTaken = 'removed';
          break;

        case 'warn':
          // Marquer la mention comme avertie (on pourrait ajouter un champ moderation_status)
          actionTaken = 'warned';
          break;

        case 'approve':
          // Approuver la mention
          actionTaken = 'approved';
          break;
      }

      logger.info(`Mention ${actionTaken} by ${currentUser.username}: ${mention.user.username} mentioned in post by ${mention.post.author.username} - ${reason || 'No reason provided'}`);

      res.json({
        message: `Mention ${actionTaken} successfully`,
        action: actionTaken,
        mention: {
          mentioned_user: mention.user.username,
          post_author: mention.post.author.username
        },
        moderator: currentUser.username,
        reason: reason || null
      });
    } catch (error) {
      logger.error('Moderate mention error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Détecter les mentions spam (admin)
   */
  static async detectSpamMentions(req, res) {
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
          message: 'Only administrators can run spam detection'
        });
      }

      const last24h = new Date();
      last24h.setHours(last24h.getHours() - 24);

      // Détecter les patterns suspects
      const [massiveMentioners, repetitiveMentions, rapidMentions] = await Promise.all([
        // Utilisateurs qui mentionnent massivement (plus de 50 mentions en 24h)
        prisma.$queryRaw`
          SELECT 
            p.id_user,
            u.username,
            COUNT(*) as mention_count
          FROM cercle.mentions m
          JOIN cercle.post p ON m.id_post = p.id_post
          JOIN cercle.users u ON p.id_user = u.id_user
          WHERE p.created_at >= ${last24h}
            AND p.active = true
            AND u.is_active = true
          GROUP BY p.id_user, u.username
          HAVING COUNT(*) > 50
          ORDER BY mention_count DESC
        `,

        // Mentions répétitives (même utilisateur mentionné plusieurs fois par le même auteur)
        prisma.$queryRaw`
          SELECT 
            p.id_user as author_id,
            ua.username as author_username,
            m.id_user as mentioned_id,
            um.username as mentioned_username,
            COUNT(*) as repetition_count
          FROM cercle.mentions m
          JOIN cercle.post p ON m.id_post = p.id_post
          JOIN cercle.users ua ON p.id_user = ua.id_user
          JOIN cercle.users um ON m.id_user = um.id_user
          WHERE p.created_at >= ${last24h}
            AND p.active = true
            AND ua.is_active = true
            AND um.is_active = true
          GROUP BY p.id_user, ua.username, m.id_user, um.username
          HAVING COUNT(*) > 10
          ORDER BY repetition_count DESC
        `,

        // Mentions très rapides (plus de 5 mentions en moins de 5 minutes)
        prisma.$queryRaw`
          WITH rapid_mentions AS (
            SELECT 
              p.id_user,
              COUNT(*) as rapid_count
            FROM cercle.mentions m
            JOIN cercle.post p ON m.id_post = p.id_post
            WHERE p.created_at >= NOW() - INTERVAL '5 minutes'
              AND p.active = true
            GROUP BY p.id_user
            HAVING COUNT(*) > 5
          )
          SELECT 
            rm.id_user,
            u.username,
            rm.rapid_count
          FROM rapid_mentions rm
          JOIN cercle.users u ON rm.id_user = u.id_user
          WHERE u.is_active = true
          ORDER BY rm.rapid_count DESC
        `
      ]);

      res.json({
        spam_detection_report: {
          timestamp: new Date(),
          detected_patterns: {
            massive_mentioners: massiveMentioners.map(user => ({
              user_id: user.id_user,
              username: user.username,
              mention_count_24h: parseInt(user.mention_count)
            })),
            repetitive_mentions: repetitiveMentions.map(pattern => ({
              author: pattern.author_username,
              mentioned_user: pattern.mentioned_username,
              repetition_count: parseInt(pattern.repetition_count)
            })),
            rapid_mentioners: rapidMentions.map(user => ({
              user_id: user.id_user,
              username: user.username,
              mentions_last_5min: parseInt(user.rapid_count)
            }))
          },
          summary: {
            total_suspicious_users: massiveMentioners.length + rapidMentions.length,
            total_repetitive_patterns: repetitiveMentions.length
          }
        }
      });
    } catch (error) {
      logger.error('Detect spam mentions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir l'activité globale des mentions (admin)
   */
  static async getMentionActivity(req, res) {
    try {
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
          message: 'Only moderators and administrators can view mention activity'
        });
      }

      const [totalMentions, last24hMentions, last7dMentions, topMentioned, dailyActivity] = await Promise.all([
        // Total des mentions
        prisma.mention.count({
          where: {
            post: { active: true, author: { is_active: true } },
            user: { is_active: true }
          }
        }),

        // Mentions des dernières 24h
        prisma.mention.count({
          where: {
            post: { 
              active: true,
              author: { is_active: true },
              created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            },
            user: { is_active: true }
          }
        }),

        // Mentions des 7 derniers jours
        prisma.mention.count({
          where: {
            post: { 
              active: true,
              author: { is_active: true },
              created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
            },
            user: { is_active: true }
          }
        }),

        // Top utilisateurs mentionnés
        prisma.$queryRaw`
          SELECT 
            u.username,
            COUNT(*) as mention_count
          FROM cercle.mentions m
          JOIN cercle.users u ON m.id_user = u.id_user
          JOIN cercle.post p ON m.id_post = p.id_post
          WHERE p.active = true
            AND u.is_active = true
            AND p.created_at >= NOW() - INTERVAL '30 days'
          GROUP BY u.username
          ORDER BY mention_count DESC
          LIMIT 10
        `,

        // Activité quotidienne des 7 derniers jours
        prisma.$queryRaw`
          SELECT 
            DATE(p.created_at) as date,
            COUNT(*) as mention_count
          FROM cercle.mentions m
          JOIN cercle.post p ON m.id_post = p.id_post
          WHERE p.active = true
            AND p.created_at >= NOW() - INTERVAL '7 days'
          GROUP BY DATE(p.created_at)
          ORDER BY date ASC
        `
      ]);

      res.json({
        global_stats: {
          total_mentions: totalMentions,
          last_24h_mentions: last24hMentions,
          last_7d_mentions: last7dMentions,
          growth_rate_24h: totalMentions > 0 ? ((last24hMentions / totalMentions) * 100).toFixed(2) : 0
        },
        top_mentioned_users: topMentioned.map(user => ({
          username: user.username,
          mention_count: parseInt(user.mention_count)
        })),
        daily_activity: dailyActivity.map(day => ({
          date: day.date,
          mention_count: parseInt(day.mention_count)
        }))
      });
    } catch (error) {
      logger.error('Get mention activity error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Valider une mention avant création
   */
  static async validateMention(req, res) {
    try {
      const { error, value } = Joi.object({
        username: Joi.string().alphanum().min(2).max(50).required(),
        post_id: Joi.string().required()
      }).validate(req.body);

      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { username, post_id } = value;

      // Vérifier que l'utilisateur à mentionner existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          username: username,
          is_active: true
        },
        select: { 
          id_user: true, 
          username: true,
          private: true
        }
      });

      if (!user) {
        return res.status(404).json({ 
          valid: false,
          reason: 'User not found or inactive',
          suggestions: await this.getUsernameSuggestions(username)
        });
      }

      // Vérifier que le post existe
      const post = await prisma.post.findFirst({
        where: { 
          id_post: post_id,
          active: true
        },
        select: { id_post: true }
      });

      if (!post) {
        return res.status(404).json({ 
          valid: false,
          reason: 'Post not found or inactive'
        });
      }

      // Vérifier si déjà mentionné
      const existingMention = await prisma.mention.findUnique({
        where: {
          id_user_id_post: {
            id_user: user.id_user,
            id_post: post_id
          }
        }
      });

      if (existingMention) {
        return res.status(409).json({ 
          valid: false,
          reason: 'User already mentioned in this post'
        });
      }

      res.json({
        valid: true,
        user: {
          id_user: user.id_user,
          username: user.username,
          is_private: user.private
        },
        message: 'Mention validation successful'
      });
    } catch (error) {
      logger.error('Validate mention error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Nettoyer les mentions orphelines (admin)
   */
  static async cleanOrphanedMentions(req, res) {
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
          message: 'Only administrators can clean orphaned mentions'
        });
      }

      // Supprimer les mentions orphelines
      const [mentionsFromInactivePosts, mentionsFromInactiveUsers, mentionsToInactiveUsers] = await Promise.all([
        // Mentions sur des posts inactifs
        prisma.mention.deleteMany({
          where: {
            post: { active: false }
          }
        }),

        // Mentions d'utilisateurs inactifs (dans les posts)
        prisma.mention.deleteMany({
          where: {
            post: {
              author: { is_active: false }
            }
          }
        }),

        // Mentions vers des utilisateurs inactifs
        prisma.mention.deleteMany({
          where: {
            user: { is_active: false }
          }
        })
      ]);

      const totalCleaned = mentionsFromInactivePosts.count + mentionsFromInactiveUsers.count + mentionsToInactiveUsers.count;

      logger.info(`Orphaned mentions cleanup by ${currentUser.username}: ${totalCleaned} mentions removed`);

      res.json({
        message: 'Orphaned mentions cleanup completed',
        cleaned: {
          mentions_from_inactive_posts: mentionsFromInactivePosts.count,
          mentions_from_inactive_users: mentionsFromInactiveUsers.count,
          mentions_to_inactive_users: mentionsToInactiveUsers.count,
          total: totalCleaned
        }
      });
    } catch (error) {
      logger.error('Clean orphaned mentions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Extraire les mentions d'un texte
   */
  static async extractMentionsFromText(req, res) {
    try {
      const { error, value } = Joi.object({
        text: Joi.string().max(2048).required().messages({
          'string.max': 'Text must not exceed 2048 characters',
          'any.required': 'Text is required'
        })
      }).validate(req.body);

      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { text } = value;

      // Extraire les mentions du texte
      const mentionRegex = /@([a-zA-Z0-9_]+)/g;
      const matches = text.match(mentionRegex);
      
      if (!matches || matches.length === 0) {
        return res.json({
          extracted_mentions: [],
          valid_mentions: [],
          invalid_mentions: [],
          text_preview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
        });
      }

      const usernames = matches.map(m => m.substring(1)); // Retirer le @
      const uniqueUsernames = [...new Set(usernames)]; // Supprimer les doublons

      // Vérifier quels utilisateurs existent et sont actifs
      const users = await prisma.user.findMany({
        where: {
          username: { in: uniqueUsernames },
          is_active: true
        },
        select: {
          id_user: true,
          username: true,
          photo_profil: true,
          certified: true
        }
      });

      const validUsernames = users.map(u => u.username);
      const invalidUsernames = uniqueUsernames.filter(username => !validUsernames.includes(username));

      // Suggestions pour les noms d'utilisateur invalides
      const suggestions = {};
      for (const invalidUsername of invalidUsernames) {
        suggestions[invalidUsername] = await this.getUsernameSuggestions(invalidUsername);
      }

      res.json({
        extracted_mentions: uniqueUsernames,
        valid_mentions: users,
        invalid_mentions: invalidUsernames.map(username => ({
          username,
          suggestions: suggestions[username]
        })),
        text_preview: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        stats: {
          total_extracted: uniqueUsernames.length,
          valid_count: validUsernames.length,
          invalid_count: invalidUsernames.length
        }
      });
    } catch (error) {
      logger.error('Extract mentions from text error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Fonction utilitaire pour obtenir des suggestions de noms d'utilisateur
   */
  static async getUsernameSuggestions(username) {
    try {
      const suggestions = await prisma.user.findMany({
        where: {
          username: {
            contains: username.substring(0, Math.max(3, username.length - 2)),
            mode: 'insensitive'
          },
          is_active: true
        },
        select: {
          username: true,
          certified: true
        },
        take: 5,
        orderBy: { username: 'asc' }
      });

      return suggestions.map(s => s.username);
    } catch (error) {
      logger.error('Get username suggestions error:', error);
      return [];
    }
  }
}

module.exports = MentionController;
