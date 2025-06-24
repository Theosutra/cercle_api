// backend/src/routes/notificationRoutes.js - VERSION COMPLÈTE
const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const NotificationController = require('../controllers/notificationController');

const router = express.Router();

// ✅ CORRECTION: Toutes les routes nécessitent une authentification
router.use(authenticateToken);

// ===============================
// ✅ ROUTES PRINCIPALES
// ===============================

// GET /api/v1/notifications - Obtenir toutes les notifications
router.get('/', NotificationController.getAllNotifications);

// GET /api/v1/notifications/count - Obtenir le nombre de notifications non lues
router.get('/count', NotificationController.getUnreadCount);

// PUT /api/v1/notifications/mark-all-read - Marquer toutes les notifications comme lues
router.put('/mark-all-read', NotificationController.markAllAsRead);

// ===============================
// ✅ ROUTES PAR TYPE
// ===============================

// GET /api/v1/notifications/likes - Obtenir uniquement les notifications de likes
router.get('/likes', NotificationController.getLikeNotifications);

// GET /api/v1/notifications/mentions - Obtenir uniquement les notifications de mentions
router.get('/mentions', NotificationController.getMentionNotifications);

// GET /api/v1/notifications/follows - Obtenir uniquement les notifications de follow
router.get('/follows', NotificationController.getFollowNotifications);

// ===============================
// ✅ ROUTES POUR MARQUER COMME LU
// ===============================

// PUT /api/v1/notifications/mentions/:notificationId/read - Marquer une mention comme lue
router.put('/mentions/:notificationId/read', NotificationController.markMentionNotificationAsRead);

// ===============================
// ✅ TEST ROUTE
// ===============================

// GET /api/v1/notifications/test - Route de test pour vérifier que le système fonctionne
router.get('/test', (req, res) => {
  res.json({
    message: 'Notification system is working!',
    user: {
      id: req.user.id_user,
      username: req.user.username
    },
    timestamp: new Date().toISOString(),
    endpoints: {
      getAll: 'GET /api/v1/notifications',
      getCount: 'GET /api/v1/notifications/count',
      markAllRead: 'PUT /api/v1/notifications/mark-all-read',
      getLikes: 'GET /api/v1/notifications/likes',
      getMentions: 'GET /api/v1/notifications/mentions',
      getFollows: 'GET /api/v1/notifications/follows'
    }
  });
});

module.exports = router;