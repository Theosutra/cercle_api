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

      // Ne peut pas s'envoyer un message à soi-même
      if (receiver === req.user.id_user) {
        return res.status(400).json({ error: 'Cannot send message to yourself' });
      }

      // Vérifier que le destinataire existe et est actif
      const receiverUser = await prisma.user.findFirst({
        where: { 
          id_user: receiver,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!receiverUser) {
        return res.status(404).json({ error: 'Receiver not found or inactive' });
      }

      const now = new Date();

      // Créer le message
      const newMessage = await prisma.messagePrive.create({
        data: {
          sender: req.user.id_user,
          receiver,
          message,
          send_at: now,
          active: true,
          updated_at: now
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
                  WHEN sender = ${req.user.id_user} THEN receiver
                  ELSE sender
                END
              ORDER BY send_at DESC
            ) as rn
          FROM cercle.messages_prives m
          WHERE (sender = ${req.user.id_user} OR receiver = ${req.user.id_user})
            AND active = true
        )
        SELECT * FROM ranked_messages WHERE rn = 1
        ORDER BY send_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `;

      // Enrichir avec les informations des utilisateurs et compter les non lus
      const conversations = await Promise.all(
        latestMessages.map(async (msg) => {
          const otherUserId = msg.sender === req.user.id_user ? msg.receiver : msg.sender;
          
          // Récupérer les infos de l'autre utilisateur (seulement si actif)
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

          // Si l'autre utilisateur n'est plus actif, ignorer cette conversation
          if (!otherUser) {
            return null;
          }

          // Compter les messages non lus de cette conversation
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
              id_message: msg.id_message,
              content: msg.message,
              senderId: msg.sender,
              timestamp: msg.send_at,
              isRead: msg.read_at !== null
            },
            unreadCount
          };
        })
      );

      // Filtrer les conversations null (utilisateurs inactifs)
      const activeConversations = conversations.filter(conv => conv !== null);

      res.json(activeConversations);
    } catch (error) {
      logger.error('Get conversations error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les messages d'une conversation entre 2 utilisateurs
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
   * Modifier un message
   */
  static async updateMessage(req, res) {
    try {
      const { error: paramsError } = messageParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = updateMessageSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { messageId } = req.params;
      const { message } = value;

      // Vérifier que le message existe et est actif
      const existingMessage = await prisma.messagePrive.findFirst({
        where: { 
          id_message: messageId,
          active: true
        },
        select: { 
          id_message: true, 
          sender: true, 
          send_at: true,
          read_at: true
        }
      });

      if (!existingMessage) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Vérifier que l'utilisateur connecté est l'expéditeur
      if (existingMessage.sender !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Vérifier la limite de temps (15 minutes)
      const timeDiff = new Date() - new Date(existingMessage.send_at);
      const fifteenMinutes = 15 * 60 * 1000;
      
      if (timeDiff > fifteenMinutes) {
        return res.status(400).json({ 
          error: 'Message modification time limit exceeded',
          message: 'Messages can only be modified within 15 minutes of sending'
        });
      }

      // Vérifier si le message a été lu (optionnel - à vous de décider)
      if (existingMessage.read_at) {
        return res.status(400).json({ 
          error: 'Cannot modify read message',
          message: 'This message has already been read by the recipient'
        });
      }

      // Mettre à jour le message
      const updatedMessage = await prisma.messagePrive.update({
        where: { id_message: messageId },
        data: { 
          message,
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

      logger.info(`Message updated by ${req.user.username}: ${messageId}`);

      res.json({
        message: 'Message updated successfully',
        data: updatedMessage
      });
    } catch (error) {
      logger.error('Update message error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Supprimer un message (soft delete)
   */
  static async deleteMessage(req, res) {
    try {
      const { error: paramsError } = messageParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { messageId } = req.params;

      // Vérifier que le message existe et est actif
      const message = await prisma.messagePrive.findFirst({
        where: { 
          id_message: messageId,
          active: true
        },
        select: { 
          id_message: true, 
          sender: true
        }
      });

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      // Vérifier que l'utilisateur connecté est l'expéditeur
      if (message.sender !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Soft delete
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
   * Marquer les messages comme lus
   */
  static async markAsRead(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: userId } = req.params;

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
}

module.exports = MessageController;
