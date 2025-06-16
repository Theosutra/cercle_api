// src/controllers/userController.js - CORRECTION COMPLÈTE

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
   * ✅ CORRECTION: Obtenir le profil d'un utilisateur par son ID
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
      } catch (error) {
        console.error('❌ Error parsing user ID:', error);
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      console.log(`🔄 Converted ID to integer: ${userId}`);

      // ✅ CORRECTION: Utiliser l'entier pour la requête Prisma
      const user = await prisma.user.findUnique({
        where: { id_user: userId }, // Maintenant c'est un entier
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
          is_active: true,
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

      console.log(`🔄 User query result: ${user ? 'Found' : 'Not found'}`);

      if (!user || !user.is_active) {
        console.log('❌ User not found or inactive');
        return res.status(404).json({ error: 'User not found' });
      }

      // Vérifier les permissions d'accès
      let canAccess = false;
      let isFollowing = false;

      console.log(`🔄 Checking access permissions. Private: ${user.private}`);

      if (!user.private) {
        // Compte public : accessible à tous
        canAccess = true;
        console.log('✅ Public account - access granted');
      } else if (req.user) {
        console.log(`🔄 Private account - checking for user ${req.user.id_user}`);
        
        // ✅ CORRECTION: S'assurer que les IDs sont du même type pour la comparaison
        const currentUserId = parseInt(req.user.id_user, 10);
        
        if (currentUserId === userId) {
          // L'utilisateur consulte son propre profil
          canAccess = true;
          console.log('✅ Own profile - access granted');
        } else {
          console.log(`🔄 Checking follow relation between ${currentUserId} and ${userId}`);
          
          const followRelation = await prisma.follow.findUnique({
            where: {
              follower_account: {
                follower: currentUserId, // Entier
                account: userId // Entier
              }
            },
            select: { active: true, pending: true }
          });

          console.log('🔄 Follow relation result:', followRelation);

          isFollowing = followRelation && followRelation.active && !followRelation.pending;
          canAccess = isFollowing;
          console.log(`🔄 Following: ${isFollowing}, Access granted: ${canAccess}`);
        }
      } else {
        console.log('❌ Private account and no authenticated user');
      }

      if (!canAccess) {
        console.log('❌ Access denied');
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'This account is private'
        });
      }

      const response = {
        id_user: user.id_user,
        username: user.username,
        nom: user.nom,
        prenom: user.prenom,
        bio: user.bio,
        photo_profil: user.photo_profil,
        certified: user.certified,
        private: user.private,
        created_at: user.created_at,
        stats: {
          posts: user._count.posts,
          followers: user._count.followers,
          following: user._count.following
        },
        isFollowing: req.user && parseInt(req.user.id_user, 10) !== userId ? isFollowing : undefined
      };

      console.log('✅ Sending successful response');
      res.json(response);

    } catch (error) {
      console.error('❌ getUserById error:', error);
      logger.error('Get user by ID error:', error);
      
      // Réponse d'erreur détaillée en développement
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
   * ✅ CORRECTION: Obtenir les statistiques d'un utilisateur
   */
  static async getUserStats(req, res) {
    try {
      console.log('🔄 getUserStats called with params:', req.params);

      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        console.error('❌ Stats validation error:', paramsError.details[0].message);
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;
      console.log(`🔄 Getting stats for raw ID: "${id}"`);

      // ✅ CORRECTION CRITIQUE: Convertir l'ID en entier
      let userId;
      try {
        userId = parseInt(id, 10);
        if (isNaN(userId) || userId <= 0) {
          console.error('❌ Invalid user ID for stats:', id);
          return res.status(400).json({ error: 'Invalid user ID format' });
        }
      } catch (error) {
        console.error('❌ Error parsing user ID for stats:', error);
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      console.log(`🔄 Converted stats ID to integer: ${userId}`);

      // Vérifier que l'utilisateur existe
      const user = await prisma.user.findUnique({
        where: { id_user: userId }, // Entier
        select: { id_user: true, is_active: true, private: true }
      });

      console.log(`🔄 User exists for stats: ${user ? 'Yes' : 'No'}`);

      if (!user || !user.is_active) {
        console.log('❌ User not found for stats');
        return res.status(404).json({ error: 'User not found' });
      }

      // Vérifier les permissions pour les comptes privés
      if (user.private && req.user) {
        const currentUserId = parseInt(req.user.id_user, 10);

        if (currentUserId !== userId) {
          console.log(`🔄 Checking follow for stats: ${currentUserId} -> ${userId}`);
          
          const isFollowing = await prisma.follow.findUnique({
            where: {
              follower_account: {
                follower: currentUserId, // Entier
                account: userId // Entier
              }
            },
            select: { active: true, pending: true }
          });

          if (!isFollowing || !isFollowing.active || isFollowing.pending) {
            console.log('❌ Access denied for private account stats');
            return res.status(403).json({ error: 'Access denied' });
          }
        }
      }

      console.log('🔄 Querying stats from database...');

      const stats = await prisma.user.findUnique({
        where: { id_user: userId }, // Entier
        select: {
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
              likes: true
            }
          }
        }
      });

      if (!stats) {
        console.log('❌ No stats found');
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

  // ✅ Autres méthodes inchangées...
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

      if (fieldsToCheck.length > 0) {
        for (const field of fieldsToCheck) {
          const conflict = await prisma.user.findFirst({
            where: {
              AND: [
                field,
                { id_user: { not: req.user.id_user } },
                { is_active: true }
              ]
            },
            select: { id_user: true }
          });

          if (conflict) {
            const fieldName = Object.keys(field)[0];
            return res.status(409).json({ 
              error: `${fieldName} already exists`,
              field: fieldName 
            });
          }
        }
      }

      // Mettre à jour le profil
      const updatedUser = await prisma.user.update({
        where: { id_user: req.user.id_user },
        data: {
          ...value,
          updated_at: new Date()
        },
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

      res.json({
        message: 'Profile updated successfully',
        user: updatedUser
      });
    } catch (error) {
      logger.error('Update profile error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async searchUsers(req, res) {
    try {
      const { error, value } = searchSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { search, page, limit } = value;
      const skip = (page - 1) * limit;

      const whereClause = {
        AND: [
          { is_active: true },
          search ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { nom: { contains: search, mode: 'insensitive' } },
              { prenom: { contains: search, mode: 'insensitive' } }
            ]
          } : {}
        ]
      };

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where: whereClause,
          select: {
            id_user: true,
            username: true,
            nom: true,
            prenom: true,
            bio: true,
            photo_profil: true,
            certified: true,
            private: true,
            _count: {
              select: {
                followers: { 
                  where: { 
                    active: true, 
                    pending: false,
                    follower_user: { is_active: true }
                  } 
                }
              }
            }
          },
          skip,
          take: limit,
          orderBy: [
            { certified: 'desc' },
            { username: 'asc' }
          ]
        }),
        prisma.user.count({ where: whereClause })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        users: users.map(user => ({
          ...user,
          followerCount: user._count.followers,
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

  static async getSuggestedUsers(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Récupérer les IDs des utilisateurs déjà suivis
      const followedUsers = await prisma.follow.findMany({
        where: {
          follower: req.user.id_user,
          active: true
        },
        select: { account: true }
      });

      const followedUserIds = followedUsers.map(f => f.account);
      followedUserIds.push(req.user.id_user); // Exclure l'utilisateur lui-même

      const suggestedUsers = await prisma.user.findMany({
        where: {
          AND: [
            { is_active: true },
            { id_user: { notIn: followedUserIds } }
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
          private: true,
          _count: {
            select: {
              followers: { 
                where: { 
                  active: true, 
                  pending: false,
                  follower_user: { is_active: true }
                } 
              }
            }
          }
        },
        skip,
        take: limit,
        orderBy: [
          { certified: 'desc' },
          { created_at: 'desc' }
        ]
      });

      res.json(
        suggestedUsers.map(user => ({
          ...user,
          followerCount: user._count.followers,
          _count: undefined
        }))
      );
    } catch (error) {
      logger.error('Get suggested users error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = UserController;