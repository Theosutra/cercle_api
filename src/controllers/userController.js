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
   * Obtenir le profil d'un utilisateur par son ID
   * Accessible : comptes publics + comptes privés suivis par l'utilisateur connecté
   */
  static async getUserById(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id_user: id },
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

      if (!user || !user.is_active) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Vérifier les permissions d'accès
      let canAccess = false;
      let isFollowing = false;

      if (!user.private) {
        // Compte public : accessible à tous
        canAccess = true;
      } else if (req.user) {
        // Compte privé : vérifier si l'utilisateur connecté le suit
        if (req.user.id_user === id) {
          // L'utilisateur consulte son propre profil
          canAccess = true;
        } else {
          const followRelation = await prisma.follow.findUnique({
            where: {
              follower_account: {
                follower: req.user.id_user,
                account: id
              }
            },
            select: { active: true, pending: true }
          });

          isFollowing = followRelation && followRelation.active && !followRelation.pending;
          canAccess = isFollowing;
        }
      }

      if (!canAccess) {
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
        isFollowing: req.user && req.user.id_user !== id ? isFollowing : undefined
      };

      res.json(response);
    } catch (error) {
      logger.error('Get user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Mettre à jour le profil de l'utilisateur connecté
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

      if (fieldsToCheck.length > 0) {
        for (const field of fieldsToCheck) {
          const conflict = await prisma.user.findFirst({
            where: {
              ...field,
              is_active: true,
              id_user: { not: req.user.id_user }
            }
          });

          if (conflict) {
            const fieldName = Object.keys(field)[0];
            return res.status(409).json({ 
              error: 'Field already taken',
              message: `This ${fieldName} is already used by another active account`
            });
          }
        }
      }

      // Supprimer les champs vides ou undefined
      const updateData = Object.entries(value).reduce((acc, [key, val]) => {
        if (val !== undefined && val !== '') {
          acc[key] = val;
        }
        return acc;
      }, {});

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      // Ajouter updated_at
      updateData.updated_at = new Date();

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
          updated_at: true
        }
      });

      logger.info(`Profile updated for user: ${req.user.username}`);

      res.json({
        message: 'Profile updated successfully',
        user: updatedUser
      });
    } catch (error) {
      logger.error('Update profile error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Basculer entre compte privé et public
   */
  static async togglePrivacy(req, res) {
    try {
      // Vérifier que l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true, private: true, username: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      const newPrivacyStatus = !user.private;

      // Transaction pour assurer la cohérence
      const result = await prisma.$transaction(async (tx) => {
        // Mettre à jour le statut de confidentialité
        const updatedUser = await tx.user.update({
          where: { id_user: req.user.id_user },
          data: { 
            private: newPrivacyStatus,
            updated_at: new Date()
          },
          select: { private: true, updated_at: true }
        });

        // Si passage en public, accepter automatiquement toutes les demandes en attente
        if (!newPrivacyStatus) {
          await tx.follow.updateMany({
            where: {
              account: req.user.id_user,
              pending: true,
              active: true
            },
            data: { pending: false }
          });
        }

        return updatedUser;
      });

      logger.info(`Privacy toggled for user: ${user.username} - now ${newPrivacyStatus ? 'private' : 'public'}`);

      res.json({
        message: `Account is now ${newPrivacyStatus ? 'private' : 'public'}`,
        private: result.private,
        updated_at: result.updated_at
      });
    } catch (error) {
      logger.error('Toggle privacy error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Mettre à jour la bio de l'utilisateur
   */
  static async updateBio(req, res) {
    try {
      const { error, value } = updateBioSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier que l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      const updatedUser = await prisma.user.update({
        where: { id_user: req.user.id_user },
        data: { 
          bio: value.bio,
          updated_at: new Date()
        },
        select: { bio: true, updated_at: true }
      });

      logger.info(`Bio updated for user: ${user.username}`);

      res.json({
        message: 'Bio updated successfully',
        bio: updatedUser.bio,
        updated_at: updatedUser.updated_at
      });
    } catch (error) {
      logger.error('Update bio error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Mettre à jour la photo de profil
   */
  static async updateProfilePicture(req, res) {
    try {
      const { error, value } = updateProfilePictureSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier que l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      const updatedUser = await prisma.user.update({
        where: { id_user: req.user.id_user },
        data: { 
          photo_profil: value.photo_profil,
          updated_at: new Date()
        },
        select: { photo_profil: true, updated_at: true }
      });

      logger.info(`Profile picture updated for user: ${user.username}`);

      res.json({
        message: 'Profile picture updated successfully',
        photo_profil: updatedUser.photo_profil,
        updated_at: updatedUser.updated_at
      });
    } catch (error) {
      logger.error('Update profile picture error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Supprimer le compte (soft delete)
   */
  static async deleteAccount(req, res) {
    try {
      // Vérifier que l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Soft delete
      await prisma.user.update({
        where: { id_user: req.user.id_user },
        data: { 
          is_active: false,
          updated_at: new Date()
        }
      });

      logger.info(`Account deleted for user: ${user.username}`);

      res.json({
        message: 'Account deleted successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Delete account error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Mettre à jour les préférences utilisateur
   */
  static async updatePreferences(req, res) {
    try {
      const { error, value } = updatePreferencesSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier que l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Vérifier que la langue existe (si fournie)
      if (value.id_langue) {
        const langue = await prisma.langue.findUnique({
          where: { id_langue: value.id_langue }
        });
        if (!langue) {
          return res.status(400).json({ error: 'Language not found' });
        }
      }

      // Vérifier que le thème existe (si fourni)
      if (value.id_theme) {
        const theme = await prisma.theme.findUnique({
          where: { id_theme: value.id_theme }
        });
        if (!theme) {
          return res.status(400).json({ error: 'Theme not found' });
        }
      }

      // Supprimer les champs undefined
      const updateData = Object.entries(value).reduce((acc, [key, val]) => {
        if (val !== undefined) {
          acc[key] = val;
        }
        return acc;
      }, {});

      const updatedPreferences = await prisma.userPreferences.upsert({
        where: { id_user: req.user.id_user },
        update: updateData,
        create: {
          id_user: req.user.id_user,
          id_langue: value.id_langue || 1, // Français par défaut
          email_notification: value.email_notification !== undefined ? value.email_notification : false,
          id_theme: value.id_theme || 1 // Light par défaut
        },
        include: {
          langue: true,
          theme: true
        }
      });

      logger.info(`Preferences updated for user: ${user.username}`);

      res.json({
        message: 'Preferences updated successfully',
        preferences: updatedPreferences
      });
    } catch (error) {
      logger.error('Update preferences error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Mettre à jour le rôle d'un utilisateur (admin uniquement)
   */
  static async updateRole(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = updateRoleSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { id: targetUserId } = req.params;
      const { id_role } = value;

      // Vérifier que l'utilisateur connecté est admin
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
          message: 'Only administrators can update user roles'
        });
      }

      // Vérifier que l'utilisateur cible existe et est actif
      const targetUser = await prisma.user.findFirst({
        where: { 
          id_user: targetUserId,
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found or inactive' });
      }

      // Vérifier que le nouveau rôle existe
      const newRole = await prisma.role.findUnique({
        where: { id_role: id_role }
      });

      if (!newRole) {
        return res.status(400).json({ error: 'Role not found' });
      }

      // Mettre à jour le rôle
      const updatedUser = await prisma.user.update({
        where: { id_user: targetUserId },
        data: { 
          id_role: id_role,
          updated_at: new Date()
        },
        include: { role: true },
        select: {
          id_user: true,
          username: true,
          role: true,
          updated_at: true
        }
      });

      logger.info(`Role updated for user: ${targetUser.username} to ${newRole.role} by ${currentUser.username}`);

      res.json({
        message: 'Role updated successfully',
        user: {
          id_user: updatedUser.id_user,
          username: updatedUser.username,
          role: updatedUser.role.role,
          updated_at: updatedUser.updated_at
        }
      });
    } catch (error) {
      logger.error('Update role error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Rechercher des utilisateurs (tous les comptes actifs)
   */
  static async searchUsers(req, res) {
    try {
      const { error, value } = searchSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { search, page, limit } = value;
      const skip = (page - 1) * limit;

      const where = {
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
          where,
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
            { certified: 'desc' }, // Les comptes certifiés en premier
            { created_at: 'desc' }
          ]
        }),
        prisma.user.count({ where })
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

  /**
   * Obtenir les utilisateurs suggérés (non suivis)
   */
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

  /**
   * Obtenir les statistiques d'un utilisateur
   */
  static async getUserStats(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;

      // Vérifier que l'utilisateur existe
      const user = await prisma.user.findUnique({
        where: { id_user: id },
        select: { id_user: true, is_active: true, private: true }
      });

      if (!user || !user.is_active) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Vérifier les permissions pour les comptes privés
      if (user.private && req.user && req.user.id_user !== id) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: id
            }
          },
          select: { active: true, pending: true }
        });

        if (!isFollowing || !isFollowing.active || isFollowing.pending) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const stats = await prisma.user.findUnique({
        where: { id_user: id },
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

      res.json({
        posts: stats._count.posts,
        followers: stats._count.followers,
        following: stats._count.following,
        likes: stats._count.likes
      });
    } catch (error) {
      logger.error('Get user stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = UserController;
