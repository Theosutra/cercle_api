const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const FollowController = require('../controllers/followController');

const router = express.Router();

// Routes protégées (nécessitent une authentification)
router.post('/:id', authenticateToken, FollowController.followUser);
router.delete('/:id', authenticateToken, FollowController.unfollowUser);
router.get('/requests/pending', authenticateToken, FollowController.getPendingRequests);
router.post('/requests/:id/accept', authenticateToken, FollowController.acceptFollowRequest);
router.post('/requests/:id/reject', authenticateToken, FollowController.rejectFollowRequest);
router.get('/status/:id', authenticateToken, FollowController.getFollowStatus);

// Routes avec authentification optionnelle
router.get('/:id/followers', optionalAuth, FollowController.getFollowers);
router.get('/:id/following', optionalAuth, FollowController.getFollowing);

module.exports = router;