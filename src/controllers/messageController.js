const prisma = require('../utils/database');
const Joi = require('joi');
const logger = require('../utils/logger');
const { userParamsSchema, paginationSchema } = require('../validators/userValidator');

// Schémas de validation pour les messages
const sendMessageSchema = Joi.object({
  receiver: Joi.alternatives().try(
    Joi.string().pattern(/^\d+$/),
    Joi.number().integer().positive()
  ).required().messages({
    'any.required': 'Receiver ID is required',
    'alternatives.match': 'Receiver ID must be a valid user ID'
  }),
  message: Joi.string().min(1).max(2048).required().messages({
    'string.min': 'Message cannot be empty',
    'string.max': 'Message must not exceed 2048 characters',
    'any.required': 'Message content is required'
  })
});

const updateMessageSchema = Joi.object({
  message: Joi.string().min(1).max(2048).required().messages({
    'string.min': 'Message cannot be empty',
    'string.max': 'Message must not exceed 2048 characters',
    'any.required': 'Message content is required'
  })
});

const messageParamsSchema = Joi.object({
  messageId: Joi.alternatives().try(
    Joi.string().pattern(/^\d+$/),
    Joi.number().integer().positive()
  ).required().messages({
    'any.required': 'Message ID is required',
    'alternatives.match': 'Message ID must be a valid ID'
  })
});

// Fonction utilitaire pour convertir les IDs
const parseUserId = (id) => {
  const parsed = parseInt(id, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error('Invalid user ID format');
  }
  return parsed;
};

const parseMessageId = (id) => {
  const parsed = parseInt(id, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error('Invalid message ID format');
  }
  return parsed;
};

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

      const { receiver: receiverParam, message } = value;

      // Convertir les IDs en entiers
      let receiverId;
      try {
        receiverId = parseUserId(receiverParam);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid receiver ID format' });
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

      // Vérifier que le destinataire existe et est actif
      const receiverUser = await prisma.user.findFirst({
        where: { 
          id_user: receiverId,
          is_active: true
        },
        select: { 
          id_user: true, 
          username: true, 
          private: true,
          photo_profil: true 
        }
      });

      if (!receiverUser) {
        return res.status(404).json({ error: 'Receiver not found or inactive' });
      }

      // Empêcher l'envoi de messages à soi-même
      if (currentUser.id_user === receiverId) {
        return res.status(400).json({ error: 'Cannot send message to yourself' });
      }

      // Pour les comptes privés, vérifier que l'utilisateur suit le destinataire
      if (receiverUser.private) {
        const isFollowing = await prisma.follow.findFirst({
          where: {
            follower: currentUser.id_user,
            account: receiverId,
            active: true,
            pending: false
          }
        });

        if (!isFollowing) {
          return res.status(403).json({ 
            error: 'Cannot send message to private account unless following' 
          });
        }
      }

      // Créer le message
      const newMessage = await prisma.messagePrive.create({
        data: {
          sender: currentUser.id_user,
          receiver: receiverId,
          message: message,
          send_at: new Date(),
          active: true,
          updated_at: new Date()
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

      logger.info(`Message sent from ${currentUser.username} to ${receiverUser.username}`);

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

      // Récupérer les derniers messages de chaque conversation
      const latestMessages = await prisma.$queryRaw`
        WITH ranked_messages AS (
          SELECT 
            m.*,
            ROW_NUMBER() OVER (
              PARTITION BY 
                CASE 
                  WHEN m.sender = ${req.user.id_user} THEN m.receiver 
                  ELSE m.sender 
                END
              ORDER BY m.send_at DESC
            ) as rn
          FROM "cercle"."messages_prives" m
          WHERE 
            (m.sender = ${req.user.id_user} OR m.receiver = ${req.user.id_user})
            AND m.active = true
        )
        SELECT * FROM ranked_messages WHERE rn = 1
        ORDER BY send_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `;

      // Transformer les données pour le frontend
      const conversations = await Promise.all(
        latestMessages.map(async (message) => {
          const otherUserId = message.sender === req.user.id_user 
            ? message.receiver 
            : message.sender;

          // Récupérer les infos de l'autre utilisateur
          const otherUser = await prisma.user.findFirst({
            where: { 
              id_user: otherUserId,
              is_active: true 
            },
            select: {
              id_user: true,
              username: true,
              photo_profil: true,
              certified: true
            }
          });

          if (!otherUser) return null;

          // Compter les messages non lus de cet utilisateur
          const unreadCount = await prisma.messagePrive.count({
            where: {
              sender: otherUserId,
              receiver: req.user.id_user,
              read_at: null,
              active: true
            }
          });

          return {
            otherUser,
            lastMessage: {
              content: message.message,
              senderId: message.sender,
              timestamp: message.send_at,
              isRead: message.read_at !== null
            },
            unreadCount
          };
        })
      );

      // Filtrer les conversations nulles (utilisateurs supprimés)
      const validConversations = conversations.filter(conv => conv !== null);

      res.json(validConversations);
    } catch (error) {
      logger.error('Get conversations error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les messages avec un utilisateur spécifique
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

      const { id: userIdParam } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Convertir les IDs en entiers
      let userId;
      try {
        userId = parseUserId(userIdParam);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      // Vérifier que l'autre utilisateur existe et est actif
      const otherUser = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!otherUser) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      const [messages, total] = await Promise.all([
        prisma.messagePrive.findMany({
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
        prisma.messagePrive.count({
          where: {
            OR: [
              { sender: req.user.id_user, receiver: userId },
              { sender: userId, receiver: req.user.id_user }
            ],
            active: true
          }
        })
      ]);

      // Marquer les messages comme lus automatiquement
      await prisma.messagePrive.updateMany({
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
   * Marquer les messages comme lus
   */
  static async markAsRead(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: userIdParam } = req.params;

      // Convertir l'ID en entier
      let userId;
      try {
        userId = parseUserId(userIdParam);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      // Vérifier que l'autre utilisateur existe et est actif
      const otherUser = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: { id_user: true }
      });

      if (!otherUser) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      const updatedCount = await prisma.messagePrive.updateMany({
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
      const unreadCount = await prisma.messagePrive.count({
        where: {
          receiver: req.user.id_user,
          read_at: null,
          active: true,
          sender_user: {
            is_active: true
          }
        }
      });

      res.json({ unreadCount });
    } catch (error) {
      logger.error('Get unread count error:', error);
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

      const { messageId: messageIdParam } = req.params;

      // Convertir l'ID en entier
      let messageId;
      try {
        messageId = parseMessageId(messageIdParam);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid message ID format' });
      }

      // Vérifier que le message existe et appartient à l'utilisateur
      const message = await prisma.messagePrive.findFirst({
        where: {
          id_message: messageId,
          sender: req.user.id_user, // Seul l'expéditeur peut supprimer
          active: true
        }
      });

      if (!message) {
        return res.status(404).json({ 
          error: 'Message not found or you do not have permission to delete it' 
        });
      }

      // Soft delete (marquer comme inactif)
      await prisma.messagePrive.update({
        where: { id_message: messageId },
        data: { 
          active: false,
          updated_at: new Date()
        }
      });

      logger.info(`Message deleted by ${req.user.username}: ${messageId}`);

      res.json({ message: 'Message deleted successfully' });
    } catch (error) {
      logger.error('Delete message error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Récupérer les personnes à qui on peut envoyer un message
   */
  static async getAvailableContacts(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Récupérer tous les utilisateurs actifs sauf l'utilisateur connecté
      const users = await prisma.user.findMany({
        where: {
          AND: [
            { is_active: true },
            { id_user: { not: req.user.id_user } }
          ]
        },
        select: {
          id_user: true,
          username: true,
          nom: true,
          prenom: true,
          photo_profil: true,
          certified: true,
          private: true
        },
        skip,
        take: limit,
        orderBy: { username: 'asc' }
      });

      // Vérifier s'il existe déjà une conversation avec chaque utilisateur
      const usersWithConversationStatus = await Promise.all(
        users.map(async (user) => {
          const existingConversation = await prisma.messagePrive.findFirst({
            where: {
              OR: [
                { sender: req.user.id_user, receiver: user.id_user },
                { sender: user.id_user, receiver: req.user.id_user }
              ],
              active: true
            }
          });

          return {
            ...user,
            hasConversation: !!existingConversation
          };
        })
      );

      // Compter le total pour la pagination
      const total = await prisma.user.count({
        where: {
          AND: [
            { is_active: true },
            { id_user: { not: req.user.id_user } }
          ]
        }
      });

      const totalPages = Math.ceil(total / limit);

      res.json({
        contacts: usersWithConversationStatus,
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
      logger.error('Get available contacts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = MessageController;