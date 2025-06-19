// src/controllers/userController.js - Version complète SANS ALTÉRER les méthodes existantes

const prisma = require('../utils/database');
const { 
  updateProfileSchema, 
  searchSchema, 
  userParamsSchema, 
  paginationSchema,
  updateBioSchema,
  updateProfilePictureSchema,
  updatePreferencesSchema,
  updateRoleSchema
} = require('../validators/userValidator');
const logger = require('../utils/logger');

class UserController {
  /**
   * Obtenir le profil de l'utilisateur connecté
   */
  static async getProfile(req, res) {
    try {
      const user = await prisma.user.findUnique({
        where: { id_user: req.user.id_user },
        select: {
          id_user: true,
          username: true,
          mail: true,
          nom: true,
          prenom: true,
          bio: true,
          photo_profil: true,
          telephone: true,
          private: true,
          certified: true,
          created_at: true,
          updated_at: true,
          _count: {
            select: {
              posts: { where: { active: true } },
              followers: { 
                where: { 
                  active: true, 
                  pending: false,
                  follower_user: { is_active: true }
                } 
              },
              following: { 
                where: { 
                  active: true, 
                  pending: false,
                  account_user: { is_active: true }
                } 
              }
            }
          }
        }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        ...user,
        stats: {
          posts: user._count.posts,
          followers: user._count.followers,
          following: user._count.following
        },
        _count: undefined
      });
    } catch (error) {
      logger.error('Get profile error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * ✅ CORRECTION COMPLÈTE: Obtenir le profil d'un utilisateur par son ID
   */
  static async getUserById(req, res) {
    try {
      console.log('🔄 getUserById called with params:', req.params);

      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        console.error('❌ Validation error:', paramsError.details[0].message);
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;
      console.log(`🔄 Raw ID from params: "${id}" (type: ${typeof id})`);

      // ✅ CORRECTION CRITIQUE: Convertir l'ID en entier
      let userId;
      try {
        userId = parseInt(id, 10);
        if (isNaN(userId) || userId <= 0) {
          console.error('❌ Invalid user ID:', id);
          return res.status(400).json({ error: 'Invalid user ID format' });
        }
      } catch (conversionError) {
        console.error('❌ ID conversion error:', conversionError);
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      console.log(`🔄 Converted userId: ${userId} (type: ${typeof userId})`);

      // Récupérer l'utilisateur
      const user = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: {
          id_user: true,
          username: true,
          nom: true,
          prenom: true,
          bio: true,
          photo_profil: true,
          private: true,
          certified: true,
          created_at: true,
          _count: {
            select: {
              posts: { where: { active: true } },
              followers: { 
                where: { 
                  active: true, 
                  pending: false,
                  follower_user: { is_active: true }
                } 
              },
              following: { 
                where: { 
                  active: true, 
                  pending: false,
                  account_user: { is_active: true }
                } 
              }
            }
          }
        }
      });

      if (!user) {
        console.error(`❌ User not found for ID: ${userId}`);
        return res.status(404).json({ error: 'User not found' });
      }

      console.log('✅ User found:', user.username);

      // Vérifier le statut de suivi si l'utilisateur est connecté
      let followStatus = null;
      if (req.user && req.user.id_user !== userId) {
        const followRelation = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: userId
            }
          },
          select: { active: true, pending: true }
        });

        if (followRelation) {
          followStatus = followRelation.pending ? 'pending' : 'following';
        } else {
          followStatus = 'not_following';
        }
      }

      res.json({
        ...user,
        stats: {
          posts: user._count.posts,
          followers: user._count.followers,
          following: user._count.following
        },
        followStatus,
        _count: undefined
      });
    } catch (error) {
      console.error('❌ getUserById error:', error);
      logger.error('Get user by ID error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * ✅ CORRECTION COMPLÈTE: Obtenir les statistiques d'un utilisateur
   */
  static async getUserStats(req, res) {
    try {
      console.log('🔄 getUserStats called with params:', req.params);

      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        console.error('❌ Validation error:', paramsError.details[0].message);
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;
      console.log(`🔄 Raw ID from params: "${id}" (type: ${typeof id})`);

      // ✅ CORRECTION CRITIQUE: Convertir l'ID en entier
      let userId;
      try {
        userId = parseInt(id, 10);
        if (isNaN(userId) || userId <= 0) {
          console.error('❌ Invalid user ID:', id);
          return res.status(400).json({ error: 'Invalid user ID format' });
        }
      } catch (conversionError) {
        console.error('❌ ID conversion error:', conversionError);
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      console.log(`🔄 Converted userId: ${userId} (type: ${typeof userId})`);

      // Récupérer les statistiques
      const stats = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: {
          id_user: true,
          _count: {
            select: {
              posts: { where: { active: true } },
              followers: { 
                where: { 
                  active: true, 
                  pending: false,
                  follower_user: { is_active: true }
                } 
              },
              following: { 
                where: { 
                  active: true, 
                  pending: false,
                  account_user: { is_active: true }
                } 
              },
              likes: { where: { active: true } }
            }
          }
        }
      });

      if (!stats) {
        console.error(`❌ User not found for stats, ID: ${userId}`);
        return res.status(404).json({ error: 'User not found' });
      }

      console.log('✅ Stats retrieved successfully:', stats._count);

      res.json({
        posts: stats._count.posts,
        followers: stats._count.followers,
        following: stats._count.following,
        likes: stats._count.likes
      });

    } catch (error) {
      console.error('❌ getUserStats error:', error);
      logger.error('Get user stats error:', error);
      
      if (process.env.NODE_ENV === 'development') {
        res.status(500).json({ 
          error: 'Internal server error',
          details: error.message,
          stack: error.stack
        });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Mettre à jour le profil utilisateur
   */
  static async updateProfile(req, res) {
    try {
      const { error, value } = updateProfileSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier que l'utilisateur existe et est actif
      const existingUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true, username: true, mail: true, telephone: true }
      });

      if (!existingUser) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Vérifier l'unicité des champs modifiés sur les comptes actifs
      const fieldsToCheck = [];
      
      if (value.username && value.username !== existingUser.username) {
        fieldsToCheck.push({ username: value.username });
      }
      if (value.mail && value.mail !== existingUser.mail) {
        fieldsToCheck.push({ mail: value.mail });
      }
      if (value.telephone && value.telephone !== existingUser.telephone) {
        fieldsToCheck.push({ telephone: value.telephone });
      }

      // Vérifier l'unicité si des champs sont à modifier
      if (fieldsToCheck.length > 0) {
        const conflictingUsers = await prisma.user.findMany({
          where: {
            AND: [
              { is_active: true },
              { id_user: { not: req.user.id_user } },
              { OR: fieldsToCheck }
            ]
          },
          select: { username: true, mail: true, telephone: true }
        });

        if (conflictingUsers.length > 0) {
          const conflicts = [];
          conflictingUsers.forEach(user => {
            if (value.username && user.username === value.username) {
              conflicts.push('username');
            }
            if (value.mail && user.mail === value.mail) {
              conflicts.push('email');
            }
            if (value.telephone && user.telephone === value.telephone) {
              conflicts.push('telephone');
            }
          });
          
          return res.status(409).json({ 
            error: `The following fields are already taken: ${conflicts.join(', ')}` 
          });
        }
      }

      // Préparer les données de mise à jour
      const updateData = {
        ...value,
        updated_at: new Date()
      };

      // Mise à jour de l'utilisateur
      const updatedUser = await prisma.user.update({
        where: { id_user: req.user.id_user },
        data: updateData,
        select: {
          id_user: true,
          username: true,
          mail: true,
          nom: true,
          prenom: true,
          bio: true,
          photo_profil: true,
          telephone: true,
          private: true,
          certified: true,
          created_at: true,
          updated_at: true
        }
      });

      logger.info(`User profile updated: ${updatedUser.username} (${updatedUser.mail})`);

      res.json(updatedUser);
    } catch (error) {
      logger.error('Update profile error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Rechercher des utilisateurs
   */
  static async searchUsers(req, res) {
    try {
      const { error, value } = searchSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { search, page, limit } = value;
      const skip = (page - 1) * limit;

      const searchTerms = search.trim().split(/\s+/);
      
      // Construire les conditions de recherche
      const searchConditions = searchTerms.map(term => ({
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { nom: { contains: term, mode: 'insensitive' } },
          { prenom: { contains: term, mode: 'insensitive' } },
          { bio: { contains: term, mode: 'insensitive' } }
        ]
      }));

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where: {
            AND: [
              { is_active: true },
              ...searchConditions
            ]
          },
          select: {
            id_user: true,
            username: true,
            nom: true,
            prenom: true,
            bio: true,
            photo_profil: true,
            certified: true,
            _count: {
              select: {
                followers: { where: { active: true, pending: false } },
                posts: { where: { active: true } }
              }
            }
          },
          orderBy: [
            { certified: 'desc' },
            { username: 'asc' }
          ],
          skip,
          take: limit
        }),
        prisma.user.count({
          where: {
            AND: [
              { is_active: true },
              ...searchConditions
            ]
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        users: users.map(user => ({
          ...user,
          stats: {
            followers: user._count.followers,
            posts: user._count.posts
          },
          _count: undefined
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
      logger.error('Search users error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir des utilisateurs suggérés
   */
  static async getSuggestedUsers(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 10;
      const currentUserId = req.user.id_user;

      // Obtenir des utilisateurs que l'utilisateur actuel ne suit pas
      const suggestedUsers = await prisma.user.findMany({
        where: {
          AND: [
            { id_user: { not: currentUserId } },
            { is_active: true },
            {
              NOT: {
                followers: {
                  some: {
                    follower: currentUserId,
                    active: true
                  }
                }
              }
            }
          ]
        },
        select: {
          id_user: true,
          username: true,
          nom: true,
          prenom: true,
          bio: true,
          photo_profil: true,
          certified: true,
          _count: {
            select: {
              followers: { where: { active: true, pending: false } },
              posts: { where: { active: true } }
            }
          }
        },
        orderBy: [
          { certified: 'desc' },
          { created_at: 'desc' }
        ],
        take: limit
      });

      res.json({
        users: suggestedUsers.map(user => ({
          ...user,
          stats: {
            followers: user._count.followers,
            posts: user._count.posts
          },
          _count: undefined
        }))
      });
    } catch (error) {
      logger.error('Get suggested users error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * ✅ NOUVELLE MÉTHODE: Obtenir des utilisateurs recommandés pour l'onboarding
   */
  static async getRecommendedUsers(req, res) {
    try {
      const currentUserId = req.user.id_user;
      const limit = parseInt(req.query.limit) || 8;

      console.log(`🔍 Getting recommendations for user ${currentUserId}, limit: ${limit}`);

      // Récupérer des utilisateurs récents qui ne sont pas suivis et pas l'utilisateur actuel
      const recommendedUsers = await prisma.user.findMany({
        where: {
          AND: [
            { id_user: { not: currentUserId } },
            { is_active: true },
            {
              NOT: {
                followers: {
                  some: {
                    follower: currentUserId,
                    active: true
                  }
                }
              }
            }
          ]
        },
        select: {
          id_user: true,
          username: true,
          prenom: true,
          nom: true,
          bio: true,
          photo_profil: true,
          certified: true,
          created_at: true,
          _count: {
            select: {
              followers: {
                where: { active: true, pending: false }
              },
              following: {
                where: { active: true, pending: false }
              },
              posts: {
                where: { active: true }
              }
            }
          }
        },
        orderBy: [
          { certified: 'desc' }, // Utilisateurs certifiés en premier
          { created_at: 'desc' }  // Puis par date d'inscription
        ],
        take: limit
      });

      console.log(`✅ Found ${recommendedUsers.length} recommended users`);

      res.json(recommendedUsers);
    } catch (error) {
      console.error('❌ Error fetching recommended users:', error);
      logger.error('Error fetching recommended users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * ✅ NOUVELLE MÉTHODE: Marquer l'onboarding comme terminé
   */
  static async completeOnboarding(req, res) {
    try {
      const userId = req.user.id_user;

      console.log(`🎯 Completing onboarding for user ${userId}`);

      // Vérifier si l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: {
          id_user: userId,
          is_active: true
        }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Mettre à jour les préférences utilisateur pour marquer l'onboarding comme terminé
      const preferences = await prisma.userPreferences.upsert({
        where: { id_user: userId },
        update: {
          onboarding_completed: true,
          updated_at: new Date()
        },
        create: {
          id_user: userId,
          onboarding_completed: true,
          email_notification: true,
          id_langue: 1, // Français par défaut
          id_theme: 1,  // Thème clair par défaut
          created_at: new Date(),
          updated_at: new Date()
        }
      });

      console.log(`✅ Onboarding completed for user ${userId}`);
      logger.info(`User ${userId} completed onboarding`);
      
      res.json({ 
        message: 'Onboarding completed successfully',
        success: true,
        preferences: preferences
      });
    } catch (error) {
      console.error('❌ Error completing onboarding:', error);
      logger.error('Error completing onboarding:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = UserController;