const prisma = require('../utils/database');
const logger = require('../utils/logger');
const { postParamsSchema, userParamsSchema } = require('../validators/postValidator');
const { paginationSchema } = require('../validators/userValidator');

class LikeController {
  /**
   * Toggle like/unlike sur un post
   */
  static async toggleLike(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: postId } = req.params;

      // Vérifier que le post existe
      const post = await prisma.post.findUnique({
        where: { id_post: postId },
        select: { 
          id_post: true, 
          active: true,
          author: {
            select: { id_user: true, private: true }
          }
        }
      });

      if (!post || !post.active) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Vérifier les permissions pour les comptes privés
      if (post.author.private && post.author.id_user !== req.user.id_user) {
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
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Vérifier si le like existe déjà
      const existingLike = await prisma.like.findUnique({
        where: {
          id_user_id_post: {
            id_user: req.user.id_user,
            id_post: postId
          }
        }
      });

      let isLiked;
      let message;
      
      if (existingLike) {
        // Unlike - supprimer le like
        await prisma.like.delete({
          where: {
            id_user_id_post: {
              id_user: req.user.id_user,
              id_post: postId
            }
          }
        });
        isLiked = false;
        message = 'Post unliked';
        logger.info(`Post unliked by ${req.user.username}: ${postId}`);
      } else {
        // Like - créer le like
        await prisma.like.create({
          data: {
            id_user: req.user.id_user,
            id_post: postId
          }
        });
        isLiked = true;
        message = 'Post liked';
        logger.info(`Post liked by ${req.user.username}: ${postId}`);
      }

      // Obtenir le nombre total de likes mis à jour
      const likeCount = await prisma.like.count({
        where: { id_post: postId }
      });

      res.json({
        message,
        isLiked,
        likeCount
      });
    } catch (error) {
      logger.error('Toggle like error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir la liste des utilisateurs qui ont liké un post
   */
  static async getPostLikes(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = paginationSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { id: postId } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Vérifier que le post existe
      const post = await prisma.post.findUnique({
        where: { id_post: postId },
        select: { 
          active: true,
          author: {
            select: { id_user: true, private: true }
          }
        }
      });

      if (!post || !post.active) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Vérifier les permissions pour les comptes privés
      if (post.author.private && req.user && post.author.id_user !== req.user.id_user) {
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
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const [likes, total] = await Promise.all([
        prisma.like.findMany({
          where: { id_post: postId },
          include: {
            user: {
              select: {
                id_user: true,
                username: true,
                nom: true,
                prenom: true,
                photo_profil: true,
                certified: true
              }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.like.count({ where: { id_post: postId } })
      ]);

      const totalPages = Math.ceil(total / limit);

      res.json({
        users: likes.map(like => like.user),
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
      logger.error('Get post likes error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts likés par un utilisateur
   */
  static async getUserLikedPosts(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = paginationSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { id: userId } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Vérifier que l'utilisateur existe
      const user = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { private: true, is_active: true }
      });

      if (!user || !user.is_active) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Vérifier les permissions pour les comptes privés
      if (user.private && req.user && userId !== req.user.id_user) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: userId
            }
          },
          select: { active: true, pending: true }
        });

        if (!isFollowing || !isFollowing.active || isFollowing.pending) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const [likedPosts, total] = await Promise.all([
        prisma.like.findMany({
          where: { id_user: userId },
          include: {
            post: {
              include: {
                author: {
                  select: {
                    id_user: true,
                    username: true,
                    photo_profil: true,
                    certified: true
                  }
                },
                _count: {
                  select: {
                    likes: true,
                    mentions: true
                  }
                },
                ...(req.user && {
                  likes: {
                    where: { id_user: req.user.id_user },
                    select: { id_user: true }
                  }
                })
              }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.like.count({ where: { id_user: userId } })
      ]);

      // Filtrer les posts actifs et transformer les données
      const posts = likedPosts
        .filter(like => like.post && like.post.active)
        .map(like => ({
          ...like.post,
          isLiked: req.user ? like.post.likes?.length > 0 : true, // True car c'est dans ses likes
          likeCount: like.post._count.likes,
          mentionCount: like.post._count.mentions,
          likedAt: like.created_at,
          likes: undefined,
          _count: undefined
        }));

      const totalPages = Math.ceil(total / limit);

      res.json({
        posts,
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
      logger.error('Get user liked posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les statistiques de likes d'un utilisateur
   */
  static async getUserLikeStats(req, res) {
    try {
      const { error: paramsError } = userParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: userId } = req.params;

      // Vérifier que l'utilisateur existe
      const user = await prisma.user.findUnique({
        where: { id_user: userId },
        select: { is_active: true }
      });

      if (!user || !user.is_active) {
        return res.status(404).json({ error: 'User not found' });
      }

      const [likesGiven, likesReceived] = await Promise.all([
        // Likes donnés par l'utilisateur
        prisma.like.count({
          where: { id_user: userId }
        }),
        // Likes reçus sur ses posts
        prisma.like.count({
          where: {
            post: {
              id_user: userId,
              active: true
            }
          }
        })
      ]);

      res.json({
        likesGiven,
        likesReceived,
        ratio: likesGiven > 0 ? (likesReceived / likesGiven).toFixed(2) : 0
      });
    } catch (error) {
      logger.error('Get user like stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = LikeController;