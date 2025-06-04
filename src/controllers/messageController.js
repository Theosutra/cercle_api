const prisma = require('../utils/database');
const Joi = require('joi');
const logger = require('../utils/logger');
const { userParamsSchema, paginationSchema } = require('../validators/userValidator');

// Schémas de validation pour les messages
const sendMessageSchema = Joi.object({
  receiver: Joi.string().required().messages({
    'any.required': 'Receiver ID is required',
    'string.base': 'Receiver ID must be a string'
  }),
  message: Joi.string().min(1).max(300).required().messages({
    'string.min': 'Message cannot be empty',
    'string.max': 'Message must not exceed 300 characters',
    'any.required': 'Message content is required'
  })
});

const messageParamsSchema = Joi.object({
  messageId: Joi.string().required().messages({
    'any.required': 'Message ID is required',
    'string.base': 'Message ID must be a string'
  })
});

class MessageController {
  /**
   * Envoyer un message privé
   */
  static async sendMessage(req, res) {
    try {
      const { error, value } = sendMessageSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { receiver, message } = value;

      // Ne peut pas s'envoyer un message à soi-même
      if (receiver === req.user.id_user) {
        return res.status(400).json({ error: 'Cannot send message to yourself' });
      }

      // Vérifier que le destinataire existe
      const receiverUser = await prisma.user.findUnique({
        where: { id_user: receiver },
        select: { id_user: true, username: true, is_active: true }
      });

      if (!receiverUser || !receiverUser.is_active) {
        return res.status(404).json({ error: 'Receiver not found' });
      }

      // Créer le message
      const newMessage = await prisma.message.create({
        data: {
          sender: req.user.id_user,
          receiver,
          message
        },
        include: {
          sender_user: {
            select: {
              id_user: true,
              username: true,
              photo_profil: true
            }
          },
          receiver_user: {
            select: {
              id_user: true,
              username: true,
              photo_profil: true
            }
          }
        }
      });

      logger.info(`Message sent from ${req.user.username} to ${receiverUser.username}`);

      res.status(201).json({
        message: 'Message sent successfully',
        data: newMessage
      });
    } catch (error) {
      logger.error('Send message error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir la liste des conversations
   */
  static async getConversations(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Requête complexe pour obtenir la dernière conversation avec chaque utilisateur
      const conversations = await prisma.$queryRaw`
        WITH latest_messages AS (
          SELECT DISTINCT
            CASE 
              WHEN sender = ${req.user.id_user} THEN receiver
              ELSE sender
            END as other_user,
            MAX(send_at) as last_message_time
          FROM web_groupe_1_messages_prives 
          WHERE (sender = ${req.user.id_user} OR receiver = ${req.user.id_user})
            AND active = true
          GROUP BY other_user
        )
        SELECT 
          lm.other_user,
          lm.last_message_time,
          m.message as last_message,
          m.sender as last_sender,
          m.read_at,
          u.username,
          u.photo_profil,
          u.certified
        FROM latest_messages lm
        JOIN web_groupe_1_messages_prives m ON (
          (m.sender = ${req.user.id_user} AND m.receiver = lm.other_user) OR
          (m.receiver = ${req.user.id_user} AND m.sender = lm.other_user)
        ) AND m.send_at = lm.last_message_time
        JOIN web_groupe_1_users u ON u.id_user = lm.other_user
        WHERE u.is_active = true
        ORDER BY lm.last_message_time DESC
        LIMIT ${limit} OFFSET ${skip}
      `;

      // Compter les messages non lus pour chaque conversation
      const conversationsWithUnread = await Promise.all(
        conversations.map(async (conv) => {
          const unreadCount = await prisma.message.count({
            where: {
              sender: conv.other_user,
              receiver: req.user.id_user,
              read_at: null,
              active: true
            }
          });

          return {
            otherUser: {
              id_user: conv.other_user,
              username: conv.username,
              photo_profil: conv.photo_profil,
              certified: conv.certified
            },
            lastMessage: {
              content: conv.last_message,
              senderId: conv.last_sender,
              timestamp: conv.last_message_time,
              isRead: conv.read_at !== null
            },
            unreadCount
          };
        })
      );

      res.json(conversationsWithUnread);
    } catch (error) {
      logger.error('Get conversations error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les messages d'une conversation
   */
  static async getMessages(req, res) {
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

      // Vérifier que l'autre utilisateur existe
      const otherUser = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { id_user: true, is_active: true }
      });

      if (!otherUser || !otherUser.is_active) {
        return res.status(404).json({ error: 'User not found' });
      }

      const [messages, total] = await Promise.all([
        prisma.message.findMany({
          where: {
            OR: [
              { sender: req.user.id_user, receiver: userId },
              { sender: userId, receiver: req.user.id_user }
            ],
            active: true
          },
          include: {
            sender_user: {
              select: {
                id_user: true,
                username: true,
                photo_profil: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { send_at: 'desc' }
        }),
        prisma.message.count({
          where: {
            OR: [
              { sender: req.user.id_user, receiver: userId },
              { sender: userId, receiver: req.user.id_user }
            ],
            active: true
          }
        })
      ]);

      // Marquer les messages comme lus
      await prisma.message.updateMany({
        where: {
          sender: userId,
          receiver: req.user.id_user,
          read_at: null,
          active: true
        },
        data: {
          read_at: new Date()
        }
      });

      const totalPages = Math.ceil(total / limit);

      res.json({
        messages: messages.reverse(), // Retourner en ordre chronologique
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
      logger.error('Get messages error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Supprimer un message
   */
  static async deleteMessage(req, res) {
    try {
      const { error: paramsError } = messageParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { messageId } = req.params;

      const message = await prisma.message.findUnique({
        where: { id_message: messageId },
        select: { 
          id_message: true, 
          sender: true, 
          active: true 
        }
      });

      if (!message || !message.active) {
        return res.status(404).json({ error: 'Message not found' });
      }

      if (message.sender !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Soft delete
      await prisma.message.update({
        where: { id_message: messageId },
        data: { active: false }
      });

      logger.info(`Message deleted by ${req.user.username}: ${messageId}`);

      res.json({ message: 'Message deleted successfully' });
    } catch (error) {
      logger.error('Delete message error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Marquer les messages comme lus
   */
  static async markAsRead(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: userId } = req.params;

      const updatedCount = await prisma.message.updateMany({
        where: {
          sender: userId,
          receiver: req.user.id_user,
          read_at: null,
          active: true
        },
        data: {
          read_at: new Date()
        }
      });

      res.json({ 
        message: 'Messages marked as read',
        count: updatedCount.count 
      });
    } catch (error) {
      logger.error('Mark as read error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir le nombre de messages non lus
   */
  static async getUnreadCount(req, res) {
    try {
      const unreadCount = await prisma.message.count({
        where: {
          receiver: req.user.id_user,
          read_at: null,
          active: true
        }
      });

      res.json({ unreadCount });
    } catch (error) {
      logger.error('Get unread count error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = MessageController;