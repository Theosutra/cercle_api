const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const PostController = require('../controllers/postController');

const router = express.Router();

// Routes publiques avec authentification optionnelle
router.get('/public', optionalAuth, PostController.getPublicTimeline);
router.get('/trending', optionalAuth, PostController.getTrendingPosts);
router.get('/search', optionalAuth, PostController.searchPosts);
router.get('/user/:userId', optionalAuth, PostController.getUserPosts);
router.get('/:id', optionalAuth, PostController.getPost);

// Routes protégées (nécessitent une authentification)
router.post('/', authenticateToken, PostController.createPost);
router.get('/timeline/personal', authenticateToken, PostController.getTimeline);
router.put('/:id', authenticateToken, PostController.updatePost);
router.delete('/:id', authenticateToken, PostController.deletePost);

module.exports = router;