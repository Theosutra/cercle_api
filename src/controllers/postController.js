const prisma = require('../utils/database');
const { 
  createPostSchema, 
  updatePostSchema, 
  getPostsSchema,
  postParamsSchema,
  userPostsParamsSchema,
  searchPostsSchema
} = require('../validators/postValidator');
const logger = require('../utils/logger');

class PostController {
  /**
   * Créer un nouveau post
   */
  static async createPost(req, res) {
    try {
      const { error, value } = createPostSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { content, id_message_type } = value;

      const post = await prisma.post.create({
        data: {
          content,
          id_user: req.user.id_user,
          id_message_type: id_message_type || null
        },
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
              likes: true
            }
          }
        }
      });

      logger.info(`New post created by ${req.user.username}: ${post.id_post}`);

      res.status(201).json({
        message: 'Post created successfully',
        post: {
          ...post,
          isLiked: false, // Nouveau post, pas encore liké
          likeCount: post._count.likes,
          mentionCount: post._count.mentions,
          _count: undefined
        }
      });
    } catch (error) {
      logger.error('Create post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir la timeline personnalisée (posts des utilisateurs suivis + ses propres posts)
   */
  static async getTimeline(req, res) {
    try {
      const { error, value } = getPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Récupérer les posts des utilisateurs suivis + ses propres posts
      const posts = await prisma.post.findMany({
        where: {
          AND: [
            { active: true },
            {
              OR: [
                { id_user: req.user.id_user }, // Ses propres posts
                {
                  author: {
                    followers: {
                      some: { 
                        follower: req.user.id_user,
                        active: true,
                        pending: false
                      }
                    }
                  }
                }
              ]
            }
          ]
        },
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
          likes: {
            where: { id_user: req.user.id_user },
            select: { id_user: true }
          }
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      });

      // Transformer les posts pour inclure le statut isLiked
      const postsWithLikeStatus = posts.map(post => ({
        ...post,
        isLiked: post.likes.length > 0,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        likes: undefined,
        _count: undefined
      }));

      res.json(postsWithLikeStatus);
    } catch (error) {
      logger.error('Get timeline error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir la timeline publique (posts de comptes publics)
   */
  static async getPublicTimeline(req, res) {
    try {
      const { error, value } = getPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const posts = await prisma.post.findMany({
        where: { 
          active: true,
          author: { 
            private: false,
            is_active: true 
          }
        },
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
          // Inclure le statut like si utilisateur connecté
          ...(req.user && {
            likes: {
              where: { id_user: req.user.id_user },
              select: { id_user: true }
            }
          })
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      });

      const postsWithLikeStatus = posts.map(post => ({
        ...post,
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        likes: undefined,
        _count: undefined
      }));

      res.json(postsWithLikeStatus);
    } catch (error) {
      logger.error('Get public timeline error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir un post spécifique par son ID
   */
  static async getPost(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;

      const post = await prisma.post.findUnique({
        where: { id_post: id },
        include: {
          author: {
            select: {
              id_user: true,
              username: true,
              photo_profil: true,
              certified: true,
              private: true
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
      });

      if (!post || !post.active) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Vérifier les permissions pour les comptes privés
      if (post.author.private && req.user) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: post.author.id_user
            }
          }
        });

        if (!isFollowing && post.author.id_user !== req.user.id_user) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const postWithLikeStatus = {
        ...post,
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        likes: undefined,
        _count: undefined
      };

      res.json(postWithLikeStatus);
    } catch (error) {
      logger.error('Get post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Mettre à jour un post
   */
  static async updatePost(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = updatePostSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { id } = req.params;

      // Vérifier que le post existe et appartient à l'utilisateur
      const existingPost = await prisma.post.findUnique({
        where: { id_post: id },
        select: { id_post: true, id_user: true, active: true }
      });

      if (!existingPost || !existingPost.active) {
        return res.status(404).json({ error: 'Post not found' });
      }

      if (existingPost.id_user !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const updatedPost = await prisma.post.update({
        where: { id_post: id },
        data: value,
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
          }
        }
      });

      logger.info(`Post updated by ${req.user.username}: ${id}`);

      res.json({
        message: 'Post updated successfully',
        post: {
          ...updatedPost,
          likeCount: updatedPost._count.likes,
          mentionCount: updatedPost._count.mentions,
          _count: undefined
        }
      });
    } catch (error) {
      logger.error('Update post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Supprimer un post (soft delete)
   */
  static async deletePost(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;

      // Vérifier que le post existe et appartient à l'utilisateur
      const existingPost = await prisma.post.findUnique({
        where: { id_post: id },
        select: { id_post: true, id_user: true, active: true }
      });

      if (!existingPost || !existingPost.active) {
        return res.status(404).json({ error: 'Post not found' });
      }

      if (existingPost.id_user !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Soft delete
      await prisma.post.update({
        where: { id_post: id },
        data: { active: false }
      });

      logger.info(`Post deleted by ${req.user.username}: ${id}`);

      res.json({ message: 'Post deleted successfully' });
    } catch (error) {
      logger.error('Delete post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts d'un utilisateur spécifique
   */
  static async getUserPosts(req, res) {
    try {
      const { error: paramsError } = userPostsParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = getPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { userId } = req.params;
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
      if (user.private && req.user) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: userId
            }
          }
        });

        if (!isFollowing && userId !== req.user.id_user) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const posts = await prisma.post.findMany({
        where: {
          id_user: userId,
          active: true
        },
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
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      });

      const postsWithLikeStatus = posts.map(post => ({
        ...post,
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        likes: undefined,
        _count: undefined
      }));

      res.json(postsWithLikeStatus);
    } catch (error) {
      logger.error('Get user posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Rechercher des posts
   */
  static async searchPosts(req, res) {
    try {
      const { error, value } = searchPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { search, page, limit, sortBy, order } = value;
      const skip = (page - 1) * limit;

      const where = {
        AND: [
          { active: true },
          { author: { is_active: true, private: false } }, // Seulement les comptes publics pour la recherche
          search ? {
            content: { contains: search, mode: 'insensitive' }
          } : {}
        ]
      };

      // Déterminer l'ordre de tri
      let orderBy;
      if (sortBy === 'likes_count') {
        orderBy = { likes: { _count: order } };
      } else {
        orderBy = { created_at: order };
      }

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where,
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
          },
          skip,
          take: limit,
          orderBy
        }),
        prisma.post.count({ where })
      ]);

      const postsWithLikeStatus = posts.map(post => ({
        ...post,
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        likes: undefined,
        _count: undefined
      }));

      const totalPages = Math.ceil(total / limit);

      res.json({
        posts: postsWithLikeStatus,
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
      logger.error('Search posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts populaires (tendances)
   */
  static async getTrendingPosts(req, res) {
    try {
      const { error, value } = getPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Posts des dernières 24h triés par nombre de likes
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const posts = await prisma.post.findMany({
        where: {
          active: true,
          created_at: { gte: yesterday },
          author: { 
            is_active: true,
            private: false 
          }
        },
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
        },
        skip,
        take: limit,
        orderBy: [
          { likes: { _count: 'desc' } },
          { created_at: 'desc' }
        ]
      });

      const postsWithLikeStatus = posts.map(post => ({
        ...post,
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        likes: undefined,
        _count: undefined
      }));

      res.json(postsWithLikeStatus);
    } catch (error) {
      logger.error('Get trending posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = PostController;