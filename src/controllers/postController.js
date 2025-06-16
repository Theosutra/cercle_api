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
   * Extraire les mentions du contenu (@username)
   */
  static extractMentions(content) {
    const mentionRegex = /@([a-zA-Z0-9_]+)/g;
    const matches = content.match(mentionRegex);
    return matches ? matches.map(m => m.substring(1)) : [];
  }

  /**
   * Extraire les tags du contenu (#hashtag)
   */
  static extractTags(content) {
    const tagRegex = /#([a-zA-Z0-9_]+)/g;
    const matches = content.match(tagRegex);
    return matches ? matches.map(t => t.substring(1)) : [];
  }

  /**
   * Traiter les mentions dans un post (version simplifiée pour debug)
   */
  static async processMentions(postId, content, authorUsername, tx) {
    try {
      const mentionedUsernames = this.extractMentions(content);
      const mentions = [];

      if (mentionedUsernames.length === 0) {
        return mentions;
      }

      for (const username of mentionedUsernames) {
        // Éviter l'auto-mention (comparer username avec username)
        if (username === authorUsername) continue;

        try {
          const user = await tx.user.findFirst({
            where: { 
              username: username,
              is_active: true
            },
            select: { id_user: true, username: true }
          });

          if (user) {
            // Vérifier si la mention existe déjà pour éviter les doublons
            const existingMention = await tx.mention.findFirst({
              where: {
                id_user: user.id_user,
                id_post: postId
              }
            });

            if (!existingMention) {
              // ✅ CORRECTION: Structure correcte selon le schéma Prisma
              await tx.mention.create({
                data: {
                  id_user: user.id_user,
                  id_post: postId,
                  notif_view: false
                }
              });
            }
            
            mentions.push(user);
          }
        } catch (error) {
          console.warn(`Failed to process mention for user ${username}:`, error);
          // Continue avec les autres mentions
        }
      }

      return mentions;
    } catch (error) {
      console.error('Error in processMentions:', error);
      throw error; // Relancer l'erreur pour déclencher le rollback explicitement
    }
  }

  /**
   * Traiter les tags dans un post (version simplifiée pour debug)
   */
  static async processTags(postId, content, tx) {
    try {
      const tagNames = this.extractTags(content);
      const tags = [];

      if (tagNames.length === 0) {
        return tags; // ✅ CORRECTION: return au lieu de "retusrc/controllers/tagController.js"
      }

      for (const tagName of tagNames) {
        try {
          // Créer ou récupérer le tag
          let tag = await tx.tag.findFirst({
            where: { tag: tagName }
          });

          if (!tag) {
            tag = await tx.tag.create({
              data: { tag: tagName }
            });
          }

          // Vérifier si la relation post-tag existe déjà
          const existingPostTag = await tx.postTag.findFirst({
            where: {
              id_post: postId,
              id_tag: tag.id_tag
            }
          });

          if (!existingPostTag) {
            // Créer la relation post-tag (nom correct selon le schéma)
            await tx.postTag.create({
              data: {
                id_post: postId,
                id_tag: tag.id_tag
              }
            });
          }

          tags.push(tag);
        } catch (error) {
          console.warn(`Failed to process tag ${tagName}:`, error);
          // Continue avec les autres tags
        }
      }

      return tags;
    } catch (error) {
      console.error('Error in processTags:', error);
      throw error; // Relancer l'erreur pour déclencher le rollback explicitement
    }
  }

  /**
   * Créer un nouveau post (version simplifiée pour debug)
   */
  static async createPost(req, res) {
    try {
      const { error, value } = createPostSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // ✅ CORRECTION: Récupérer toutes les variables nécessaires
      const { content, id_message_type, post_parent } = value;

      // Vérifier que l'utilisateur connecté existe et est actif
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion en Int
          is_active: true
        },
        select: { id_user: true, username: true }
      });

      if (!currentUser) {
        return res.status(404).json({ error: 'Current user not found or inactive' });
      }

      // Si c'est une réponse, vérifier le post parent
      if (post_parent) {
        const parentPost = await prisma.post.findFirst({
          where: { 
            id_post: parseInt(post_parent), // ✅ CORRECTION: Conversion en Int
            active: true
          },
          select: { 
            id_post: true,
            user: { // ✅ CORRECTION: "user" au lieu de "author"
              select: { id_user: true, private: true, is_active: true }
            }
          }
        });

        if (!parentPost || !parentPost.user.is_active) {
          return res.status(404).json({ error: 'Parent post not found or author inactive' });
        }

        // Vérifier permissions pour comptes privés
        if (parentPost.user.private && parentPost.user.id_user !== parseInt(req.user.id_user)) {
          const isFollowing = await prisma.follow.findUnique({
            where: {
              follower_account: {
                follower: parseInt(req.user.id_user),
                account: parentPost.user.id_user
              }
            },
            select: { active: true, pending: true }
          });

          if (!isFollowing || !isFollowing.active || isFollowing.pending) {
            return res.status(403).json({ error: 'Cannot reply to private account post' });
          }
        }
      }

      const now = new Date();

      // VERSION SIMPLIFIÉE: Transaction SANS traitement des mentions/tags pour identifier le problème
      const result = await prisma.$transaction(async (tx) => {
        console.log('🔄 Starting transaction...');
        
        // Créer le post
        console.log('📝 Creating post with data:', {
          content,
          id_user: parseInt(req.user.id_user),
          id_message_type: id_message_type ? parseInt(id_message_type) : 1,
          post_parent: post_parent ? parseInt(post_parent) : null,
          active: true,
          created_at: now,
          updated_at: now
        });

        const post = await tx.post.create({
          data: {
            content,
            id_user: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion
            id_message_type: id_message_type ? parseInt(id_message_type) : 1, // ✅ CORRECTION: Conversion et valeur par défaut
            post_parent: post_parent ? parseInt(post_parent) : null, // ✅ CORRECTION: Ligne complète
            active: true,
            created_at: now,
            updated_at: now
          }
        });

        console.log('✅ Post created successfully:', post.id_post);

        // TEMPORAIREMENT COMMENTÉ pour isoler le problème
        // Traiter les mentions et tags
        console.log('🏷️ Processing mentions and tags...');
        const [mentions, tags] = await Promise.all([
          PostController.processMentions(post.id_post, content, currentUser.username, tx),
          PostController.processTags(post.id_post, content, tx)
        ]);

        console.log('✅ Mentions and tags processed:', { mentions: mentions.length, tags: tags.length });

        return { post, mentions, tags };
      });

      logger.info(`Post created by ${currentUser.username}: ${result.post.id_post}`);

      // ✅ CORRECTION: Récupérer le post complet avec ses relations
      const createdPost = await prisma.post.findUnique({
        where: { id_post: result.post.id_post },
        include: {
          user: {
            select: {
              id_user: true,
              username: true,
              photo_profil: true,
              private: true,
              is_active: true,
              certified: true
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          _count: {
            select: {
              likes: true,
              mentions: true,
              replies: true
            }
          }
        }
      });

      res.status(201).json({
        message: 'Post created successfully',
        post: {
          ...createdPost,
          author: createdPost.user, // ✅ MAPPING: user -> author pour compatibilité frontend
          isLikedByCurrentUser: false,
          likeCount: createdPost._count.likes,
          mentionCount: createdPost._count.mentions,
          replyCount: createdPost._count.replies,
          tags: createdPost.post_tags.map(pt => pt.tag.tag),
          mentions: result.mentions.map(m => m.username),
          // Nettoyer les propriétés internes
          _count: undefined,
          post_tags: undefined,
          user: undefined // ✅ IMPORTANT: Supprimer user car on utilise author
        }
      });
    } catch (error) {
      console.error('❌ Create post error:', error);
      logger.error('Create post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // [Autres méthodes restent inchangées...]
  
  /**
   * Obtenir la timeline publique
   */
  static async getPublicTimeline(req, res) {
    try {
      const { error, value } = getPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where: {
            active: true,
            post_parent: null,
            user: { // ✅ CORRECTION: "user" au lieu de "author"
              private: false,
              is_active: true
            }
          },
          include: {
            user: {
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                private: true,
                is_active: true
              }
            },
            post_tags: {
              include: {
                tag: true
              }
            },
            _count: {
              select: {
                likes: true,
                mentions: true,
                replies: true
              }
            }
          },
          orderBy: { created_at: 'desc' },
          skip,
          take: limit
        }),
        prisma.post.count({
          where: {
            active: true,
            post_parent: null,
            user: {
              private: false,
              is_active: true
            }
          }
        })
      ]);

      const postsWithData = posts.map(post => ({
        ...post,
        author: post.user, // ✅ MAPPING: user -> author pour compatibilité frontend
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        // Nettoyer les propriétés internes
        _count: undefined,
        post_tags: undefined,
        user: undefined // ✅ IMPORTANT: Supprimer user car on utilise author
      }));

      res.json({
        posts: postsWithData,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1
        }
      });
    } catch (error) {
      logger.error('Get public timeline error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts tendances
   */
  static async getTrendingPosts(req, res) {
    try {
      const { error, value } = getPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Posts tendances basés sur les likes des 7 derniers jours
      const posts = await prisma.post.findMany({
        where: {
          active: true,
          post_parent: null,
          user: {
            private: false,
            is_active: true
          },
          created_at: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 derniers jours
          }
        },
        include: {
          user: {
            select: {
              id_user: true,
              username: true,
              photo_profil: true,
              private: true,
              is_active: true
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          likes: req.user ? {
            where: { id_user: parseInt(req.user.id_user) },
            select: { id_user: true }
          } : false,
          _count: {
            select: {
              likes: true,
              mentions: true,
              replies: true
            }
          }
        },
        orderBy: [
          { likes: { _count: 'desc' } },
          { created_at: 'desc' }
        ],
        skip,
        take: limit
      });

      const postsWithData = posts.map(post => ({
        ...post,
        author: post.user, // ✅ MAPPING: user -> author pour compatibilité frontend
        isLikedByCurrentUser: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        // Nettoyer les propriétés internes
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined // ✅ IMPORTANT: Supprimer user car on utilise author
      }));

      res.json(postsWithData);
    } catch (error) {
      logger.error('Get trending posts error:', error);
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

      const whereClause = {
        active: true,
        post_parent: null,
        user: {
          private: false,
          is_active: true
        }
      };

      if (search) {
        whereClause.content = {
          contains: search,
          mode: 'insensitive'
        };
      }

      const orderByClause = {};
      if (sortBy === 'likes_count') {
        orderByClause.likes = { _count: order };
      } else {
        orderByClause[sortBy] = order;
      }

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where: whereClause,
          include: {
            user: {
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                private: true,
                is_active: true
              }
            },
            post_tags: {
              include: {
                tag: true
              }
            },
            likes: req.user ? {
              where: { id_user: parseInt(req.user.id_user) },
              select: { id_user: true }
            } : false,
            _count: {
              select: {
                likes: true,
                mentions: true,
                replies: true
              }
            }
          },
          orderBy: orderByClause,
          skip,
          take: limit
        }),
        prisma.post.count({
          where: whereClause
        })
      ]);

      const postsWithData = posts.map(post => ({
        ...post,
        author: post.user, // ✅ MAPPING: user -> author pour compatibilité frontend
        isLikedByCurrentUser: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        // Nettoyer les propriétés internes
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined // ✅ IMPORTANT: Supprimer user car on utilise author
      }));

      res.json({
        posts: postsWithData,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1
        },
        search: search || null
      });
    } catch (error) {
      logger.error('Search posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir la timeline personnalisée (pour utilisateur connecté)
   */
  static async getTimeline(req, res) {
    try {
      const { error, value } = getPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Récupérer les utilisateurs suivis
      const followedUsers = await prisma.follow.findMany({
        where: {
          follower: parseInt(req.user.id_user),
          active: true,
          pending: false
        },
        select: { account: true }
      });

      const followedUserIds = followedUsers.map(f => f.account);
      followedUserIds.push(parseInt(req.user.id_user)); // Inclure ses propres posts

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where: {
            active: true,
            post_parent: null,
            id_user: { in: followedUserIds },
            user: {
              is_active: true
            }
          },
          include: {
            user: {
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                private: true,
                is_active: true
              }
            },
            post_tags: {
              include: {
                tag: true
              }
            },
            likes: req.user ? {
              where: { id_user: parseInt(req.user.id_user) },
              select: { id_user: true }
            } : false,
            _count: {
              select: {
                likes: true,
                mentions: true,
                replies: true
              }
            }
          },
          orderBy: { created_at: 'desc' },
          skip,
          take: limit
        }),
        prisma.post.count({
          where: {
            active: true,
            post_parent: null,
            id_user: { in: followedUserIds },
            user: {
              is_active: true
            }
          }
        })
      ]);

      const postsWithData = posts.map(post => ({
        ...post,
        author: post.user, // ✅ MAPPING: user -> author pour compatibilité frontend
        isLikedByCurrentUser: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        // Nettoyer les propriétés internes
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined // ✅ IMPORTANT: Supprimer user car on utilise author
      }));

      res.json({
        posts: postsWithData,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1
        }
      });
    } catch (error) {
      logger.error('Get timeline error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts d'un utilisateur
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
      const targetUser = await prisma.user.findFirst({
        where: { 
          id_user: parseInt(userId),
          is_active: true
        },
        select: { 
          id_user: true, 
          username: true, 
          private: true,
          is_active: true
        }
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Vérifier les permissions pour compte privé
      let canViewPosts = !targetUser.private;

      if (targetUser.private && req.user) {
        if (targetUser.id_user === parseInt(req.user.id_user)) {
          canViewPosts = true; // Utilisateur regarde ses propres posts
        } else {
          const isFollowing = await prisma.follow.findUnique({
            where: {
              follower_account: {
                follower: parseInt(req.user.id_user),
                account: targetUser.id_user
              }
            },
            select: { active: true, pending: true }
          });

          canViewPosts = isFollowing && isFollowing.active && !isFollowing.pending;
        }
      }

      if (!canViewPosts) {
        return res.status(403).json({ error: 'Access denied to private account posts' });
      }

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where: {
            id_user: parseInt(userId),
            post_parent: null,
            active: true
          },
          include: {
            user: {
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                private: true,
                is_active: true
              }
            },
            post_tags: {
              include: {
                tag: true
              }
            },
            likes: req.user ? {
              where: { id_user: parseInt(req.user.id_user) },
              select: { id_user: true }
            } : false,
            _count: {
              select: {
                likes: true,
                mentions: true,
                replies: true
              }
            }
          },
          orderBy: { created_at: 'desc' },
          skip,
          take: limit
        }),
        prisma.post.count({
          where: {
            id_user: parseInt(userId),
            active: true
          }
        })
      ]);

      const postsWithData = posts.map(post => ({
        ...post,
        author: post.user, // ✅ MAPPING: user -> author pour compatibilité frontend
        isLikedByCurrentUser: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        // Nettoyer les propriétés internes
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined // ✅ IMPORTANT: Supprimer user car on utilise author
      }));

      res.json({
        posts: postsWithData,
        user: {
          id_user: targetUser.id_user,
          username: targetUser.username,
          private: targetUser.private
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1
        }
      });
    } catch (error) {
      logger.error('Get user posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir un post spécifique
   */
  static async getPost(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id } = req.params;

      const post = await prisma.post.findFirst({
        where: { 
          id_post: parseInt(id),
          active: true
        },
        include: {
          user: {
            select: {
              id_user: true,
              username: true,
              photo_profil: true,
              private: true,
              is_active: true
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          likes: req.user ? {
            where: { id_user: parseInt(req.user.id_user) },
            select: { id_user: true }
          } : false,
          _count: {
            select: {
              likes: true,
              mentions: true,
              replies: true
            }
          }
        }
      });

      if (!post || !post.user.is_active) {
        return res.status(404).json({ error: 'Post not found or author inactive' });
      }

      // Vérifier les permissions pour compte privé
      if (post.user.private && req.user) {
        if (post.user.id_user !== parseInt(req.user.id_user)) {
          const isFollowing = await prisma.follow.findUnique({
            where: {
              follower_account: {
                follower: parseInt(req.user.id_user),
                account: post.user.id_user
              }
            },
            select: { active: true, pending: true }
          });

          if (!isFollowing || !isFollowing.active || isFollowing.pending) {
            return res.status(403).json({ error: 'Access denied to private account post' });
          }
        }
      } else if (post.user.private && !req.user) {
        return res.status(403).json({ error: 'Access denied to private account post' });
      }

      const postWithData = {
        ...post,
        author: post.user, // ✅ MAPPING: user -> author pour compatibilité frontend
        isLikedByCurrentUser: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        // Nettoyer les propriétés internes
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined // ✅ IMPORTANT: Supprimer user car on utilise author
      };

      res.json(postWithData);
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
      res.status(501).json({ error: 'Method not implemented in debug version' });
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
      res.status(501).json({ error: 'Method not implemented in debug version' });
    } catch (error) {
      logger.error('Delete post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = PostController;
