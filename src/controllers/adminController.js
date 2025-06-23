// src/controllers/adminController.js - Version complète et corrigée
const prisma = require('../utils/database');
const logger = require('../utils/logger');
const bcrypt = require('bcrypt');

class AdminController {
  /**
   * Dashboard avec statistiques générales - Version sécurisée
   */
  static async getDashboard(req, res) {
    try {
      console.log('Admin dashboard called by user:', req.user);
      
      const currentDate = new Date();
      const last7Days = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Statistiques de base sécurisées
      const totalUsers = await prisma.user.count().catch(() => 0);
      const activeUsers = await prisma.user.count({ where: { is_active: true } }).catch(() => 0);
      const totalPosts = await prisma.post.count().catch(() => 0);
      const activePosts = await prisma.post.count({ where: { active: true } }).catch(() => 0);

      // Statistiques reports - sécurisées si la table n'existe pas
      let totalReports = 0;
      let pendingReports = 0;
      let newReports7d = 0;
      
      try {
        // Tenter d'accéder à la table report
        totalReports = await prisma.report.count();
        pendingReports = await prisma.report.count({ where: { processed: false } });
        newReports7d = await prisma.report.count({ where: { reported_at: { gte: last7Days } } });
      } catch (reportError) {
        console.log('Table report not available, using default values');
        // Valeurs par défaut si la table n'existe pas
      }

      // Statistiques bannissements - sécurisées
      let activeBans = 0;
      try {
        activeBans = await prisma.userBannissement.count({
          where: {
            debut_ban: { lte: currentDate },
            fin_ban: { gte: currentDate }
          }
        });
      } catch (banError) {
        console.log('Table userBannissement not available, using default value');
      }

      // Activité récente sécurisée
      const newUsers7d = await prisma.user.count({
        where: { created_at: { gte: last7Days } }
      }).catch(() => 0);

      const newPosts7d = await prisma.post.count({
        where: { created_at: { gte: last7Days } }
      }).catch(() => 0);

      const responseData = {
        global_stats: {
          total_users: totalUsers,
          active_users: activeUsers,
          total_posts: totalPosts,
          active_posts: activePosts,
          total_reports: totalReports,
          pending_reports: pendingReports,
          active_bans: activeBans
        },
        recent_activity: {
          new_users_7d: newUsers7d,
          new_posts_7d: newPosts7d,
          new_reports_7d: newReports7d,
          new_bans_7d: 0 // Placeholder
        },
        user_role: req.user.role || 'ADMIN'
      };

      console.log('Dashboard data:', responseData);
      res.json(responseData);

    } catch (error) {
      logger.error('Admin dashboard error:', error);
      console.error('Dashboard error details:', error);
      
      // Retourner des données par défaut en cas d'erreur
      res.json({
        global_stats: {
          total_users: 0,
          active_users: 0,
          total_posts: 0,
          active_posts: 0,
          total_reports: 0,
          pending_reports: 0,
          active_bans: 0
        },
        recent_activity: {
          new_users_7d: 0,
          new_posts_7d: 0,
          new_reports_7d: 0,
          new_bans_7d: 0
        },
        user_role: req.user?.role || 'ADMIN'
      });
    }
  }

  /**
   * Récupérer tous les posts avec pagination - Version sécurisée CORRIGÉE
   */
  static async getAllPosts(req, res) {
    try {
      console.log('Get all posts called');
      
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const status = req.query.status;
      const search = req.query.search;
      const offset = (page - 1) * limit;

      let whereClause = {};

      // Filtrer par statut
      if (status === 'active') {
        whereClause.active = true;
      } else if (status === 'inactive') {
        whereClause.active = false;
      }

      // Recherche dans le contenu
      if (search) {
        whereClause.content = {
          contains: search,
          mode: 'insensitive'
        };
      }

      // ✅ CORRECTION COMPLÈTE : Requête avec includes et pagination
      const [posts, totalCount] = await Promise.all([
        prisma.post.findMany({
          where: whereClause,
          include: {
            user: {
              select: {
                id_user: true,
                username: true,
                nom: true,
                prenom: true,
                photo_profil: true,
                mail: true,
                certified: true,
                private: true,
                is_active: true
              }
            },
            _count: {
              select: {
                likes: { where: { active: true } },
                replies: { where: { active: true } }
              }
            }
          },
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: limit
        }),
        prisma.post.count({
          where: whereClause
        })
      ]);

      // ✅ CORRECTION : Formater les posts avec author mapping
      const formattedPosts = posts.map(post => ({
        ...post,
        author: post.user, // Mapping user -> author pour compatibilité frontend
        likeCount: post._count.likes,
        replyCount: post._count.replies,
        // Nettoyer les propriétés internes
        _count: undefined,
        user: undefined
      }));

      // ✅ CORRECTION : Réponse structurée avec pagination
      const totalPages = Math.ceil(totalCount / limit);
      
      const response = {
        posts: formattedPosts,
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total: totalCount,
          limit: limit,
          has_next: page < totalPages,
          has_prev: page > 1
        }
      };

      console.log(`✅ Admin getAllPosts: ${formattedPosts.length} posts returned`);
      res.json(response);

    } catch (error) {
      logger.error('Admin getAllPosts error:', error);
      console.error('Get all posts error details:', error);
      
      // Retourner une structure par défaut en cas d'erreur
      res.status(500).json({
        posts: [],
        pagination: {
          current_page: 1,
          total_pages: 0,
          total: 0,
          limit: 20,
          has_next: false,
          has_prev: false
        },
        error: 'Erreur lors du chargement des posts'
      });
    }
  }

  /**
   * Récupérer tous les posts signalés - Version sécurisée
   */
  static async getReportedPosts(req, res) {
    try {
      console.log('Get reported posts called');
      
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;

      // Vérifier si la table reports existe
      try {
        await prisma.report.findFirst();
      } catch (tableError) {
        console.log('Table report does not exist, returning empty result');
        return res.json({
          reported_posts: [],
          pagination: {
            current_page: page,
            total_pages: 0,
            total_count: 0,
            limit,
            has_next: false,
            has_prev: false
          }
        });
      }

      // Si la table existe, essayer de récupérer les données
      const offset = (page - 1) * limit;
      
      try {
        const [reportedPosts, totalCount] = await Promise.all([
          prisma.report.findMany({
            where: { processed: false },
            include: {
              post: {
                include: {
                  user: {
                    select: {
                      id_user: true,
                      username: true,
                      nom: true,
                      prenom: true,
                      photo_profil: true
                    }
                  }
                }
              },
              reporter: {
                select: {
                  id_user: true,
                  username: true
                }
              }
            },
            orderBy: { reported_at: 'desc' },
            skip: offset,
            take: limit
          }),
          prisma.report.count({ where: { processed: false } })
        ]);

        const totalPages = Math.ceil(totalCount / limit);

        res.json({
          reported_posts: reportedPosts,
          pagination: {
            current_page: page,
            total_pages: totalPages,
            total_count: totalCount,
            limit,
            has_next: page < totalPages,
            has_prev: page > 1
          }
        });

      } catch (dataError) {
        console.log('Error fetching reported posts data, returning empty result');
        res.json({
          reported_posts: [],
          pagination: {
            current_page: page,
            total_pages: 0,
            total_count: 0,
            limit,
            has_next: false,
            has_prev: false
          }
        });
      }

    } catch (error) {
      logger.error('Get reported posts error:', error);
      console.error('Reports error details:', error);
      res.json({
        reported_posts: [],
        pagination: {
          current_page: 1,
          total_pages: 0,
          total_count: 0,
          limit: 20,
          has_next: false,
          has_prev: false
        }
      });
    }
  }

  /**
   * Récupérer tous les utilisateurs - Version sécurisée
   */
  static async getAllUsers(req, res) {
    try {
      console.log('Get all users called');
      
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const role = req.query.role;
      const status = req.query.status;
      const search = req.query.search;
      const offset = (page - 1) * limit;

      let whereClause = {};

      // Filtrer par rôle
      if (role) {
        whereClause.role = { role };
      }

      // Filtrer par statut
      if (status === 'active') {
        whereClause.is_active = true;
      } else if (status === 'inactive') {
        whereClause.is_active = false;
      }

      // Recherche par nom d'utilisateur ou email
      if (search) {
        whereClause.OR = [
          { username: { contains: search, mode: 'insensitive' } },
          { mail: { contains: search, mode: 'insensitive' } },
          { nom: { contains: search, mode: 'insensitive' } },
          { prenom: { contains: search, mode: 'insensitive' } }
        ];
      }

      const [users, totalCount] = await Promise.all([
        prisma.user.findMany({
          where: whereClause,
          include: {
            role: true,
            _count: {
              select: {
                posts: true
              }
            }
          },
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: limit
        }),
        prisma.user.count({ where: whereClause })
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        users,
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_count: totalCount,
          limit,
          has_next: page < totalPages,
          has_prev: page > 1
        }
      });

    } catch (error) {
      logger.error('Get all users error:', error);
      console.error('Users error details:', error);
      res.status(500).json({ error: 'Erreur lors du chargement des utilisateurs' });
    }
  }

  /**
   * Bannir un utilisateur
   */
  static async banUser(req, res) {
    try {
      const { userId } = req.params;
      const { raison, duration_hours } = req.body;

      if (!raison || !duration_hours) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Raison et durée sont requis'
        });
      }

      // Vérifier que l'utilisateur existe
      const targetUser = await prisma.user.findUnique({
        where: { id_user: parseInt(userId) },
        include: { role: true }
      });

      if (!targetUser) {
        return res.status(404).json({
          error: 'User not found',
          message: 'Utilisateur non trouvé'
        });
      }

      // Empêcher de bannir un admin
      if (targetUser.role?.role === 'ADMIN') {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Impossible de bannir un administrateur'
        });
      }

      const currentDate = new Date();
      const banEndDate = new Date(currentDate.getTime() + duration_hours * 60 * 60 * 1000);

      try {
        // Créer le bannissement
        await prisma.userBannissement.create({
          data: {
            user_banni: parseInt(userId),
            admin_bannisseur: req.user.id_user,
            raison,
            debut_ban: currentDate,
            fin_ban: banEndDate
          }
        });

        logger.warn(`User banned: ${targetUser.username} by ${req.user.username}. Reason: ${raison}`);

        res.json({
          message: 'Utilisateur banni avec succès',
          ban_details: {
            user: targetUser.username,
            reason: raison,
            duration_hours,
            ban_end: banEndDate
          }
        });

      } catch (banError) {
        if (banError.code === 'P2002') {
          return res.status(409).json({
            error: 'Conflict',
            message: 'Cet utilisateur est déjà banni'
          });
        }
        throw banError;
      }

    } catch (error) {
      logger.error('Ban user error:', error);
      console.error('Ban error details:', error);
      res.status(500).json({ error: 'Erreur lors du bannissement' });
    }
  }

  /**
   * Supprimer un utilisateur (soft delete)
   */
  static async deleteUser(req, res) {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      // Vérifier que l'utilisateur existe
      const targetUser = await prisma.user.findUnique({
        where: { id_user: parseInt(userId) },
        include: { role: true }
      });

      if (!targetUser) {
        return res.status(404).json({
          error: 'User not found',
          message: 'Utilisateur non trouvé'
        });
      }

      // Empêcher de supprimer un admin
      if (targetUser.role?.role === 'ADMIN') {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Impossible de supprimer un administrateur'
        });
      }

      // Soft delete : désactiver l'utilisateur
      await prisma.user.update({
        where: { id_user: parseInt(userId) },
        data: {
          is_active: false,
          updated_at: new Date()
        }
      });

      logger.warn(`User deleted: ${targetUser.username} by ${req.user.username}. Reason: ${reason || 'No reason provided'}`);

      res.json({
        message: 'Utilisateur supprimé avec succès',
        deleted_user: {
          id_user: targetUser.id_user,
          username: targetUser.username,
          deletion_reason: reason || 'No reason provided'
        }
      });

    } catch (error) {
      logger.error('Delete user error:', error);
      console.error('Delete error details:', error);
      res.status(500).json({ error: 'Erreur lors de la suppression' });
    }
  }

  /**
   * Supprimer un post (admin/modérateur)
   */
  static async deletePost(req, res) {
    try {
      const { postId } = req.params;
      const { reason } = req.body;

      // Vérifier que le post existe
      const targetPost = await prisma.post.findUnique({
        where: { id_post: parseInt(postId) },
        include: {
          user: {
            select: {
              id_user: true,
              username: true
            }
          }
        }
      });

      if (!targetPost) {
        return res.status(404).json({
          error: 'Post not found',
          message: 'Post non trouvé'
        });
      }

      // Soft delete : désactiver le post au lieu de le supprimer complètement
      await prisma.post.update({
        where: { id_post: parseInt(postId) },
        data: {
          active: false,
          updated_at: new Date()
        }
      });

      logger.warn(`Post deleted: ID ${postId} by admin ${req.user.username}. Reason: ${reason || 'No reason provided'}`);

      res.json({
        message: 'Post supprimé avec succès',
        deleted_post: {
          id_post: targetPost.id_post,
          author: targetPost.user?.username,
          deletion_reason: reason || 'No reason provided',
          deleted_by: req.user.username,
          deleted_at: new Date()
        }
      });

    } catch (error) {
      logger.error('Delete post error:', error);
      console.error('Delete post error details:', error);
      res.status(500).json({ error: 'Erreur lors de la suppression du post' });
    }
  }

  /**
   * Changer le rôle d'un utilisateur (admin uniquement)
   */
  static async changeUserRole(req, res) {
    try {
      const { userId } = req.params;
      const { new_role } = req.body;

      // Vérifier que seuls les admins peuvent changer les rôles
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Seuls les administrateurs peuvent modifier les rôles'
        });
      }

      if (!new_role || !['USER', 'MODERATOR', 'ADMIN'].includes(new_role)) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Rôle invalide. Valeurs acceptées: USER, MODERATOR, ADMIN'
        });
      }

      // Vérifier que l'utilisateur existe
      const targetUser = await prisma.user.findUnique({
        where: { id_user: parseInt(userId) },
        include: { role: true }
      });

      if (!targetUser) {
        return res.status(404).json({
          error: 'User not found',
          message: 'Utilisateur non trouvé'
        });
      }

      // Empêcher de rétrograder le dernier admin
      if (targetUser.role?.role === 'ADMIN' && new_role !== 'ADMIN') {
        const adminCount = await prisma.user.count({
          where: {
            role: { role: 'ADMIN' },
            is_active: true
          }
        });

        if (adminCount <= 1) {
          return res.status(403).json({
            error: 'Access denied',
            message: 'Impossible de rétrograder le dernier administrateur'
          });
        }
      }

      // Trouver l'ID du nouveau rôle
      const roleRecord = await prisma.role.findUnique({
        where: { role: new_role }
      });

      if (!roleRecord) {
        return res.status(400).json({
          error: 'Invalid role',
          message: 'Rôle non trouvé dans la base de données'
        });
      }

      // Mettre à jour le rôle
      await prisma.user.update({
        where: { id_user: parseInt(userId) },
        data: {
          id_role: roleRecord.id_role,
          updated_at: new Date()
        }
      });

      logger.info(`Role changed: ${targetUser.username} -> ${new_role} by ${req.user.username}`);

      res.json({
        message: 'Rôle modifié avec succès',
        user: {
          id_user: targetUser.id_user,
          username: targetUser.username,
          old_role: targetUser.role?.role,
          new_role: new_role
        }
      });

    } catch (error) {
      logger.error('Change user role error:', error);
      console.error('Role change error details:', error);
      res.status(500).json({ error: 'Erreur lors du changement de rôle' });
    }
  }
}

module.exports = AdminController;