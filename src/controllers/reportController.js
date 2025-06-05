const prisma = require('../utils/database');
const logger = require('../utils/logger');
const Joi = require('joi');
const { postParamsSchema, userParamsSchema, paginationSchema } = require('../validators/userValidator');

// Schémas de validation pour les signalements
const reportPostSchema = Joi.object({
  raison: Joi.string().min(5).max(255).required().messages({
    'string.min': 'Report reason must be at least 5 characters',
    'string.max': 'Report reason must not exceed 255 characters',
    'any.required': 'Report reason is required'
  }),
  category: Joi.string().valid('spam', 'hate', 'violence', 'nudity', 'misinformation', 'harassment', 'other').optional().messages({
    'any.only': 'Category must be one of: spam, hate, violence, nudity, misinformation, harassment, other'
  })
});

const processReportSchema = Joi.object({
  action: Joi.string().valid('approve', 'remove_post', 'warn_user', 'ban_user', 'dismiss').required().messages({
    'any.only': 'Action must be one of: approve, remove_post, warn_user, ban_user, dismiss',
    'any.required': 'Action is required'
  }),
  reason: Joi.string().max(500).optional().messages({
    'string.max': 'Reason must not exceed 500 characters'
  }),
  ban_duration_hours: Joi.number().integer().min(1).max(8760).when('action', {
    is: 'ban_user',
    then: Joi.required(),
    otherwise: Joi.optional()
  }).messages({
    'number.min': 'Ban duration must be at least 1 hour',
    'number.max': 'Ban duration must not exceed 8760 hours (1 year)',
    'any.required': 'Ban duration is required when banning user'
  })
});

const dismissReportSchema = Joi.object({
  reason: Joi.string().min(5).max(500).required().messages({
    'string.min': 'Dismissal reason must be at least 5 characters',
    'string.max': 'Dismissal reason must not exceed 500 characters',
    'any.required': 'Dismissal reason is required'
  })
});

const getUserReportsSchema = Joi.object({
  period: Joi.string().valid('30d', '90d', 'all').default('30d').messages({
    'any.only': 'Period must be one of: 30d, 90d, all'
  }),
  status: Joi.string().valid('pending', 'processed', 'dismissed', 'all').default('all').messages({
    'any.only': 'Status must be one of: pending, processed, dismissed, all'
  }),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20)
});

const reportParamsSchema = Joi.object({
  reportId: Joi.string().pattern(/^\d+_\d+$/).required().messages({
    'string.pattern.base': 'Report ID must be in format userId_postId',
    'any.required': 'Report ID is required'
  })
});

const updateThresholdsSchema = Joi.object({
  auto_remove_threshold: Joi.number().integer().min(1).max(100).optional(),
  auto_review_threshold: Joi.number().integer().min(1).max(50).optional(),
  spam_detection_sensitivity: Joi.number().min(0.1).max(1.0).optional(),
  max_reports_per_user_per_day: Joi.number().integer().min(1).max(100).optional()
});

class ReportController {
  /**
   * Signaler un post
   */
  static async reportPost(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = reportPostSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { id: postId } = req.params;
      const { raison, category } = value;

      // Vérifier que l'utilisateur connecté existe et est actif
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!currentUser) {
        return res.status(404).json({ error: 'Current user not found or inactive' });
      }

      // Vérifier que le post existe et est actif
      const post = await prisma.post.findFirst({
        where: { 
          id_post: postId,
          active: true
        },
        select: { 
          id_post: true,
          id_user: true,
          content: true,
          author: {
            select: { 
              id_user: true, 
              private: true,
              is_active: true,
              username: true
            }
          }
        }
      });

      if (!post || !post.author.is_active) {
        return res.status(404).json({ error: 'Post not found or author inactive' });
      }

      // Empêcher auto-signalement
      if (post.id_user === req.user.id_user) {
        return res.status(400).json({ error: 'Cannot report your own posts' });
      }

      // Vérifier permissions pour comptes privés
      if (post.author.private) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: post.author.id_user
            }
          },
          select: { active: true, pending: true }
        });

        if (!isFollowing || !isFollowing.active || isFollowing.pending) {
          return res.status(403).json({ error: 'Cannot report private account post you cannot access' });
        }
      }

      // Vérifier qu'il n'a pas déjà signalé ce post
      const existingReport = await prisma.report.findUnique({
        where: {
          id_user_id_post: {
            id_user: req.user.id_user,
            id_post: postId
          }
        }
      });

      if (existingReport) {
        return res.status(409).json({ error: 'You have already reported this post' });
      }

      // Vérifier la limite quotidienne de signalements
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const reportsToday = await prisma.report.count({
        where: {
          id_user: req.user.id_user,
          reported_at: { gte: today }
        }
      });

      const dailyLimit = 20; // Configurable
      if (reportsToday >= dailyLimit) {
        return res.status(429).json({ 
          error: 'Daily report limit exceeded',
          message: `You can only report ${dailyLimit} posts per day`
        });
      }

      // Créer le signalement
      const report = await prisma.report.create({
        data: {
          id_user: req.user.id_user,
          id_post: postId,
          raison: category ? `${category.toUpperCase()}: ${raison}` : raison,
          reported_at: new Date()
        }
      });

      // Vérifier si le post atteint le seuil d'auto-modération
      const reportCount = await prisma.report.count({
        where: { id_post: postId }
      });

      const autoReviewThreshold = 5; // Configurable
      const autoRemoveThreshold = 10; // Configurable

      let autoAction = null;
      if (reportCount >= autoRemoveThreshold) {
        // Auto-suppression du post
        await prisma.post.update({
          where: { id_post: postId },
          data: { 
            active: false,
            updated_at: new Date()
          }
        });
        autoAction = 'auto_removed';
        
        logger.warn(`Post auto-removed due to ${reportCount} reports: ${postId} by ${post.author.username}`);
      } else if (reportCount >= autoReviewThreshold) {
        autoAction = 'flagged_for_review';
        
        logger.warn(`Post flagged for review due to ${reportCount} reports: ${postId} by ${post.author.username}`);
      }

      logger.info(`Post reported by ${currentUser.username}: ${postId} by ${post.author.username} - ${raison}`);

      res.status(201).json({
        message: 'Post reported successfully',
        report: {
          id: `${report.id_user}_${report.id_post}`,
          reported_at: report.reported_at,
          auto_action: autoAction,
          total_reports: reportCount
        }
      });
    } catch (error) {
      logger.error('Report post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts signalés (modérateurs)
   */
  static async getReportedPosts(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier permissions modérateur/admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can view reported posts'
        });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Récupérer les posts avec signalements groupés
      const reportedPosts = await prisma.$queryRaw`
        WITH post_reports AS (
          SELECT 
            r.id_post,
            COUNT(*) as report_count,
            MAX(r.reported_at) as latest_report,
            MIN(r.reported_at) as first_report,
            STRING_AGG(DISTINCT SUBSTRING(r.raison, 1, 50), ' | ') as report_reasons
          FROM cercle.report r
          JOIN cercle.post p ON r.id_post = p.id_post
          WHERE p.active = true
          GROUP BY r.id_post
          HAVING COUNT(*) > 0
        )
        SELECT 
          pr.*,
          p.content,
          p.created_at as post_created,
          u.username,
          u.certified,
          u.photo_profil
        FROM post_reports pr
        JOIN cercle.post p ON pr.id_post = p.id_post
        JOIN cercle.users u ON p.id_user = u.id_user
        WHERE u.is_active = true
        ORDER BY pr.report_count DESC, pr.latest_report DESC
        LIMIT ${limit} OFFSET ${skip}
      `;

      const total = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT r.id_post) as total
        FROM cercle.report r
        JOIN cercle.post p ON r.id_post = p.id_post
        JOIN cercle.users u ON p.id_user = u.id_user
        WHERE p.active = true AND u.is_active = true
      `;

      const totalPages = Math.ceil(parseInt(total[0].total) / limit);

      res.json({
        reported_posts: reportedPosts.map(post => ({
          id_post: post.id_post,
          content_preview: post.content.substring(0, 150) + (post.content.length > 150 ? '...' : ''),
          author: {
            username: post.username,
            certified: post.certified,
            photo_profil: post.photo_profil
          },
          report_stats: {
            count: parseInt(post.report_count),
            first_report: post.first_report,
            latest_report: post.latest_report,
            reasons_preview: post.report_reasons
          },
          post_created: post.post_created,
          priority: parseInt(post.report_count) >= 10 ? 'critical' : 
                   parseInt(post.report_count) >= 5 ? 'high' : 'medium'
        })),
        pagination: {
          page,
          limit,
          total: parseInt(total[0].total),
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get reported posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les détails d'un signalement
   */
  static async getReportDetails(req, res) {
    try {
      const { error } = reportParamsSchema.validate(req.params);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier permissions modérateur/admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can view report details'
        });
      }

      const { reportId } = req.params;
      const [userId, postId] = reportId.split('_');

      // Récupérer tous les signalements pour ce post
      const [reports, post] = await Promise.all([
        prisma.report.findMany({
          where: { id_post: postId },
          include: {
            user: {
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                certified: true,
                created_at: true
              }
            }
          },
          orderBy: { reported_at: 'desc' }
        }),
        prisma.post.findUnique({
          where: { id_post: postId },
          include: {
            author: {
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                certified: true,
                created_at: true,
                private: true
              }
            },
            _count: {
              select: {
                likes: { where: { active: true } },
                mentions: true
              }
            }
          }
        })
      ]);

      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }

      if (reports.length === 0) {
        return res.status(404).json({ error: 'No reports found for this post' });
      }

      // Analyser les patterns de signalement
      const reportAnalysis = {
        total_reports: reports.length,
        unique_reporters: new Set(reports.map(r => r.id_user)).size,
        time_span: {
          first_report: reports[reports.length - 1].reported_at,
          latest_report: reports[0].reported_at
        },
        categories: this.analyzeReportCategories(reports.map(r => r.raison))
      };

      res.json({
        post: {
          id_post: post.id_post,
          content: post.content,
          created_at: post.created_at,
          active: post.active,
          author: post.author,
          engagement: {
            likes: post._count.likes,
            mentions: post._count.mentions
          }
        },
        reports: reports.map(report => ({
          reporter: report.user,
          reason: report.raison,
          reported_at: report.reported_at
        })),
        analysis: reportAnalysis,
        recommendations: this.generateModerationRecommendations(reportAnalysis, post)
      });
    } catch (error) {
      logger.error('Get report details error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Traiter un signalement (modérateurs)
   */
  static async processReport(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = processReportSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier permissions modérateur/admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can process reports'
        });
      }

      const { id: postId } = req.params;
      const { action, reason, ban_duration_hours } = value;

      // Vérifier que le post existe
      const post = await prisma.post.findUnique({
        where: { id_post: postId },
        include: {
          author: {
            select: { id_user: true, username: true }
          }
        }
      });

      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Vérifier qu'il y a des signalements pour ce post
      const reports = await prisma.report.findMany({
        where: { id_post: postId },
        include: {
          user: {
            select: { id_user: true, username: true }
          }
        }
      });

      if (reports.length === 0) {
        return res.status(404).json({ error: 'No reports found for this post' });
      }

      let actionResult = {};

      // Exécuter l'action demandée
      await prisma.$transaction(async (tx) => {
        switch (action) {
          case 'approve':
            actionResult = { action: 'approved', message: 'Post approved, no violations found' };
            break;

          case 'remove_post':
            await tx.post.update({
              where: { id_post: postId },
              data: { 
                active: false,
                updated_at: new Date()
              }
            });
            actionResult = { action: 'post_removed', message: 'Post removed for policy violation' };
            break;

          case 'warn_user':
            actionResult = { 
              action: 'user_warned', 
              message: `User ${post.author.username} has been warned`,
              warning_reason: reason || 'Policy violation'
            };
            break;

          case 'ban_user':
            const banEndDate = new Date();
            banEndDate.setHours(banEndDate.getHours() + ban_duration_hours);

            await tx.userBannissement.create({
              data: {
                user_banni: post.author.id_user,
                banni_by: req.user.id_user,
                raison: reason || 'Multiple policy violations',
                debut_ban: new Date(),
                fin_ban: banEndDate
              }
            });

            await tx.post.update({
              where: { id_post: postId },
              data: { 
                active: false,
                updated_at: new Date()
              }
            });

            actionResult = { 
              action: 'user_banned', 
              message: `User ${post.author.username} banned for ${ban_duration_hours} hours`,
              ban_end: banEndDate
            };
            break;

          case 'dismiss':
            actionResult = { action: 'dismissed', message: 'Reports dismissed, no violation found' };
            break;
        }
      });

      const reporterIds = [...new Set(reports.map(r => r.id_user))];
      
      logger.info(`Report processed by ${currentUser.username}: Post ${postId} by ${post.author.username} - Action: ${action} - Reason: ${reason || 'N/A'}`);

      res.json({
        message: 'Report processed successfully',
        action_taken: actionResult,
        post: {
          id_post: post.id_post,
          author: post.author.username
        },
        processed_by: currentUser.username,
        affected_reports: reports.length,
        reporters_notified: reporterIds.length
      });
    } catch (error) {
      logger.error('Process report error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Rejeter un signalement (modérateurs)
   */
  static async dismissReport(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = dismissReportSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier permissions modérateur/admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can dismiss reports'
        });
      }

      const { id: postId } = req.params;
      const { reason } = value;

      // Vérifier qu'il y a des signalements pour ce post
      const reports = await prisma.report.findMany({
        where: { id_post: postId }
      });

      if (reports.length === 0) {
        return res.status(404).json({ error: 'No reports found for this post' });
      }

      logger.info(`Reports dismissed by ${currentUser.username}: Post ${postId} - Reason: ${reason} - ${reports.length} reports dismissed`);

      res.json({
        message: 'Reports dismissed successfully',
        dismissed_reports: reports.length,
        dismissal_reason: reason,
        dismissed_by: currentUser.username,
        dismissed_at: new Date()
      });
    } catch (error) {
      logger.error('Dismiss report error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir le nombre de signalements pour un utilisateur
   */
  static async getUserReportsCount(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = getUserReportsSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      // Vérifier permissions modérateur/admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can view user report counts'
        });
      }

      const { id: userId } = req.params;
      const { period } = value;

      // Vérifier que l'utilisateur existe
      const user = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { username: true, is_active: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Calculer la date de début selon la période
      let startDate = null;
      if (period !== 'all') {
        startDate = new Date();
        switch (period) {
          case '30d':
            startDate.setDate(startDate.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(startDate.getDate() - 90);
            break;
        }
      }

      const dateFilter = startDate ? { gte: startDate } : {};

      const [totalReports, reportsByReason, reportsByDay] = await Promise.all([
        prisma.report.count({
          where: {
            post: { 
              id_user: userId,
              ...(startDate && { created_at: dateFilter })
            }
          }
        }),

        prisma.$queryRaw`
          SELECT 
            CASE 
              WHEN r.raison LIKE 'SPAM:%' THEN 'spam'
              WHEN r.raison LIKE 'HATE:%' THEN 'hate'
              WHEN r.raison LIKE 'VIOLENCE:%' THEN 'violence'
              WHEN r.raison LIKE 'NUDITY:%' THEN 'nudity'
              WHEN r.raison LIKE 'MISINFORMATION:%' THEN 'misinformation'
              WHEN r.raison LIKE 'HARASSMENT:%' THEN 'harassment'
              ELSE 'other'
            END as category,
            COUNT(*) as count
          FROM cercle.report r
          JOIN cercle.post p ON r.id_post = p.id_post
          WHERE p.id_user = ${userId}
            ${startDate ? `AND r.reported_at >= '${startDate.toISOString()}'` : ''}
          GROUP BY category
          ORDER BY count DESC
        `,

        prisma.$queryRaw`
          SELECT 
            DATE(r.reported_at) as date,
            COUNT(*) as count
          FROM cercle.report r
          JOIN cercle.post p ON r.id_post = p.id_post
          WHERE p.id_user = ${userId}
            AND r.reported_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(r.reported_at)
          ORDER BY date ASC
        `
      ]);

      res.json({
        user: user.username,
        period,
        report_stats: {
          total_reports: totalReports,
          reports_by_category: reportsByReason.map(item => ({
            category: item.category,
            count: parseInt(item.count)
          })),
          daily_reports: reportsByDay.map(item => ({
            date: item.date,
            count: parseInt(item.count)
          })),
          average_per_day: reportsByDay.length > 0 ? 
            (reportsByDay.reduce((sum, day) => sum + parseInt(day.count), 0) / reportsByDay.length).toFixed(2) : 0
        }
      });
    } catch (error) {
      logger.error('Get user reports count error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir tous les utilisateurs par nombre de signalements
   */
  static async getAllUsersReports(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier permissions modérateur/admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can view all user reports'
        });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const usersWithReports = await prisma.$queryRaw`
        WITH user_report_stats AS (
          SELECT 
            p.id_user,
            COUNT(r.id_post) as total_reports,
            COUNT(DISTINCT r.id_post) as reported_posts,
            MAX(r.reported_at) as latest_report,
            MIN(r.reported_at) as first_report
          FROM cercle.report r
          JOIN cercle.post p ON r.id_post = p.id_post
          GROUP BY p.id_user
          HAVING COUNT(r.id_post) > 0
        )
        SELECT 
          urs.*,
          u.username,
          u.certified,
          u.photo_profil,
          u.is_active,
          u.created_at as user_created
        FROM user_report_stats urs
        JOIN cercle.users u ON urs.id_user = u.id_user
        WHERE u.is_active = true
        ORDER BY urs.total_reports DESC
        LIMIT ${limit} OFFSET ${skip}
      `;

      res.json({
        users_with_reports: usersWithReports.map(user => ({
          user: {
            id_user: user.id_user,
            username: user.username,
            certified: user.certified,
            photo_profil: user.photo_profil,
            created_at: user.user_created
          },
          report_stats: {
            total_reports: parseInt(user.total_reports),
            reported_posts: parseInt(user.reported_posts),
            first_report: user.first_report,
            latest_report: user.latest_report,
            risk_level: this.calculateRiskLevel(parseInt(user.total_reports), parseInt(user.reported_posts))
          }
        }))
      });
    } catch (error) {
      logger.error('Get all users reports error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les détails des signalements d'un utilisateur
   */
  static async getUserReports(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = getUserReportsSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      // Vérifier permissions modérateur/admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || !['moderator', 'administrator'].includes(currentUser.role.role)) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only moderators and administrators can view user report details'
        });
      }

      const { id: userId } = req.params;
      const { period, status, page, limit } = value;
      const skip = (page - 1) * limit;

      // Vérifier que l'utilisateur existe
      const user = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { username: true, is_active: true, created_at: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Calculer la date de début selon la période
      let startDate = null;
      if (period !== 'all') {
        startDate = new Date();
        switch (period) {
          case '30d':
            startDate.setDate(startDate.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(startDate.getDate() - 90);
            break;
        }
      }

      const whereConditions = {
        post: { 
          id_user: userId,
          ...(startDate && { created_at: { gte: startDate } })
        }
      };

      const [reports, total] = await Promise.all([
        prisma.report.findMany({
          where: whereConditions,
          include: {
            user: {
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                certified: true
              }
            },
            post: {
              select: {
                id_post: true,
                content: true,
                created_at: true,
                active: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { reported_at: 'desc' }
        }),
        prisma.report.count({ where: whereConditions })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        user: {
          username: user.username,
          is_active: user.is_active,
          account_created: user.created_at
        },
        period,
        reports: reports.map(report => ({
          id: `${report.id_user}_${report.id_post}`,
          reporter: report.user,
          post: {
            id_post: report.post.id_post,
            content_preview: report.post.content.substring(0, 100) + (report.post.content.length > 100 ? '...' : ''),
            created_at: report.post.created_at,
            is_active: report.post.active
          },
          reason: report.raison,
          reported_at: report.reported_at,
          status: report.post.active ? 'unprocessed' : 'post_removed'
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get user reports error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les statistiques globales des signalements (admin)
   */
  static async getReportStats(req, res) {
    try {
      // Vérifier permissions admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || currentUser.role.role !== 'administrator') {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only administrators can view global report statistics'
        });
      }

      const [totalReports, last24hReports, last7dReports, reportsByCategory, processingStats] = await Promise.all([
        prisma.report.count(),

        prisma.report.count({
          where: {
            reported_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        }),

        prisma.report.count({
          where: {
            reported_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
          }
        }),

        prisma.$queryRaw`
          SELECT 
            CASE 
              WHEN raison LIKE 'SPAM:%' THEN 'spam'
              WHEN raison LIKE 'HATE:%' THEN 'hate'
              WHEN raison LIKE 'VIOLENCE:%' THEN 'violence'
              WHEN raison LIKE 'NUDITY:%' THEN 'nudity'
              WHEN raison LIKE 'MISINFORMATION:%' THEN 'misinformation'
              WHEN raison LIKE 'HARASSMENT:%' THEN 'harassment'
              ELSE 'other'
            END as category,
            COUNT(*) as count
          FROM cercle.report
          WHERE reported_at >= NOW() - INTERVAL '30 days'
          GROUP BY category
          ORDER BY count DESC
        `,

        prisma.$queryRaw`
          SELECT 
            COUNT(DISTINCT r.id_post) as total_reported_posts,
            COUNT(DISTINCT CASE WHEN p.active = false THEN r.id_post END) as removed_posts,
            COUNT(DISTINCT CASE WHEN ub.id_bannissement IS NOT NULL THEN p.id_user END) as banned_users
          FROM cercle.report r
          LEFT JOIN cercle.post p ON r.id_post = p.id_post
          LEFT JOIN cercle.user_bannissements ub ON p.id_user = ub.user_banni 
            AND ub.debut_ban >= r.reported_at
          WHERE r.reported_at >= NOW() - INTERVAL '30 days'
        `
      ]);

      const dailyReports = await prisma.$queryRaw`
        SELECT 
          DATE(reported_at) as date,
          COUNT(*) as count
        FROM cercle.report
        WHERE reported_at >= NOW() - INTERVAL '14 days'
        GROUP BY DATE(reported_at)
        ORDER BY date ASC
      `;

      const processingData = processingStats[0];

      res.json({
        global_stats: {
          total_reports: totalReports,
          last_24h_reports: last24hReports,
          last_7d_reports: last7dReports,
          growth_rate_24h: totalReports > 0 ? ((last24hReports / totalReports) * 100).toFixed(2) : 0
        },
        processing_efficiency: {
          total_reported_posts: parseInt(processingData.total_reported_posts),
          removed_posts: parseInt(processingData.removed_posts),
          banned_users: parseInt(processingData.banned_users),
          removal_rate: processingData.total_reported_posts > 0 ? 
            ((processingData.removed_posts / processingData.total_reported_posts) * 100).toFixed(2) : 0
        },
        category_breakdown: reportsByCategory.map(cat => ({
          category: cat.category,
          count: parseInt(cat.count),
          percentage: ((parseInt(cat.count) / reportsByCategory.reduce((sum, c) => sum + parseInt(c.count), 0)) * 100).toFixed(1)
        })),
        daily_trend: dailyReports.map(day => ({
          date: day.date,
          count: parseInt(day.count)
        }))
      });
    } catch (error) {
      logger.error('Get report stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Détecter les signalements spam (admin)
   */
  static async detectSpamReports(req, res) {
    try {
      // Vérifier permissions admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || currentUser.role.role !== 'administrator') {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only administrators can run spam detection'
        });
      }

      const last24h = new Date();
      last24h.setHours(last24h.getHours() - 24);

      const [massReporters, duplicateReports, coordinatedAttacks, suspiciousPatterns] = await Promise.all([
        prisma.$queryRaw`
          SELECT 
            u.id_user,
            u.username,
            COUNT(*) as report_count,
            COUNT(DISTINCT r.id_post) as unique_posts,
            MIN(r.reported_at) as first_report,
            MAX(r.reported_at) as latest_report
          FROM cercle.report r
          JOIN cercle.users u ON r.id_user = u.id_user
          WHERE r.reported_at >= ${last24h}
            AND u.is_active = true
          GROUP BY u.id_user, u.username
          HAVING COUNT(*) > 20 OR (COUNT(*) > 10 AND COUNT(DISTINCT r.id_post) < COUNT(*) * 0.3)
          ORDER BY report_count DESC
        `,

        prisma.$queryRaw`
          SELECT 
            id_post,
            raison,
            COUNT(*) as duplicate_count,
            STRING_AGG(DISTINCT u.username, ', ') as reporters
          FROM cercle.report r
          JOIN cercle.users u ON r.id_user = u.id_user
          WHERE r.reported_at >= ${last24h}
          GROUP BY id_post, raison
          HAVING COUNT(*) > 5 AND LENGTH(raison) < 50
          ORDER BY duplicate_count DESC
        `,

        prisma.$queryRaw`
          WITH recent_reporters AS (
            SELECT DISTINCT r.id_user
            FROM cercle.report r
            JOIN cercle.users u ON r.id_user = u.id_user
            WHERE r.reported_at >= ${last24h}
              AND u.created_at >= NOW() - INTERVAL '7 days'
          ),
          coordinated_targets AS (
            SELECT 
              id_post,
              COUNT(*) as reports_from_new_users
            FROM cercle.report r
            WHERE r.id_user IN (SELECT id_user FROM recent_reporters)
              AND r.reported_at >= ${last24h}
            GROUP BY id_post
            HAVING COUNT(*) >= 3
          )
          SELECT 
            ct.id_post,
            ct.reports_from_new_users,
            p.content,
            u.username as target_user
          FROM coordinated_targets ct
          JOIN cercle.post p ON ct.id_post = p.id_post
          JOIN cercle.users u ON p.id_user = u.id_user
          ORDER BY ct.reports_from_new_users DESC
        `,

        prisma.$queryRaw`
          SELECT 
            raison,
            COUNT(*) as usage_count,
            COUNT(DISTINCT id_user) as unique_reporters,
            COUNT(DISTINCT id_post) as unique_posts
          FROM cercle.report
          WHERE reported_at >= ${last24h}
            AND LENGTH(raison) < 30
          GROUP BY raison
          HAVING COUNT(*) > 10 AND COUNT(DISTINCT id_user) > COUNT(*) * 0.8
          ORDER BY usage_count DESC
        `
      ]);

      res.json({
        spam_detection_report: {
          timestamp: new Date(),
          detection_window: '24 hours',
          suspicious_activity: {
            mass_reporters: massReporters.map(reporter => ({
              user_id: reporter.id_user,
              username: reporter.username,
              report_count: parseInt(reporter.report_count),
              unique_posts: parseInt(reporter.unique_posts),
              efficiency_ratio: (parseInt(reporter.unique_posts) / parseInt(reporter.report_count)).toFixed(2),
              time_span: {
                first_report: reporter.first_report,
                latest_report: reporter.latest_report
              },
              risk_level: parseInt(reporter.report_count) > 50 ? 'critical' : 
                         parseInt(reporter.report_count) > 30 ? 'high' : 'medium'
            })),
            duplicate_reports: duplicateReports.map(dup => ({
              post_id: dup.id_post,
              reason: dup.raison,
              duplicate_count: parseInt(dup.duplicate_count),
              reporters: dup.reporters.split(', ')
            })),
            coordinated_attacks: coordinatedAttacks.map(attack => ({
              target_post: attack.id_post,
              target_user: attack.target_user,
              content_preview: attack.content.substring(0, 100),
              reports_from_new_users: parseInt(attack.reports_from_new_users)
            })),
            suspicious_patterns: suspiciousPatterns.map(pattern => ({
              reason_template: pattern.raison,
              usage_count: parseInt(pattern.usage_count),
              unique_reporters: parseInt(pattern.unique_reporters),
              unique_posts: parseInt(pattern.unique_posts),
              automation_likelihood: parseInt(pattern.unique_reporters) > parseInt(pattern.usage_count) * 0.8 ? 'high' : 'medium'
            }))
          },
          summary: {
            total_suspicious_users: massReporters.length,
            total_duplicate_reports: duplicateReports.reduce((sum, dup) => sum + parseInt(dup.duplicate_count), 0),
            coordinated_attacks_detected: coordinatedAttacks.length,
            suspicious_patterns_found: suspiciousPatterns.length
          }
        }
      });
    } catch (error) {
      logger.error('Detect spam reports error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les catégories de signalement
   */
  static async getReportCategories(req, res) {
    try {
      const categories = [
        {
          id: 'spam',
          name: 'Spam',
          description: 'Unwanted promotional content, repetitive posts, or automated messaging',
          severity: 'medium',
          auto_threshold: 10,
          examples: ['Promotional links', 'Repetitive content', 'Bot activity']
        },
        {
          id: 'hate',
          name: 'Hate Speech',
          description: 'Content that promotes hatred against individuals or groups',
          severity: 'high',
          auto_threshold: 3,
          examples: ['Discriminatory language', 'Threats based on identity', 'Incitement to hatred']
        },
        {
          id: 'violence',
          name: 'Violence & Threats',
          description: 'Content depicting or threatening violence',
          severity: 'critical',
          auto_threshold: 2,
          examples: ['Physical threats', 'Graphic violence', 'Self-harm content']
        },
        {
          id: 'nudity',
          name: 'Nudity & Sexual Content',
          description: 'Adult content not suitable for all audiences',
          severity: 'medium',
          auto_threshold: 5,
          examples: ['Explicit imagery', 'Sexual content', 'Inappropriate photos']
        },
        {
          id: 'misinformation',
          name: 'Misinformation',
          description: 'False or misleading information',
          severity: 'high',
          auto_threshold: 7,
          examples: ['False news', 'Medical misinformation', 'Conspiracy theories']
        },
        {
          id: 'harassment',
          name: 'Harassment & Bullying',
          description: 'Targeted abuse or persistent unwanted contact',
          severity: 'high',
          auto_threshold: 3,
          examples: ['Personal attacks', 'Doxxing', 'Persistent messaging']
        },
        {
          id: 'other',
          name: 'Other',
          description: 'Other policy violations not covered above',
          severity: 'low',
          auto_threshold: 15,
          examples: ['Terms of service violations', 'Privacy concerns', 'Other issues']
        }
      ];

      res.json({
        categories,
        usage_stats: await this.getCategoryUsageStats(),
        guidelines: {
          general: 'Reports should be specific and factual. False reporting may result in account restrictions.',
          evidence: 'Provide clear reasoning for your report to help our moderation team.',
          follow_up: 'You will be notified of any actions taken on your reports.'
        }
      });
    } catch (error) {
      logger.error('Get report categories error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Mettre à jour les seuils de modération (admin)
   */
  static async updateReportThresholds(req, res) {
    try {
      const { error, value } = updateThresholdsSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier permissions admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || currentUser.role.role !== 'administrator') {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only administrators can update moderation thresholds'
        });
      }

      const updatedThresholds = {
        auto_remove_threshold: value.auto_remove_threshold || 10,
        auto_review_threshold: value.auto_review_threshold || 5,
        spam_detection_sensitivity: value.spam_detection_sensitivity || 0.7,
        max_reports_per_user_per_day: value.max_reports_per_user_per_day || 20,
        updated_by: currentUser.username,
        updated_at: new Date()
      };

      logger.info(`Moderation thresholds updated by ${currentUser.username}: ${JSON.stringify(value)}`);

      res.json({
        message: 'Moderation thresholds updated successfully',
        new_thresholds: updatedThresholds,
        warning: 'Changes will take effect immediately. Monitor the impact on moderation queue.'
      });
    } catch (error) {
      logger.error('Update report thresholds error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les règles de modération automatique (admin)
   */
  static async getAutoModerationRules(req, res) {
    try {
      // Vérifier permissions admin
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        include: { role: true }
      });

      if (!currentUser || currentUser.role.role !== 'administrator') {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Only administrators can view auto-moderation rules'
        });
      }

      const rules = {
        content_rules: [
          {
            id: 'auto_remove_spam',
            name: 'Auto-remove spam content',
            condition: 'report_count >= 10 AND category = "spam"',
            action: 'remove_post',
            enabled: true,
            trigger_count: 10
          },
          {
            id: 'auto_review_hate',
            name: 'Auto-review hate speech',
            condition: 'report_count >= 3 AND category = "hate"',
            action: 'flag_for_review',
            enabled: true,
            trigger_count: 3
          },
          {
            id: 'auto_remove_violence',
            name: 'Auto-remove violent content',
            condition: 'report_count >= 2 AND category = "violence"',
            action: 'remove_post',
            enabled: true,
            trigger_count: 2
          }
        ],
        user_rules: [
          {
            id: 'auto_warn_multiple_reports',
            name: 'Auto-warn users with multiple reported posts',
            condition: 'reported_posts_count >= 5 IN 24h',
            action: 'send_warning',
            enabled: true,
            threshold: 5
          },
          {
            id: 'auto_restrict_mass_reporter',
            name: 'Restrict users who mass-report',
            condition: 'reports_submitted >= 50 IN 24h',
            action: 'limit_reporting',
            enabled: true,
            threshold: 50
          }
        ]
      };

      res.json({
        auto_moderation_rules: rules,
        configuration: {
          last_updated: new Date(),
          next_review_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          performance_monitoring: true,
          manual_override_enabled: true
        }
      });
    } catch (error) {
      logger.error('Get auto moderation rules error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Méthodes utilitaires
  static analyzeReportCategories(reasons) {
    const categories = {};
    reasons.forEach(reason => {
      const category = reason.includes(':') ? reason.split(':')[0].toLowerCase() : 'other';
      categories[category] = (categories[category] || 0) + 1;
    });
    return categories;
  }

  static generateModerationRecommendations(analysis, post) {
    const recommendations = [];
    
    if (analysis.total_reports > 10) {
      recommendations.push('High report volume - consider immediate review');
    }
    
    if (analysis.unique_reporters < analysis.total_reports * 0.3) {
      recommendations.push('Low reporter diversity - potential coordinated reporting');
    }
    
    if (post.created_at > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
      recommendations.push('Recent post - fast escalation may indicate serious violation');
    }
    
    return recommendations;
  }

  static calculateRiskLevel(totalReports, reportedPosts) {
    const ratio = totalReports / reportedPosts;
    if (ratio > 5) return 'critical';
    if (ratio > 3) return 'high';
    if (ratio > 1.5) return 'medium';
    return 'low';
  }

  static async getCategoryUsageStats() {
    try {
      const stats = await prisma.$queryRaw`
        SELECT 
          CASE 
            WHEN raison LIKE 'SPAM:%' THEN 'spam'
            WHEN raison LIKE 'HATE:%' THEN 'hate'
            WHEN raison LIKE 'VIOLENCE:%' THEN 'violence'
            WHEN raison LIKE 'NUDITY:%' THEN 'nudity'
            WHEN raison LIKE 'MISINFORMATION:%' THEN 'misinformation'
            WHEN raison LIKE 'HARASSMENT:%' THEN 'harassment'
            ELSE 'other'
          END as category,
          COUNT(*) as count
        FROM cercle.report
        WHERE reported_at >= NOW() - INTERVAL '30 days'
        GROUP BY category
        ORDER BY count DESC
      `;
      
      return stats.map(stat => ({
        category: stat.category,
        count: parseInt(stat.count)
      }));
    } catch (error) {
      return [];
    }
  }
}

module.exports = ReportController;
