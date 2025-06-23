// src/routes/adminRoutes.js - VERSION COMPLÈTE AVEC NOUVEAUX ENDPOINTS

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { requireAdminOrModerator, requireAdmin } = require('../middleware/adminAuth');
const AdminController = require('../controllers/adminController');
const BanController = require('../controllers/banController');

const router = express.Router();

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);

// ===============================
// ROUTES ACCESSIBLES AUX ADMIN ET MODÉRATEURS
// ===============================

// Dashboard général
router.get('/dashboard', requireAdminOrModerator, AdminController.getDashboard);

// ✅ NOUVEAUX ENDPOINTS OPTIMISÉS POUR L'OVERVIEW
router.get('/dashboard/stats', requireAdminOrModerator, AdminController.getDashboardStats);
router.get('/activity/recent', requireAdminOrModerator, AdminController.getRecentActivity);
router.get('/system/health', requireAdminOrModerator, AdminController.getSystemHealth);

// Gestion des posts
router.get('/posts', requireAdminOrModerator, AdminController.getAllPosts);
router.get('/posts/reported', requireAdminOrModerator, AdminController.getReportedPosts);
router.delete('/posts/:postId', requireAdminOrModerator, AdminController.deletePost);

// Gestion des utilisateurs - lecture
router.get('/users', requireAdminOrModerator, AdminController.getAllUsers);
router.get('/users/search', requireAdminOrModerator, AdminController.searchUsers);
router.get('/users/:userId/stats', requireAdminOrModerator, AdminController.getUserStats);

// ✅ NOUVEAU : Vérification du statut de ban d'un utilisateur
router.get('/users/:userId/ban-status', requireAdminOrModerator, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentDate = new Date();
    
    const activeBan = await prisma.userBannissement.findFirst({
      where: {
        user_banni: isNaN(userId) ? userId : parseInt(userId),
        debut_ban: { lte: currentDate },
        fin_ban: { gte: currentDate }
      },
      include: {
        banni_by_rel: {
          select: { username: true }
        }
      }
    });

    if (!activeBan) {
      return res.json({ 
        isBanned: false,
        message: 'No active ban found'
      });
    }

    res.json({
      isBanned: true,
      ban: {
        id_bannissement: activeBan.id_bannissement,
        raison: activeBan.raison,
        debut_ban: activeBan.debut_ban,
        fin_ban: activeBan.fin_ban,
        banni_by: activeBan.banni_by_rel?.username,
        remainingTime: Math.max(0, activeBan.fin_ban - currentDate)
      }
    });
  } catch (error) {
    console.error('Ban status check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ GESTION DES BANNISSEMENTS
router.get('/bans', requireAdminOrModerator, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const currentDate = new Date();

    const [bans, total] = await Promise.all([
      prisma.userBannissement.findMany({
        where: {
          debut_ban: { lte: currentDate },
          fin_ban: { gte: currentDate }
        },
        include: {
          user_banni_rel: {
            select: { username: true, mail: true }
          },
          banni_by_rel: {
            select: { username: true }
          }
        },
        skip,
        take: limit,
        orderBy: { debut_ban: 'desc' }
      }),
      prisma.userBannissement.count({
        where: {
          debut_ban: { lte: currentDate },
          fin_ban: { gte: currentDate }
        }
      })
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      bans: bans.map(ban => ({
        id_bannissement: ban.id_bannissement,
        user_banni: ban.user_banni_rel?.username || 'Utilisateur supprimé',
        user_email: ban.user_banni_rel?.mail || 'Email non disponible',
        banni_by: ban.banni_by_rel?.username || 'Moderateur supprimé',
        raison: ban.raison,
        debut_ban: ban.debut_ban,
        fin_ban: ban.fin_ban,
        remainingTime: Math.max(0, ban.fin_ban - currentDate)
      })),
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_count: total,
        limit,
        has_next: page < totalPages,
        has_prev: page > 1
      }
    });
  } catch (error) {
    console.error('Get active bans error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Actions de modération
router.post('/users/:userId/ban', requireAdminOrModerator, AdminController.banUser);
router.delete('/users/:userId', requireAdminOrModerator, AdminController.deleteUser);

// ✅ NOUVELLES ROUTES : Actions sur les bans
router.delete('/bans/:banId/unban', requireAdminOrModerator, async (req, res) => {
  try {
    const { banId } = req.params;
    const currentDate = new Date();

    // Vérifier que le ban existe et est actif
    const ban = await prisma.userBannissement.findUnique({
      where: { id_bannissement: parseInt(banId) },
      include: {
        user_banni_rel: {
          select: { username: true }
        }
      }
    });

    if (!ban) {
      return res.status(404).json({ error: 'Ban not found' });
    }

    if (ban.fin_ban <= currentDate) {
      return res.status(400).json({ 
        error: 'Ban already expired',
        message: 'Ce bannissement a déjà expiré'
      });
    }

    // Terminer le ban en mettant la date de fin à maintenant
    await prisma.userBannissement.update({
      where: { id_bannissement: parseInt(banId) },
      data: { fin_ban: currentDate }
    });

    logger.info(`User ${ban.user_banni_rel?.username} unbanned by ${req.user.username} (Ban ID: ${banId})`);

    res.json({
      message: 'Utilisateur débanni avec succès',
      unban_details: {
        user: ban.user_banni_rel?.username,
        original_end_date: ban.fin_ban,
        unbanned_at: currentDate,
        unbanned_by: req.user.username
      }
    });

  } catch (error) {
    console.error('Unban user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/bans/:banId', requireAdminOrModerator, BanController.getBanById);
router.get('/users/:userId/bans', requireAdminOrModerator, BanController.getUserBanHistory);
router.put('/bans/:banId/reason', requireAdminOrModerator, BanController.updateBanReason);
router.put('/bans/:banId/duration', requireAdminOrModerator, BanController.updateBanDuration);

// ===============================
// ROUTES RÉSERVÉES AUX ADMINISTRATEURS
// ===============================

// Gestion des rôles - uniquement admin
router.put('/users/:userId/role', requireAdmin, AdminController.changeUserRole);

module.exports = router;