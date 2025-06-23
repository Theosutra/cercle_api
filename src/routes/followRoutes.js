// src/routes/followRoutes.js - VERSION CORRIGÉE COMPLÈTE
const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const FollowController = require('../controllers/followController');

const router = express.Router();

// ✅ CORRECTION: Route follow adaptée pour compatibilité URL/Body
router.post('/:id', authenticateToken, async (req, res) => {
  try {
    // Adapter le paramètre URL vers le body attendu par le controller
    req.body.followed_id = req.params.id;
    console.log(`🔄 Follow route: adapting URL param ${req.params.id} to body`);
    return FollowController.followUser(req, res);
  } catch (error) {
    console.error('❌ Follow route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ CORRECTION: Route unfollow corrigée
router.delete('/:id', authenticateToken, FollowController.unfollowUser);

// Routes pour les demandes de suivi
router.get('/requests/pending', authenticateToken, FollowController.getPendingRequests);
router.post('/requests/:id/accept', authenticateToken, FollowController.acceptFollowRequest);
router.post('/requests/:id/reject', authenticateToken, FollowController.rejectFollowRequest);

// Vérifier le statut de suivi
router.get('/status/:id', authenticateToken, FollowController.getFollowStatus);

// Routes avec authentification optionnelle pour voir les listes
router.get('/:id/followers', optionalAuth, FollowController.getFollowers);
router.get('/:id/following', optionalAuth, FollowController.getFollowing);

// ✅ NOUVELLE ROUTE: Annuler une demande de suivi en attente
router.delete('/requests/:id/cancel', authenticateToken, FollowController.cancelFollowRequest);

// ✅ NOUVELLE ROUTE: Marquer les notifications comme lues
router.put('/notifications/:id/read', authenticateToken, FollowController.markFollowNotificationAsRead);

module.exports = router;