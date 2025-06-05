const prisma = require('../utils/database');
const Joi = require('joi');
const logger = require('../utils/logger');
const { paginationSchema } = require('../validators/userValidator');

// Schémas de validation pour les notifications
const notificationParamsSchema = Joi.object({
  notificationId: Joi.string().required().messages({
    'any.required': 'Notification ID is required',
    'string.base': 'Notification ID must be a string'
  }),
  type: Joi.string().valid('like', 'mention', 'follow').required().messages({
    'any.only': 'Type must be one of: like, mention, follow',
    'any.required': 'Notification type is required'
  })
});

const cleanupSchema = Joi.object({
  olderThanDays: Joi.number().integer().min(1).max(365).default(90).messages({
    'number.base': 'Days must be a number',
    'number.integer': 'Days must be an integer',
    'number.min': 'Days must be at least 1',
    'number.max': 'Days must not exceed 365'
  })
});

class NotificationController {
  /**
   * Obtenir toutes les notifications de l'utilisateur (unifiées)
   */
  static async getAllNotifications(req, res) {
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

      // Récupérer les notifications par type
      const [likeNotifications, mentionNotifications, followNotifications, messageNotifications] = await Promise.all([
        // Notifications de likes sur ses posts
        prisma.like.findMany({
          where: {
            notif_view: false,
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
              select: { id_user: true, username: true, photo_profil: true }
            },
            post: {
              select: { id_post: true, content: true }
            }
          },
          orderBy: { created_at: 'desc' }
        }),

        // Notifications de mentions
        prisma.mention.findMany({
          where: {
            id_user: req.user.id_user,
            notif_view: false,
            post: {
              active: true,
              author: {
                is_active: true
              }
            }
          },
          include: {
            post: {
              select: { 
                id_post: true, 
                content: true,
                author: {
                  select: { id_user: true, username: true, photo_profil: true }
                }
              }
            }
          }
        }),

        // Notifications de nouveaux followers
        prisma.follow.findMany({
          where: {
            account: req.user.id_user,
            notif_view: false,
            active: true,
            pending: false,
            follower_user: {
              is_active: true
            }
          },
          include: {
            follower_user: {
              select: { id_user: true, username: true, photo_profil: true }
            }
          },
          orderBy: { created_at: 'desc' }
        }),

        // Messages non lus
        prisma.messagePrive.findMany({
          where: {
            receiver: req.user.id_user,
            read_at: null,
            active: true,
            sender_user: {
              is_active: true
            }
          },
          include: {
            sender_user: {
              select: { id_user: true, username: true, photo_profil: true }
            }
          },
          orderBy: { send_at: 'desc' }
        })
      ]);

      // Unifier toutes les notifications
      let allNotifications = [];

      // Ajouter les likes
      likeNotifications.forEach(like => {
        allNotifications.push({
          id: `like_${like.id_user}_${like.id_post}`,
          type: 'like',
          from_user: like.user,
          content: `${like.user.username} liked your post`,
          related_post: like.post,
          created_at: like.created_at,
          is_read: false
        });
      });

      // Ajouter les mentions
      mentionNotifications.forEach(mention => {
        allNotifications.push({
          id: `mention_${mention.id_user}_${mention.id_post}`,
          type: 'mention',
          from_user: mention.post.author,
          content: `${mention.post.author.username} mentioned you in a post`,
          related_post: { id_post: mention.post.id_post, content: mention.post.content },
          created_at: mention.post.created_at,
          is_read: false
        });
      });

      // Ajouter les follows
      followNotifications.forEach(follow => {
        allNotifications.push({
          id: `follow_${follow.follower}_${follow.account}`,
          type: 'follow',
          from_user: follow.follower_user,
          content: `${follow.follower_user.username} started following you`,
          related_post: null,
          created_at: follow.created_at,
          is_read: false
        });
      });

      // Ajouter les messages
      messageNotifications.forEach(message => {
        allNotifications.push({
          id: `message_${message.id_message}`,
          type: 'message',
          from_user: message.sender_user,
          content: `${message.sender_user.username} sent you a message`,
          related_post: null,
          created_at: message.send_at,
          is_read: false
        });
      });

      // Trier par date décroissante et paginer
      allNotifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const paginatedNotifications = allNotifications.slice(skip, skip + limit);
      const total = allNotifications.length;
      const totalPages = Math.ceil(total / limit);

      res.json({
        notifications: paginatedNotifications,
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
      logger.error('Get all notifications error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Marquer toutes les notifications comme lues
   */
  static async markAllAsRead(req, res) {
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

      const now = new Date();

      // Marquer toutes les notifications comme lues en parallèle
      const [likesUpdated, mentionsUpdated, followsUpdated, messagesUpdated] = await Promise.all([
        // Marquer les likes comme vus
        prisma.like.updateMany({
          where: {
            notif_view: false,
            post: {
              id_user: req.user.id_user,
              active: true
            }
          },
          data: {
            notif_view: true,
            updated_at: now
          }
        }),

        // Marquer les mentions comme vues
        prisma.mention.updateMany({
          where: {
            id_user: req.user.id_user,
            notif_view: false
          },
          data: {
            notif_view: true
          }
        }),

        // Marquer les follows comme vus
        prisma.follow.updateMany({
          where: {
            account: req.user.id_user,
            notif_view: false,
            active: true
          },
          data: {
            notif_view: true,
            updated_at: now
          }
        }),

        // Marquer les messages comme lus
        prisma.messagePrive.updateMany({
          where: {
            receiver: req.user.id_user,
            read_at: null,
            active: true
          },
          data: {
            read_at: now,
            updated_at: now
          }
        })
      ]);

      const totalMarked = likesUpdated.count + mentionsUpdated.count + followsUpdated.count + messagesUpdated.count;

      logger.info(`${currentUser.username} marked all notifications as read (${totalMarked} notifications)`);

      res.json({
        message: 'All notifications marked as read',
        marked: {
          likes: likesUpdated.count,
          mentions: mentionsUpdated.count,
          follows: followsUpdated.count,
          messages: messagesUpdated.count,
          total: totalMarked
        }
      });
    } catch (error) {
      logger.error('Mark all as read error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir le nombre de notifications non lues
   */
  static async getUnreadCount(req, res) {
    try {
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

      // Compter chaque type de notification non lue
      const [likesCount, mentionsCount, followsCount, messagesCount] = await Promise.all([
        // Compter les likes non vus sur ses posts
        prisma.like.count({
          where: {
            notif_view: false,
            post: {
              id_user: req.user.id_user,
              active: true
            },
            user: {
              is_active: true
            }
          }
        }),

        // Compter les mentions non vues
        prisma.mention.count({
          where: {
            id_user: req.user.id_user,
            notif_view: false,
            post: {
              active: true,
              author: {
                is_active: true
              }
            }
          }
        }),

        // Compter les nouveaux followers non vus
        prisma.follow.count({
          where: {
            account: req.user.id_user,
            notif_view: false,
            active: true,
            pending: false,
            follower_user: {
              is_active: true
            }
          }
        }),

        // Compter les messages non lus
        prisma.messagePrive.count({
          where: {
            receiver: req.user.id_user,
            read_at: null,
            active: true,
            sender_user: {
              is_active: true
            }
          }
        })
      ]);

      const totalUnread = likesCount + mentionsCount + followsCount + messagesCount;

      res.json({
        unreadCount: totalUnread,
        breakdown: {
          likes: likesCount,
          mentions: mentionsCount,
          follows: followsCount,
          messages: messagesCount
        }
      });
    } catch (error) {
      logger.error('Get unread count error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir uniquement les notifications de likes
   */
  static async getLikeNotifications(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const [likes, total] = await Promise.all([
        prisma.like.findMany({
          where: {
            notif_view: false,
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
              select: { id_user: true, username: true, photo_profil: true }
            },
            post: {
              select: { id_post: true, content: true }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.like.count({
          where: {
            notif_view: false,
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
        notifications: likes.map(like => ({
          id: `like_${like.id_user}_${like.id_post}`,
          type: 'like',
          from_user: like.user,
          content: `${like.user.username} liked your post`,
          related_post: like.post,
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
      logger.error('Get like notifications error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir uniquement les notifications de mentions
   */
  static async getMentionNotifications(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const [mentions, total] = await Promise.all([
        prisma.mention.findMany({
          where: {
            id_user: req.user.id_user,
            notif_view: false,
            post: {
              active: true,
              author: {
                is_active: true
              }
            }
          },
          include: {
            post: {
              select: { 
                id_post: true, 
                content: true,
                created_at: true,
                author: {
                  select: { id_user: true, username: true, photo_profil: true }
                }
              }
            }
          },
          skip,
          take: limit
        }),
        prisma.mention.count({
          where: {
            id_user: req.user.id_user,
            notif_view: false,
            post: {
              active: true,
              author: {
                is_active: true
              }
            }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        notifications: mentions.map(mention => ({
          id: `mention_${mention.id_user}_${mention.id_post}`,
          type: 'mention',
          from_user: mention.post.author,
          content: `${mention.post.author.username} mentioned you in a post`,
          related_post: { 
            id_post: mention.post.id_post, 
            content: mention.post.content 
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
   * Obtenir uniquement les notifications de follows
   */
  static async getFollowNotifications(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const [follows, total] = await Promise.all([
        prisma.follow.findMany({
          where: {
            account: req.user.id_user,
            notif_view: false,
            active: true,
            pending: false,
            follower_user: {
              is_active: true
            }
          },
          include: {
            follower_user: {
              select: { id_user: true, username: true, photo_profil: true }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.follow.count({
          where: {
            account: req.user.id_user,
            notif_view: false,
            active: true,
            pending: false,
            follower_user: {
              is_active: true
            }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        notifications: follows.map(follow => ({
          id: `follow_${follow.follower}_${follow.account}`,
          type: 'follow',
          from_user: follow.follower_user,
          content: `${follow.follower_user.username} started following you`,
          related_post: null,
          created_at: follow.created_at,
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
      logger.error('Get follow notifications error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Marquer une notification de like comme lue
   */
  static async markLikeNotificationAsRead(req, res) {
    try {
      const { error } = notificationParamsSchema.validate(req.params);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { notificationId } = req.params;
      const [, userId, postId] = notificationId.split('_');

      // Vérifier que le like existe et appartient à un post de l'utilisateur
      const like = await prisma.like.findFirst({
        where: {
          id_user: userId,
          id_post: postId,
          post: {
            id_user: req.user.id_user
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
   * Marquer une notification de mention comme lue
   */
  static async markMentionNotificationAsRead(req, res) {
    try {
      const { error } = notificationParamsSchema.validate(req.params);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { notificationId } = req.params;
      const [, userId, postId] = notificationId.split('_');

      // Vérifier que la mention existe et concerne l'utilisateur
      const mention = await prisma.mention.findFirst({
        where: {
          id_user: req.user.id_user,
          id_post: postId
        }
      });

      if (!mention) {
        return res.status(404).json({ error: 'Mention notification not found' });
      }

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

      res.json({ message: 'Mention notification marked as read' });
    } catch (error) {
      logger.error('Mark mention notification as read error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Nettoyer les anciennes notifications (admin)
   */
  static async cleanOldNotifications(req, res) {
    try {
      const { error, value } = cleanupSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

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
          message: 'Only administrators can clean notifications'
        });
      }

      const { olderThanDays } = value;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      // Nettoyer les notifications lues anciennes
      const [likesDeleted, messagesDeleted] = await Promise.all([
        // Remettre notif_view à true pour les anciens likes
        prisma.like.updateMany({
          where: {
            notif_view: true,
            updated_at: { lt: cutoffDate }
          },
          data: {
            notif_view: false // Les "supprimer" en les cachant
          }
        }),

        // Supprimer les anciens messages lus
        prisma.messagePrive.deleteMany({
          where: {
            read_at: { not: null, lt: cutoffDate },
            active: true
          }
        })
      ]);

      logger.info(`Old notifications cleaned by ${currentUser.username}: ${likesDeleted.count} likes, ${messagesDeleted.count} messages`);

      res.json({
        message: 'Old notifications cleaned successfully',
        cleaned: {
          likes: likesDeleted.count,
          messages: messagesDeleted.count,
          olderThanDays
        }
      });
    } catch (error) {
      logger.error('Clean old notifications error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = NotificationController;
