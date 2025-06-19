const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { requireAdminOrModerator, requireAdmin } = require('../middleware/adminAuth');
const AdminController = require('../controllers/adminController');

const router = express.Router();

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);

// ===============================
// ROUTES ACCESSIBLES AUX ADMIN ET MODÉRATEURS
// ===============================

// Dashboard général
router.get('/dashboard', requireAdminOrModerator, AdminController.getDashboard);

// Gestion des posts
router.get('/posts', requireAdminOrModerator, AdminController.getAllPosts);
router.get('/posts/reported', requireAdminOrModerator, AdminController.getReportedPosts);

// Gestion des utilisateurs - lecture
router.get('/users', requireAdminOrModerator, AdminController.getAllUsers);

// Actions de modération
router.post('/users/:userId/ban', requireAdminOrModerator, AdminController.banUser);
router.delete('/users/:userId', requireAdminOrModerator, AdminController.deleteUser);

// ===============================
// ROUTES RÉSERVÉES AUX ADMINISTRATEURS
// ===============================

// Gestion des rôles - uniquement admin
router.put('/users/:userId/role', requireAdmin, AdminController.changeUserRole);

// ✅ CORRECTION : Supprimer cette route qui n'existe pas encore
// router.post('/users/:userId/restore', requireAdmin, AdminController.restoreUser);

module.exports = router;