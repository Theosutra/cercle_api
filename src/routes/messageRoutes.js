const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const MessageController = require('../controllers/messageController');

const router = express.Router();

// Toutes les routes des messages nécessitent une authentification
router.post('/', authenticateToken, MessageController.sendMessage);
router.get('/conversations', authenticateToken, MessageController.getConversations);
router.get('/unread-count', authenticateToken, MessageController.getUnreadCount);
router.get('/:id', authenticateToken, MessageController.getMessages);
router.put('/:id/read', authenticateToken, MessageController.markAsRead);
router.delete('/:messageId', authenticateToken, MessageController.deleteMessage);

module.exports = router;