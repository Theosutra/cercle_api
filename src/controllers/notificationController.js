// backend/src/controllers/notificationController.js - CORRECTION FINALE
const prisma = require('../utils/database');
const logger = require('../utils/logger');

class NotificationController {
  
  /**
   * Obtenir le compteur de notifications non lues
   */
  static async getUnreadCount(req, res) {
    try {
      const userId = req.user.id_user;

      // ✅ CORRECTION COMPLÈTE: Requêtes simplifiées sans relations complexes
      const [likesCount, mentionsCount, followsCount, messagesCount] = await Promise.all([
        // ✅ CORRECTION: Likes non lus - éviter les auto-likes
        prisma.like.count({
          where: {
            notif_view: false,
            id_user: {
              not: userId // ✅ Éviter les auto-likes
            },
            post: {
              id_user: userId, // ✅ Seulement les posts de l'utilisateur connecté
              active: true
            },
            user: {
              is_active: true
            }
          }
        }),

        // ✅ CORRECTION: Mentions - requête ultra-simplifiée
        prisma.$queryRaw`
          SELECT COUNT(*)::int as count
          FROM cercle.mentions m
          INNER JOIN cercle.post p ON m.id_post = p.id_post
          INNER JOIN cercle.users u ON p.id_user = u.id_user
          WHERE m.id_user = ${userId}
            AND m.notif_view = false
            AND p.active = true
            AND u.is_active = true
            AND p.id_user != ${userId}
        `.then(result => result[0]?.count || 0),

        // Nouveaux followers non lus
        prisma.follow.count({
          where: {
            account: userId,
            notif_view: false,
            active: true,
            pending: false,
            follower: {
              not: userId // ✅ Éviter les auto-follows
            },
            follower_user: {
              is_active: true
            }
          }
        }),

        // Messages non lus
        prisma.messagePrive.count({
          where: {
            receiver: userId,
            sender: {
              not: userId // ✅ Éviter les auto-messages
            },
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
   * Marquer toutes les notifications comme lues
   */
  static async markAllAsRead(req, res) {
    try {
      const userId = req.user.id_user;

      await Promise.all([
        // Marquer tous les likes comme lus
        prisma.like.updateMany({
          where: {
            notif_view: false,
            post: {
              id_user: userId,
              active: true
            }
          },
          data: {
            notif_view: true,
            updated_at: new Date()
          }
        }),

        // Marquer toutes les mentions comme lues
        prisma.mention.updateMany({
          where: {
            id_user: userId,
            notif_view: false
          },
          data: {
            notif_view: true
          }
        }),

        // Marquer tous les follows comme lus
        prisma.follow.updateMany({
          where: {
            account: userId,
            notif_view: false,
            active: true,
            pending: false
          },
          data: {
            notif_view: true,
            updated_at: new Date()
          }
        }),

        // Marquer tous les messages comme lus
        prisma.messagePrive.updateMany({
          where: {
            receiver: userId,
            read_at: null,
            active: true
          },
          data: {
            read_at: new Date()
          }
        })
      ]);

      res.json({ 
        message: 'All notifications marked as read',
        success: true 
      });

    } catch (error) {
      logger.error('Mark all as read error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir toutes les notifications unifiées
   */
  static async getAllNotifications(req, res) {
    try {
      const userId = req.user.id_user;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      // ✅ CORRECTION: Utiliser des requêtes SQL brutes pour les mentions
      const [likeNotifications, mentionNotifications, followNotifications, messageNotifications] = await Promise.all([
        // ✅ CORRECTION: Notifications de likes - éviter les auto-likes
        prisma.like.findMany({
          where: {
            notif_view: false,
            id_user: {
              not: userId // ✅ Éviter les auto-likes
            },
            post: {
              id_user: userId, // ✅ Seulement les posts de l'utilisateur connecté
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
                prenom: true,
                nom: true
              }
            },
            post: {
              select: { 
                id_post: true, 
                content: true,
                created_at: true
              }
            }
          },
          orderBy: { created_at: 'desc' }
        }),

        // ✅ CORRECTION: Mentions avec requête SQL brute - éviter les auto-mentions
        prisma.$queryRaw`
          SELECT 
            m.id_user,
            m.id_post,
            m.notif_view,
            p.id_post as post_id,
            p.content as post_content,
            p.created_at as post_created_at,
            p.id_user as author_id,
            u.id_user as author_user_id,
            u.username as author_username,
            u.photo_profil as author_photo,
            u.prenom as author_prenom,
            u.nom as author_nom
          FROM cercle.mentions m
          INNER JOIN cercle.post p ON m.id_post = p.id_post
          INNER JOIN cercle.users u ON p.id_user = u.id_user
          WHERE m.id_user = ${userId}
            AND m.notif_view = false
            AND p.active = true
            AND u.is_active = true
            AND p.id_user != ${userId}
          ORDER BY p.created_at DESC
        `,

        // ✅ CORRECTION: Notifications de nouveaux followers - éviter les auto-follows
        prisma.follow.findMany({
          where: {
            account: userId,
            notif_view: false,
            active: true,
            pending: false,
            follower: {
              not: userId // ✅ Éviter les auto-follows
            },
            follower_user: {
              is_active: true
            }
          },
          include: {
            follower_user: {
              select: { 
                id_user: true, 
                username: true, 
                photo_profil: true,
                prenom: true,
                nom: true
              }
            }
          },
          orderBy: { created_at: 'desc' }
        }),

        // ✅ CORRECTION: Notifications de messages non lus - éviter les auto-messages
        prisma.messagePrive.findMany({
          where: {
            receiver: userId,
            sender: {
              not: userId // ✅ Éviter les auto-messages
            },
            read_at: null,
            active: true,
            sender_user: {
              is_active: true
            }
          },
          include: {
            sender_user: {
              select: { 
                id_user: true, 
                username: true, 
                photo_profil: true,
                prenom: true,
                nom: true
              }
            }
          },
          orderBy: { send_at: 'desc' },
          take: 10
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
          content: `${like.user.username} a aimé votre publication`,
          related_post: like.post,
          created_at: like.created_at,
          is_read: false
        });
      });

      // ✅ CORRECTION: Ajouter les mentions depuis la requête SQL
      mentionNotifications.forEach(mention => {
        allNotifications.push({
          id: `mention_${mention.id_user}_${mention.id_post}`,
          type: 'mention',
          from_user: {
            id_user: mention.author_user_id,
            username: mention.author_username,
            photo_profil: mention.author_photo,
            prenom: mention.author_prenom,
            nom: mention.author_nom
          },
          content: `${mention.author_username} vous a mentionné dans une publication`,
          related_post: { 
            id_post: mention.post_id, 
            content: mention.post_content 
          },
          created_at: mention.post_created_at,
          is_read: false
        });
      });

      // Ajouter les follows
      followNotifications.forEach(follow => {
        allNotifications.push({
          id: `follow_${follow.follower}_${follow.account}`,
          type: 'follow',
          from_user: follow.follower_user,
          content: `${follow.follower_user.username} a commencé à vous suivre`,
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
          content: `${message.sender_user.username} vous a envoyé un message`,
          message_preview: message.message.substring(0, 50) + (message.message.length > 50 ? '...' : ''),
          created_at: message.send_at,
          is_read: false
        });
      });

      // Trier par date (plus récent en premier)
      allNotifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // Pagination
      const paginatedNotifications = allNotifications.slice(skip, skip + limit);
      const total = allNotifications.length;
      const totalPages = Math.ceil(total / limit);
      const unreadCount = allNotifications.length;

      res.json({
        notifications: paginatedNotifications,
        unreadCount,
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
   * Obtenir uniquement les notifications de likes
   */
  static async getLikeNotifications(req, res) {
    try {
      const userId = req.user.id_user;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const [likes, total] = await Promise.all([
        // ✅ CORRECTION: Likes sans auto-likes
        prisma.like.findMany({
          where: {
            notif_view: false,
            id_user: {
              not: userId // ✅ Éviter les auto-likes
            },
            post: {
              id_user: userId, // ✅ Seulement les posts de l'utilisateur connecté
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
                prenom: true,
                nom: true
              }
            },
            post: {
              select: { id_post: true, content: true }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        // ✅ CORRECTION: Count sans auto-likes
        prisma.like.count({
          where: {
            notif_view: false,
            id_user: {
              not: userId // ✅ Éviter les auto-likes
            },
            post: {
              id_user: userId, // ✅ Seulement les posts de l'utilisateur connecté
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
          content: `${like.user.username} a aimé votre publication`,
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
      const userId = req.user.id_user;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      // ✅ CORRECTION: Requête SQL brute pour les mentions
      const [mentions, total] = await Promise.all([
        prisma.$queryRaw`
          SELECT 
            m.id_user,
            m.id_post,
            m.notif_view,
            p.id_post as post_id,
            p.content as post_content,
            p.created_at as post_created_at,
            u.id_user as author_user_id,
            u.username as author_username,
            u.photo_profil as author_photo,
            u.prenom as author_prenom,
            u.nom as author_nom
          FROM cercle.mentions m
          INNER JOIN cercle.post p ON m.id_post = p.id_post
          INNER JOIN cercle.users u ON p.id_user = u.id_user
          WHERE m.id_user = ${userId}
            AND m.notif_view = false
            AND p.active = true
            AND u.is_active = true
          ORDER BY p.created_at DESC
          LIMIT ${limit} OFFSET ${skip}
        `,
        prisma.$queryRaw`
          SELECT COUNT(*)::int as count
          FROM cercle.mentions m
          INNER JOIN cercle.post p ON m.id_post = p.id_post
          INNER JOIN cercle.users u ON p.id_user = u.id_user
          WHERE m.id_user = ${userId}
            AND m.notif_view = false
            AND p.active = true
            AND u.is_active = true
        `.then(result => result[0]?.count || 0)
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        notifications: mentions.map(mention => ({
          id: `mention_${mention.id_user}_${mention.id_post}`,
          type: 'mention',
          from_user: {
            id_user: mention.author_user_id,
            username: mention.author_username,
            photo_profil: mention.author_photo,
            prenom: mention.author_prenom,
            nom: mention.author_nom
          },
          content: `${mention.author_username} vous a mentionné dans une publication`,
          related_post: {
            id_post: mention.post_id,
            content: mention.post_content
          },
          created_at: mention.post_created_at,
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
   * Obtenir uniquement les notifications de follow
   */
  static async getFollowNotifications(req, res) {
    try {
      const userId = req.user.id_user;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const [follows, total] = await Promise.all([
        // ✅ CORRECTION: Follows sans auto-follows
        prisma.follow.findMany({
          where: {
            account: userId,
            notif_view: false,
            active: true,
            pending: false,
            follower: {
              not: userId // ✅ Éviter les auto-follows
            },
            follower_user: {
              is_active: true
            }
          },
          include: {
            follower_user: {
              select: { 
                id_user: true, 
                username: true, 
                photo_profil: true,
                prenom: true,
                nom: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        // ✅ CORRECTION: Count sans auto-follows
        prisma.follow.count({
          where: {
            account: userId,
            notif_view: false,
            active: true,
            pending: false,
            follower: {
              not: userId // ✅ Éviter les auto-follows
            },
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
          content: `${follow.follower_user.username} a commencé à vous suivre`,
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
   * Marquer une notification de mention comme lue
   */
  static async markMentionNotificationAsRead(req, res) {
    try {
      const { notificationId } = req.params;
      const [, userId, postId] = notificationId.split('_');

      const mention = await prisma.mention.findFirst({
        where: {
          id_user: req.user.id_user,
          id_post: parseInt(postId)
        }
      });

      if (!mention) {
        return res.status(404).json({ error: 'Mention notification not found' });
      }

      await prisma.mention.update({
        where: {
          id_user_id_post: {
            id_user: req.user.id_user,
            id_post: parseInt(postId)
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
}

module.exports = NotificationController;