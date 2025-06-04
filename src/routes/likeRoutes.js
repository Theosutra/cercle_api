const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const LikeController = require('../controllers/likeController');

const router = express.Router();

// Routes protégées (nécessitent une authentification)
router.post('/posts/:id', authenticateToken, LikeController.toggleLike);

// Routes avec authentification optionnelle
router.get('/posts/:id', optionalAuth, LikeController.getPostLikes);
router.get('/users/:id/posts', optionalAuth, LikeController.getUserLikedPosts);
router.get('/users/:id/stats', LikeController.getUserLikeStats);

module.exports = router;