const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const UserController = require('../controllers/userController');

const router = express.Router();

// Routes protégées (nécessitent une authentification)
router.get('/me', authenticateToken, UserController.getProfile);
router.put('/me', authenticateToken, UserController.updateProfile);
router.get('/suggested', authenticateToken, UserController.getSuggestedUsers);

// Routes avec authentification optionnelle
router.get('/search', optionalAuth, UserController.searchUsers);
router.get('/:id', optionalAuth, UserController.getUserById);
router.get('/:id/stats', optionalAuth, UserController.getUserStats);

module.exports = router;