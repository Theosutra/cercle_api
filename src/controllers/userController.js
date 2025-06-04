const prisma = require('../utils/database');
const { updateProfileSchema, searchSchema, userParamsSchema, paginationSchema } = require('../validators/userValidator');
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
              followers: { where: { active: true, pending: false } },
              following: { where: { active: true, pending: false } }
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
              followers: { where: { active: true, pending: false } },
              following: { where: { active: true, pending: false } }
            }
          }
        }
      });

      if (!user || !user.is_active) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Vérifier si l'utilisateur connecté suit cet utilisateur (si applicable)
      let isFollowing = false;
      let isPrivateAndNotFollowing = false;

      if (req.user && req.user.id_user !== id) {
        const followRelation = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: id
            }
          },
          select: { active: true, pending: false }
        });

        isFollowing = followRelation && followRelation.active && !followRelation.pending;
        isPrivateAndNotFollowing = user.private && !isFollowing;
      }

      // Si le profil est privé et que l'utilisateur ne le suit pas, limiter les informations
      const response = {
        id_user: user.id_user,
        username: user.username,
        nom: user.nom,
        prenom: user.prenom,
        photo_profil: user.photo_profil,
        certified: user.certified,
        private: user.private,
        created_at: user.created_at,
        isFollowing: req.user ? isFollowing : undefined
      };

      if (!isPrivateAndNotFollowing || !req.user) {
        response.bio = user.bio;
        response.stats = {
          posts: user._count.posts,
          followers: user._count.followers,
          following: user._count.following
        };
      }

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
                followers: { where: { active: true, pending: false } }
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
              followers: { where: { active: true, pending: false } }
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
          select: { active: true, pending: false }
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
              followers: { where: { active: true, pending: false } },
              following: { where: { active: true, pending: false } },
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