const prisma = require('../utils/database');
const logger = require('../utils/logger');

class AdminController {
  /**
   * Dashboard avec statistiques générales
   */
  static async getDashboard(req, res) {
    try {
      const currentDate = new Date();
      const last30Days = new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      const last7Days = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Statistiques globales
      const [
        totalUsers,
        activeUsers,
        totalPosts,
        activePosts,
        totalReports,
        pendingReports,
        activeBans
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { is_active: true } }),
        prisma.post.count(),
        prisma.post.count({ where: { active: true } }),
        prisma.report?.count() || 0, // Peut ne pas exister
        prisma.report?.count({ where: { processed: false } }) || 0,
        prisma.userBannissement.count({
          where: {
            debut_ban: { lte: currentDate },
            fin_ban: { gte: currentDate }
          }
        })
      ]);

      // Activité récente
      const recentActivity = {
        new_users_7d: await prisma.user.count({
          where: { created_at: { gte: last7Days } }
        }),
        new_posts_7d: await prisma.post.count({
          where: { created_at: { gte: last7Days } }
        }),
        new_reports_7d: prisma.report ? await prisma.report.count({
          where: { reported_at: { gte: last7Days } }
        }) : 0
      };

      res.json({
        global_stats: {
          total_users: totalUsers,
          active_users: activeUsers,
          total_posts: totalPosts,
          active_posts: activePosts,
          total_reports: totalReports,
          pending_reports: pendingReports,
          active_bans: activeBans
        },
        recent_activity: recentActivity,
        user_role: req.user.role
      });

    } catch (error) {
      logger.error('Admin dashboard error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Récupérer tous les posts avec pagination et filtres
   */
  static async getAllPosts(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const status = req.query.status; // 'active', 'inactive', 'all'
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
                nom: true,
                prenom: true,
                certified: true,
                photo_profil: true
              }
            },
            message_type: true,
            _count: {
              select: {
                likes: true,
                children: true // Commentaires
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

      res.json({
        posts,
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
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Récupérer tous les posts signalés
   */
  static async getReportedPosts(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const processed = req.query.processed === 'true';
      const offset = (page - 1) * limit;

      // Vérifier si la table reports existe
      try {
        await prisma.report.findFirst();
      } catch (tableError) {
        // La table n'existe pas encore
        return res.json({
          reported_posts: [],
          pagination: {
            current_page: page,
            total_pages: 0,
            total_count: 0,
            limit
          }
        });
      }

      const whereClause = { processed };

      const [reports, totalCount] = await Promise.all([
        prisma.report.findMany({
          where: whereClause,
          include: {
            post: {
              include: {
                user: {
                  select: {
                    id_user: true,
                    username: true,
                    nom: true,
                    prenom: true,
                    certified: true
                  }
                }
              }
            },
            user: {
              select: {
                id_user: true,
                username: true,
                nom: true,
                prenom: true
              }
            }
          },
          orderBy: { reported_at: 'desc' },
          skip: offset,
          take: limit
        }),
        prisma.report.count({ where: whereClause })
      ]);

      // Grouper les signalements par post
      const groupedReports = {};
      reports.forEach(report => {
        const postId = report.id_post;
        if (!groupedReports[postId]) {
          groupedReports[postId] = {
            post: report.post,
            reports: [],
            total_reports: 0
          };
        }
        groupedReports[postId].reports.push({
          id_report: report.id_report,
          reason: report.reason,
          reported_at: report.reported_at,
          reporter: report.user
        });
        groupedReports[postId].total_reports++;
      });

      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        reported_posts: Object.values(groupedReports),
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_count: totalCount,
          limit
        }
      });

    } catch (error) {
      logger.error('Get reported posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Récupérer tous les utilisateurs avec pagination et filtres
   */
  static async getAllUsers(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const role = req.query.role; // 'ADMIN', 'MODERATOR', 'USER'
      const status = req.query.status; // 'active', 'inactive', 'banned'
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

      const currentDate = new Date();

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
            },
            // Vérifier si l'utilisateur est actuellement banni
            bannissements_recus: {
              where: {
                debut_ban: { lte: currentDate },
                fin_ban: { gte: currentDate }
              },
              include: {
                banni_by_rel: {
                  select: { username: true }
                }
              }
            }
          },
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: limit
        }),
        prisma.user.count({ where: whereClause })
      ]);

      // Filtrer les utilisateurs bannis si demandé
      let filteredUsers = users;
      if (status === 'banned') {
        filteredUsers = users.filter(user => user.bannissements_recus.length > 0);
      }

      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        users: filteredUsers.map(user => ({
          id_user: user.id_user,
          username: user.username,
          mail: user.mail,
          nom: user.nom,
          prenom: user.prenom,
          bio: user.bio,
          photo_profil: user.photo_profil,
          role: user.role.role,
          certified: user.certified,
          private: user.private,
          is_active: user.is_active,
          created_at: user.created_at,
          last_login: user.last_login,
          stats: {
            posts_count: user._count.posts,
            followers_count: user._count.followers,
            following_count: user._count.following
          },
          current_ban: user.bannissements_recus[0] || null,
          is_banned: user.bannissements_recus.length > 0
        })),
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_count: totalCount,
          limit
        }
      });

    } catch (error) {
      logger.error('Get all users error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Bannir un utilisateur (admin/modérateur)
   */
  static async banUser(req, res) {
    try {
      const { userId } = req.params;
      const { raison, duration_hours } = req.body;

      if (!raison || !duration_hours) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Raison et durée sont obligatoires'
        });
      }

      // Vérifier que l'utilisateur cible existe
      const targetUser = await prisma.user.findFirst({
        where: {
          id_user: parseInt(userId),
          is_active: true
        },
        include: { role: true }
      });

      if (!targetUser) {
        return res.status(404).json({
          error: 'User not found',
          message: 'Utilisateur non trouvé ou inactif'
        });
      }

      // Empêcher de se bannir soi-même
      if (targetUser.id_user === req.user.id_user) {
        return res.status(400).json({
          error: 'Cannot ban yourself',
          message: 'Vous ne pouvez pas vous bannir vous-même'
        });
      }

      // Vérifier la hiérarchie des rôles
      const roleHierarchy = { 'USER': 1, 'MODERATOR': 2, 'ADMIN': 3 };
      const currentUserLevel = roleHierarchy[req.user.role];
      const targetUserLevel = roleHierarchy[targetUser.role.role];

      if (targetUserLevel >= currentUserLevel) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Vous ne pouvez pas bannir un utilisateur de niveau égal ou supérieur'
        });
      }

      // Vérifier qu'il n'y a pas déjà un ban actif
      const currentDate = new Date();
      const existingBan = await prisma.userBannissement.findFirst({
        where: {
          user_banni: targetUser.id_user,
          debut_ban: { lte: currentDate },
          fin_ban: { gte: currentDate }
        }
      });

      if (existingBan) {
        return res.status(409).json({
          error: 'User already banned',
          message: 'Cet utilisateur est déjà banni'
        });
      }

      // Créer le bannissement
      const finBan = new Date();
      finBan.setHours(finBan.getHours() + duration_hours);

      const ban = await prisma.userBannissement.create({
        data: {
          user_banni: targetUser.id_user,
          banni_by: req.user.id_user,
          raison,
          debut_ban: currentDate,
          fin_ban: finBan
        }
      });

      logger.info(`User ${targetUser.username} banned by ${req.user.username} for ${duration_hours}h`);

      res.json({
        message: 'Utilisateur banni avec succès',
        ban: {
          id_bannissement: ban.id_bannissement,
          user_banned: targetUser.username,
          reason: ban.raison,
          start_date: ban.debut_ban,
          end_date: ban.fin_ban,
          duration_hours
        }
      });

    } catch (error) {
      logger.error('Ban user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Supprimer un utilisateur (admin/modérateur)
   */
  static async deleteUser(req, res) {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      // Vérifier que l'utilisateur cible existe
      const targetUser = await prisma.user.findFirst({
        where: {
          id_user: parseInt(userId),
          is_active: true
        },
        include: { role: true }
      });

      if (!targetUser) {
        return res.status(404).json({
          error: 'User not found',
          message: 'Utilisateur non trouvé ou déjà supprimé'
        });
      }

      // Empêcher de se supprimer soi-même
      if (targetUser.id_user === req.user.id_user) {
        return res.status(400).json({
          error: 'Cannot delete yourself',
          message: 'Vous ne pouvez pas vous supprimer vous-même'
        });
      }

      // Vérifier la hiérarchie des rôles
      const roleHierarchy = { 'USER': 1, 'MODERATOR': 2, 'ADMIN': 3 };
      const currentUserLevel = roleHierarchy[req.user.role];
      const targetUserLevel = roleHierarchy[targetUser.role.role];

      if (targetUserLevel >= currentUserLevel) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Vous ne pouvez pas supprimer un utilisateur de niveau égal ou supérieur'
        });
      }

      // Soft delete : désactiver l'utilisateur
      await prisma.user.update({
        where: { id_user: targetUser.id_user },
        data: {
          is_active: false,
          updated_at: new Date()
        }
      });

      logger.info(`User ${targetUser.username} deleted by ${req.user.username}. Reason: ${reason || 'No reason provided'}`);

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
      res.status(500).json({ error: 'Internal server error' });
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
          error: 'Invalid role',
          message: 'Le rôle doit être USER, MODERATOR ou ADMIN'
        });
      }

      // Vérifier que l'utilisateur cible existe
      const targetUser = await prisma.user.findFirst({
        where: {
          id_user: parseInt(userId),
          is_active: true
        },
        include: { role: true }
      });

      if (!targetUser) {
        return res.status(404).json({
          error: 'User not found',
          message: 'Utilisateur non trouvé ou inactif'
        });
      }

      // Empêcher de modifier son propre rôle
      if (targetUser.id_user === req.user.id_user) {
        return res.status(400).json({
          error: 'Cannot modify own role',
          message: 'Vous ne pouvez pas modifier votre propre rôle'
        });
      }

      // Récupérer le nouveau rôle
      const roleRecord = await prisma.role.findFirst({
        where: { role: new_role }
      });

      if (!roleRecord) {
        return res.status(404).json({
          error: 'Role not found',
          message: 'Rôle non trouvé dans la base de données'
        });
      }

      // Mettre à jour le rôle
      const updatedUser = await prisma.user.update({
        where: { id_user: targetUser.id_user },
        data: {
          id_role: roleRecord.id_role,
          updated_at: new Date()
        },
        include: {
          role: true
        }
      });

      logger.info(`User ${targetUser.username} role changed from ${targetUser.role.role} to ${new_role} by ${req.user.username}`);

      res.json({
        message: 'Rôle utilisateur modifié avec succès',
        user: {
          id_user: updatedUser.id_user,
          username: updatedUser.username,
          previous_role: targetUser.role.role,
          new_role: new_role
        }
      });

    } catch (error) {
      logger.error('Change user role error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = AdminController;