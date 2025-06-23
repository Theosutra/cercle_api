// src/controllers/adminController.js - VERSION COMPLÈTE CORRIGÉE
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

      res.json({
        stats: {
          users: {
            total: totalUsers,
            active: activeUsers,
            new_this_week: newUsers7d
          },
          posts: {
            total: totalPosts,
            active: activePosts,
            new_this_week: newPosts7d
          },
          reports: {
            total: totalReports,
            pending: pendingReports,
            new_this_week: newReports7d
          },
          bans: {
            active: activeBans
          }
        },
        recent_activity: {
          new_users_7d: newUsers7d,
          new_posts_7d: newPosts7d,
          new_reports_7d: newReports7d
        }
      });

    } catch (error) {
      logger.error('Dashboard error:', error);
      console.error('Dashboard error details:', error);
      res.status(500).json({ error: 'Erreur lors du chargement du dashboard' });
    }
  }

  /**
   * ✅ NOUVEAU : Statistiques détaillées pour l'overview
   */
  static async getDashboardStats(req, res) {
    try {
      const currentDate = new Date();
      const yesterday = new Date(currentDate.getTime() - 24 * 60 * 60 * 1000);
      const lastWeek = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      const lastMonth = new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Statistiques utilisateurs
      const [totalUsers, activeUsers, usersToday, usersYesterday] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { is_active: true } }),
        prisma.user.count({ where: { created_at: { gte: currentDate } } }),
        prisma.user.count({ where: { created_at: { gte: yesterday, lt: currentDate } } })
      ]);

      // Statistiques posts
      const [totalPosts, activePosts, postsToday, postsYesterday] = await Promise.all([
        prisma.post.count(),
        prisma.post.count({ where: { active: true } }),
        prisma.post.count({ where: { created_at: { gte: currentDate } } }),
        prisma.post.count({ where: { created_at: { gte: yesterday, lt: currentDate } } })
      ]);

      // Statistiques reports
      let totalReports = 0, pendingReports = 0, resolvedToday = 0, reportsYesterday = 0;
      try {
        [totalReports, pendingReports, resolvedToday, reportsYesterday] = await Promise.all([
          prisma.report.count(),
          prisma.report.count({ where: { processed: false } }),
          prisma.report.count({ where: { processed: true, processed_at: { gte: currentDate } } }),
          prisma.report.count({ where: { reported_at: { gte: yesterday, lt: currentDate } } })
        ]);
      } catch (error) {
        console.log('Reports table not available, using defaults');
      }

      // Statistiques bans
      const [activeBans, bansExpiredToday, bansThisMonth] = await Promise.all([
        prisma.userBannissement.count({
          where: {
            debut_ban: { lte: currentDate },
            fin_ban: { gte: currentDate }
          }
        }).catch(() => 0),
        prisma.userBannissement.count({
          where: {
            fin_ban: { gte: yesterday, lt: currentDate }
          }
        }).catch(() => 0),
        prisma.userBannissement.count({
          where: {
            debut_ban: { gte: lastMonth }
          }
        }).catch(() => 0)
      ]);

      // Calcul des taux de croissance
      const userGrowthRate = usersYesterday > 0 ? ((usersToday - usersYesterday) / usersYesterday) * 100 : 0;
      const postGrowthRate = postsYesterday > 0 ? ((postsToday - postsYesterday) / postsYesterday) * 100 : 0;
      const reportTrend = reportsYesterday > 0 ? ((pendingReports - reportsYesterday) / reportsYesterday) * 100 : 0;

      // Calcul du taux d'engagement (likes + commentaires / posts)
      const totalInteractions = await prisma.like.count().catch(() => 0);
      const engagementRate = totalPosts > 0 ? (totalInteractions / totalPosts) * 100 : 0;

      // Taux de résolution des reports
      const resolutionRate = totalReports > 0 ? ((totalReports - pendingReports) / totalReports) * 100 : 0;

      res.json({
        users: {
          total: totalUsers,
          active: activeUsers,
          new_today: usersToday,
          growth_rate: userGrowthRate
        },
        posts: {
          total: totalPosts,
          active: activePosts,
          new_today: postsToday,
          growth_rate: postGrowthRate,
          engagement_rate: engagementRate
        },
        reports: {
          total: totalReports,
          pending: pendingReports,
          resolved_today: resolvedToday,
          resolution_rate: resolutionRate,
          trend: reportTrend
        },
        bans: {
          active: activeBans,
          expired_today: bansExpiredToday,
          total_this_month: bansThisMonth,
          trend: 0 // Placeholder
        }
      });

    } catch (error) {
      logger.error('Get dashboard stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * ✅ NOUVEAU : Activité récente détaillée
   */
  static async getRecentActivity(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 10;
      const activities = [];

      // Nouveaux utilisateurs (dernières 24h)
      const newUsers = await prisma.user.findMany({
        where: {
          created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        },
        select: {
          username: true,
          created_at: true
        },
        orderBy: { created_at: 'desc' },
        take: 5
      });

      newUsers.forEach(user => {
        activities.push({
          type: 'user_registered',
          description: `Nouvel utilisateur inscrit`,
          user: user.username,
          timestamp: user.created_at
        });
      });

      // Nouveaux posts (dernières 24h)
      const newPosts = await prisma.post.findMany({
        where: {
          created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        },
        include: {
          user: { select: { username: true } }
        },
        orderBy: { created_at: 'desc' },
        take: 5
      });

      newPosts.forEach(post => {
        activities.push({
          type: 'post_created',
          description: `Nouveau post publié`,
          user: post.user.username,
          timestamp: post.created_at
        });
      });

      // Bannissements récents
      try {
        const recentBans = await prisma.userBannissement.findMany({
          where: {
            debut_ban: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          },
          include: {
            user_banni_rel: { select: { username: true } },
            banni_by_rel: { select: { username: true } }
          },
          orderBy: { debut_ban: 'desc' },
          take: 3
        });

        recentBans.forEach(ban => {
          activities.push({
            type: 'user_banned',
            description: `Utilisateur banni`,
            user: ban.banni_by_rel?.username || 'Admin',
            details: ban.user_banni_rel?.username,
            timestamp: ban.debut_ban
          });
        });
      } catch (error) {
        console.log('Bans table not available');
      }

      // Reports récents
      try {
        const recentReports = await prisma.report.findMany({
          where: {
            reported_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          },
          include: {
            user: { select: { username: true } }
          },
          orderBy: { reported_at: 'desc' },
          take: 3
        });

        recentReports.forEach(report => {
          activities.push({
            type: report.processed ? 'report_resolved' : 'report_created',
            description: report.processed ? 'Signalement résolu' : 'Nouveau signalement',
            user: report.user?.username || 'Anonyme',
            timestamp: report.reported_at
          });
        });
      } catch (error) {
        console.log('Reports table not available');
      }

      // Trier par date et limiter
      activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      res.json({
        activities: activities.slice(0, limit)
      });

    } catch (error) {
      logger.error('Get recent activity error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * ✅ NOUVEAU : État de santé du système
   */
  static async getSystemHealth(req, res) {
    try {
      const startTime = Date.now();

      // Test de la base de données
      let databaseStatus = 'operational';
      let databaseLatency = 0;
      try {
        const dbStart = Date.now();
        await prisma.user.count();
        databaseLatency = Date.now() - dbStart;
        
        if (databaseLatency > 1000) databaseStatus = 'warning';
        if (databaseLatency > 3000) databaseStatus = 'error';
      } catch (error) {
        databaseStatus = 'error';
        databaseLatency = -1;
      }

      // État de l'API
      const apiLatency = Date.now() - startTime;
      let apiStatus = 'operational';
      if (apiLatency > 500) apiStatus = 'warning';
      if (apiLatency > 1500) apiStatus = 'error';

      // Uptime du processus
      const uptimeSeconds = process.uptime();
      const uptimeHours = Math.floor(uptimeSeconds / 3600);
      const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
      const uptimeString = `${uptimeHours}h ${uptimeMinutes}m`;

      // Utilisation mémoire
      const memUsage = process.memoryUsage();
      const memUsagePercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
      let storageStatus = 'operational';
      if (memUsagePercent > 80) storageStatus = 'warning';
      if (memUsagePercent > 95) storageStatus = 'error';

      res.json({
        database: {
          status: databaseStatus,
          latency: databaseLatency
        },
        api: {
          status: apiStatus,
          uptime: uptimeString,
          latency: apiLatency
        },
        storage: {
          status: storageStatus,
          usage: memUsagePercent
        },
        overall_status: databaseStatus === 'error' || apiStatus === 'error' || storageStatus === 'error' 
          ? 'error' 
          : databaseStatus === 'warning' || apiStatus === 'warning' || storageStatus === 'warning'
          ? 'warning'
          : 'operational'
      });

    } catch (error) {
      logger.error('Get system health error:', error);
      res.status(500).json({
        database: { status: 'error', latency: -1 },
        api: { status: 'error', uptime: '0h 0m', latency: -1 },
        storage: { status: 'error', usage: 0 },
        overall_status: 'error'
      });
    }
  }

  /**
   * Récupérer tous les posts - Version sécurisée CORRIGÉE
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

      const [posts, totalCount] = await Promise.all([
        prisma.post.findMany({
          where: whereClause,
          include: {
            user: {
              select: {
                id_user: true,
                username: true,
                mail: true,
                nom: true,
                prenom: true,
                photo_profil: true,
                certified: true
              }
            },
            _count: {
              select: {
                likes: true,
                replies: true // ✅ CORRECTION : 'replies' au lieu de 'commentaires'
              }
            }
          },
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: limit
        }),
        prisma.post.count({ where: whereClause })
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      // ✅ CORRECTION : Format attendu par le frontend AdminPosts
      res.json({
        posts: posts.map(post => ({
          id_post: post.id_post,
          content: post.content,
          active: post.active,
          created_at: post.created_at,
          updated_at: post.updated_at,
          author: {
            id_user: post.user.id_user,
            username: post.user.username,
            mail: post.user.mail,
            nom: post.user.nom,
            prenom: post.user.prenom,
            photo_profil: post.user.photo_profil,
            certified: post.user.certified
          },
          stats: {
            likes: post._count.likes,
            comments: post._count.replies // ✅ CORRECTION : mapping replies -> comments
          }
        })),
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
      logger.error('Get all posts error:', error);
      console.error('Posts error details:', error);
      res.status(500).json({ 
        error: 'Erreur lors du chargement des posts',
        posts: [],
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
   * Récupérer les posts signalés - Version sécurisée
   */
  static async getReportedPosts(req, res) {
    try {
      console.log('Get reported posts called');
      
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const offset = (page - 1) * limit;

      try {
        // Essayer d'accéder aux reports
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
                      mail: true
                    }
                  },
                  _count: {
                    select: {
                      likes: true,
                      commentaires: true
                    }
                  }
                }
              },
              user: {
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
   * ✅ CORRECTION COMPLÈTE : Bannir un utilisateur
   */
  static async banUser(req, res) {
    try {
      const { userId } = req.params;
      const { raison, duration_hours } = req.body;

      // ✅ Validation des données
      if (!raison || !duration_hours) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Raison et durée sont requis'
        });
      }

      if (raison.trim().length < 5) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'La raison doit contenir au moins 5 caractères'
        });
      }

      const durationNum = parseInt(duration_hours);
      if (isNaN(durationNum) || durationNum < 1 || durationNum > 8760) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'La durée doit être entre 1 et 8760 heures'
        });
      }

      // ✅ Gestion flexible des ID (UUID ou entier)
      const targetUserWhere = isNaN(userId) 
        ? { id_user: userId } // UUID string
        : { id_user: parseInt(userId) }; // Integer

      // Vérifier que l'utilisateur existe
      const targetUser = await prisma.user.findUnique({
        where: targetUserWhere,
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

      // Empêcher de se bannir soi-même
      if (targetUser.id_user === req.user.id_user) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Vous ne pouvez pas vous bannir vous-même'
        });
      }

      const currentDate = new Date();
      const banEndDate = new Date(currentDate.getTime() + durationNum * 60 * 60 * 1000);

      // ✅ Vérifier s'il y a déjà un ban actif
      const existingBan = await prisma.userBannissement.findFirst({
        where: {
          user_banni: targetUser.id_user,
          debut_ban: { lte: currentDate },
          fin_ban: { gte: currentDate }
        }
      });

      if (existingBan) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Cet utilisateur est déjà banni'
        });
      }

      try {
        // ✅ CORRECTION CRITIQUE : Utiliser 'banni_by' au lieu de 'admin_bannisseur'
        // selon le schéma Prisma
        await prisma.userBannissement.create({
          data: {
            user_banni: targetUser.id_user,
            banni_by: req.user.id_user, // ✅ Bon nom de champ selon le schéma
            raison: raison.trim(),
            debut_ban: currentDate,
            fin_ban: banEndDate
          }
        });

        logger.warn(`User banned: ${targetUser.username} by ${req.user.username}. Reason: ${raison}`);

        res.json({
          message: 'Utilisateur banni avec succès',
          ban_details: {
            user: targetUser.username,
            reason: raison.trim(),
            duration_hours: durationNum,
            ban_end: banEndDate
          }
        });

      } catch (banError) {
        // ✅ Gestion des erreurs Prisma spécifiques
        if (banError.code === 'P2002') {
          return res.status(409).json({
            error: 'Conflict',
            message: 'Un bannissement existe déjà pour cet utilisateur'
          });
        }
        
        if (banError.code === 'P2003') {
          return res.status(400).json({
            error: 'Foreign key constraint',
            message: 'Erreur de référence utilisateur'
          });
        }
        
        console.error('Prisma ban error:', banError);
        throw banError;
      }

    } catch (error) {
      logger.error('Ban user error:', error);
      console.error('Ban error details:', error);
      res.status(500).json({ 
        error: 'Erreur lors du bannissement',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * ✅ CORRECTION COMPLÈTE : Supprimer un utilisateur (soft delete)
   */
  static async deleteUser(req, res) {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      // ✅ Gestion flexible des ID (UUID ou entier)
      const targetUserWhere = isNaN(userId) 
        ? { id_user: userId } // UUID string
        : { id_user: parseInt(userId) }; // Integer

      // Vérifier que l'utilisateur existe
      const targetUser = await prisma.user.findUnique({
        where: targetUserWhere,
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

      // Empêcher de se supprimer soi-même
      if (targetUser.id_user === req.user.id_user) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Vous ne pouvez pas vous supprimer vous-même'
        });
      }

      // Soft delete : désactiver l'utilisateur
      await prisma.user.update({
        where: targetUserWhere,
        data: {
          is_active: false,
          updated_at: new Date()
        }
      });

      logger.warn(`User deleted: ${targetUser.username} by ${req.user.username}. Reason: ${reason || 'No reason provided'}`);

      res.json({
        message: 'Utilisateur supprimé avec succès',
        user: {
          id_user: targetUser.id_user,
          username: targetUser.username
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

      // ✅ Gestion flexible des ID (UUID ou entier)
      const targetPostWhere = isNaN(postId) 
        ? { id_post: postId } // UUID string
        : { id_post: parseInt(postId) }; // Integer

      // Vérifier que le post existe
      const targetPost = await prisma.post.findUnique({
        where: targetPostWhere,
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
        where: targetPostWhere,
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
   * ✅ CORRECTION COMPLÈTE : Changer le rôle d'un utilisateur (admin uniquement)
   */
  static async changeUserRole(req, res) {
    try {
      const { userId } = req.params;
      const { new_role } = req.body;

      // ✅ Validation stricte du rôle
      if (!new_role || !['USER', 'MODERATOR', 'ADMIN'].includes(new_role.toUpperCase())) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Rôle invalide. Valeurs acceptées: USER, MODERATOR, ADMIN'
        });
      }

      const normalizedRole = new_role.toUpperCase();

      // ✅ Gestion flexible des ID (UUID ou entier)
      const targetUserWhere = isNaN(userId) 
        ? { id_user: userId } // UUID string
        : { id_user: parseInt(userId) }; // Integer

      // Vérifier que l'utilisateur existe
      const targetUser = await prisma.user.findUnique({
        where: targetUserWhere,
        include: { role: true }
      });

      if (!targetUser) {
        return res.status(404).json({
          error: 'User not found',
          message: 'Utilisateur non trouvé'
        });
      }

      // Empêcher de modifier son propre rôle
      if (targetUser.id_user === req.user.id_user) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Vous ne pouvez pas modifier votre propre rôle'
        });
      }

      // Empêcher de rétrograder le dernier admin
      if (targetUser.role?.role === 'ADMIN' && normalizedRole !== 'ADMIN') {
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
      const roleRecord = await prisma.role.findFirst({
        where: { role: normalizedRole }
      });

      if (!roleRecord) {
        return res.status(400).json({
          error: 'Invalid role',
          message: 'Rôle non trouvé dans la base de données'
        });
      }

      // Mettre à jour le rôle
      await prisma.user.update({
        where: targetUserWhere,
        data: {
          id_role: roleRecord.id_role,
          updated_at: new Date()
        }
      });

      logger.info(`Role changed: ${targetUser.username} -> ${normalizedRole} by ${req.user.username}`);

      res.json({
        message: 'Rôle modifié avec succès',
        user: {
          id_user: targetUser.id_user,
          username: targetUser.username,
          old_role: targetUser.role?.role,
          new_role: normalizedRole
        }
      });

    } catch (error) {
      logger.error('Change user role error:', error);
      console.error('Role change error details:', error);
      res.status(500).json({ error: 'Erreur lors du changement de rôle' });
    }
  }

  /**
   * ✅ NOUVELLE MÉTHODE : Obtenir les statistiques détaillées d'un utilisateur
   */
  static async getUserStats(req, res) {
    try {
      const { userId } = req.params;

      // ✅ Gestion flexible des ID (UUID ou entier)
      const targetUserWhere = isNaN(userId) 
        ? { id_user: userId } // UUID string
        : { id_user: parseInt(userId) }; // Integer

      const user = await prisma.user.findUnique({
        where: targetUserWhere,
        include: {
          role: true,
          _count: {
            select: {
              posts: true,
              likes: true,
              followers: true,
              following: true,
              messages_sent: true,
              messages_received: true
            }
          }
        }
      });

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          message: 'Utilisateur non trouvé'
        });
      }

      // Statistiques des bannissements
      let banHistory = [];
      try {
        banHistory = await prisma.userBannissement.findMany({
          where: { user_banni: user.id_user },
          include: {
            banni_by_rel: {
              select: { username: true }
            }
          },
          orderBy: { debut_ban: 'desc' },
          take: 5
        });
      } catch (banError) {
        console.log('Ban history not available');
      }

      res.json({
        user: {
          id_user: user.id_user,
          username: user.username,
          mail: user.mail,
          nom: user.nom,
          prenom: user.prenom,
          role: user.role?.role || 'USER',
          is_active: user.is_active,
          created_at: user.created_at,
          last_login: user.last_login
        },
        stats: {
          posts: user._count.posts,
          likes_given: user._count.likes,
          followers: user._count.followers || 0,
          following: user._count.following || 0,
          messages_sent: user._count.messages_sent || 0,
          messages_received: user._count.messages_received || 0
        },
        ban_history: banHistory.map(ban => ({
          id: ban.id_bannissement,
          reason: ban.raison,
          start: ban.debut_ban,
          end: ban.fin_ban,
          banned_by: ban.banni_by_rel?.username || 'Unknown',
          is_active: ban.debut_ban <= new Date() && ban.fin_ban >= new Date()
        }))
      });

    } catch (error) {
      logger.error('Get user stats error:', error);
      console.error('User stats error details:', error);
      res.status(500).json({ error: 'Erreur lors du chargement des statistiques' });
    }
  }

  /**
   * ✅ NOUVELLE MÉTHODE : Recherche avancée d'utilisateurs
   */
  static async searchUsers(req, res) {
    try {
      const { q, role, status, page = 1, limit = 20 } = req.query;
      
      if (!q || q.trim().length < 2) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'La recherche doit contenir au moins 2 caractères'
        });
      }

      const offset = (parseInt(page) - 1) * parseInt(limit);
      let whereClause = {
        OR: [
          { username: { contains: q.trim(), mode: 'insensitive' } },
          { mail: { contains: q.trim(), mode: 'insensitive' } },
          { nom: { contains: q.trim(), mode: 'insensitive' } },
          { prenom: { contains: q.trim(), mode: 'insensitive' } }
        ]
      };

      // Filtres additionnels
      if (role) {
        whereClause.role = { role };
      }

      if (status === 'active') {
        whereClause.is_active = true;
      } else if (status === 'inactive') {
        whereClause.is_active = false;
      }

      const [users, totalCount] = await Promise.all([
        prisma.user.findMany({
          where: whereClause,
          include: {
            role: true,
            _count: {
              select: {
                posts: true,
                followers: true,
                following: true
              }
            }
          },
          orderBy: [
            { username: 'asc' },
            { created_at: 'desc' }
          ],
          skip: offset,
          take: parseInt(limit)
        }),
        prisma.user.count({ where: whereClause })
      ]);

      const totalPages = Math.ceil(totalCount / parseInt(limit));

      res.json({
        query: q.trim(),
        users: users.map(user => ({
          id_user: user.id_user,
          username: user.username,
          mail: user.mail,
          nom: user.nom,
          prenom: user.prenom,
          role: user.role?.role || 'USER',
          is_active: user.is_active,
          created_at: user.created_at,
          stats: {
            posts: user._count.posts,
            followers: user._count.followers || 0,
            following: user._count.following || 0
          }
        })),
        pagination: {
          current_page: parseInt(page),
          total_pages: totalPages,
          total_count: totalCount,
          limit: parseInt(limit),
          has_next: parseInt(page) < totalPages,
          has_prev: parseInt(page) > 1
        }
      });

    } catch (error) {
      logger.error('Search users error:', error);
      console.error('Search error details:', error);
      res.status(500).json({ error: 'Erreur lors de la recherche' });
    }
  }
}

module.exports = AdminController;