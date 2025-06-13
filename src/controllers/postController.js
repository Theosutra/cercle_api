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
   * Traiter les mentions dans un post
   */
  static async processMentions(postId, content, authorId, tx) {
    const mentionedUsernames = this.extractMentions(content);
    const mentions = [];

    if (mentionedUsernames.length === 0) {
      return mentions;
    }

    for (const username of mentionedUsernames) {
      // Éviter l'auto-mention
      if (username === authorId) continue;

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
  }

  /**
   * Traiter les tags dans un post
   */
  static async processTags(postId, content, tx) {
    const tagNames = this.extractTags(content);
    const tags = [];

    if (tagNames.length === 0) {
      return tags;
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
  }

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
            user: { // ✅ CORRECTION: "user" au lieu de "author"
              private: false,
              is_active: true
            }
          },
          include: {
            user: { // ✅ CORRECTION: "user" au lieu de "author"
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                certified: true
              }
            },
            _count: {
              select: {
                likes: { where: { active: true } }, // ✅ CORRECTION: Simplifié
                mentions: true,
                replies: { 
                  where: { 
                    active: true,
                    user: { is_active: true } // ✅ CORRECTION: "user" dans replies
                  } 
                }
              }
            },
            post_tags: {
              include: {
                tag: true
              }
            },
            ...(req.user && {
              likes: {
                where: { 
                  id_user: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion en Int
                  active: true
                },
                select: { id_user: true }
              }
            })
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.post.count({
          where: {
            active: true,
            user: { // ✅ CORRECTION: "user" au lieu de "author"
              private: false,
              is_active: true
            }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      const postsWithData = posts.map(post => ({
        ...post,
        author: post.user, // ✅ MAPPING: user -> author pour compatibilité frontend
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined // ✅ NETTOYAGE: Supprimer user pour éviter duplication
      }));

      res.json({
        posts: postsWithData,
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
      logger.error('Get public timeline error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir la timeline personnelle (amis + posts personnels)
   */
  static async getPersonalTimeline(req, res) {
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
          follower: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion en Int
          active: true,
          pending: false
        },
        select: { account: true }
      });

      const followedUserIds = followedUsers.map(f => f.account);
      followedUserIds.push(parseInt(req.user.id_user)); // ✅ Ajouter ses propres posts

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where: {
            id_user: { in: followedUserIds },
            active: true,
            user: { is_active: true } // ✅ CORRECTION: "user" au lieu de "author"
          },
          include: {
            user: { // ✅ CORRECTION: "user" au lieu de "author"
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                certified: true
              }
            },
            _count: {
              select: {
                likes: { where: { active: true } },
                mentions: true,
                replies: { 
                  where: { 
                    active: true,
                    user: { is_active: true }
                  } 
                }
              }
            },
            post_tags: {
              include: {
                tag: true
              }
            },
            likes: {
              where: { 
                id_user: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion
                active: true
              },
              select: { id_user: true }
            }
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.post.count({
          where: {
            id_user: { in: followedUserIds },
            active: true,
            user: { is_active: true } // ✅ CORRECTION: "user" au lieu de "author"
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      const postsWithData = posts.map(post => ({
        ...post,
        author: post.user, // ✅ MAPPING: user -> author
        isLiked: post.likes?.length > 0,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined
      }));

      res.json({
        posts: postsWithData,
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
      logger.error('Get personal timeline error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts tendances (populaires)
   */
  static async getTrendingPosts(req, res) {
    try {
      const { error, value } = getPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Posts des dernières 24h triés par score composite
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const posts = await prisma.post.findMany({
        where: {
          active: true,
          created_at: { gte: yesterday },
          user: { // ✅ CORRECTION: "user" au lieu de "author"
            is_active: true,
            private: false 
          }
        },
        include: {
          user: { // ✅ CORRECTION: "user" au lieu de "author"
            select: {
              id_user: true,
              username: true,
              photo_profil: true,
              certified: true
            }
          },
          _count: {
            select: {
              likes: { where: { active: true } },
              mentions: true,
              replies: { 
                where: { 
                  active: true, 
                  user: { is_active: true } 
                } 
              }
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          ...(req.user && {
            likes: {
              where: { 
                id_user: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion
                active: true 
              },
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

      const postsWithData = posts.map(post => ({
        ...post,
        author: post.user, // ✅ MAPPING: user -> author
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined
      }));

      res.json({
        posts: postsWithData,
        pagination: {
          page,
          limit,
          total: postsWithData.length,
          hasNext: postsWithData.length === limit,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get trending posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Créer un nouveau post
   */
  static async createPost(req, res) {
    try {
      const { error, value } = createPostSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { content, post_parent, id_message_type } = value;

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

      // Transaction pour créer le post et traiter mentions/tags
      const result = await prisma.$transaction(async (tx) => {
        // Créer le post
        const post = await tx.post.create({
          data: {
            content,
            id_user: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion
            id_message_type: id_message_type || 1, // 1 = post par défaut
            post_parent: post_parent ? parseInt(post_parent) : null,
            active: true,
            created_at: now,
            updated_at: now
          }
        });

        // Traiter les mentions et tags
        const [mentions, tags] = await Promise.all([
          this.processMentions(post.id_post, content, parseInt(req.user.id_user), tx),
          this.processTags(post.id_post, content, tx)
        ]);

        return { post, mentions, tags };
      });

      // Récupérer le post complet avec ses relations
      const createdPost = await prisma.post.findUnique({
        where: { id_post: result.post.id_post },
        include: {
          user: { // ✅ CORRECTION: "user" au lieu de "author"
            select: {
              id_user: true,
              username: true,
              photo_profil: true,
              certified: true
            }
          },
          _count: {
            select: {
              likes: { where: { active: true } },
              mentions: true
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          }
        }
      });

      logger.info(`New post created by ${currentUser.username}: ${result.post.id_post} with ${result.mentions.length} mentions and ${result.tags.length} tags`);

      res.status(201).json({
        message: 'Post created successfully',
        post: {
          ...createdPost,
          author: createdPost.user, // ✅ MAPPING: user -> author
          isLiked: false,
          likeCount: createdPost._count.likes,
          mentionCount: createdPost._count.mentions,
          tags: createdPost.post_tags.map(pt => pt.tag.tag),
          mentions: result.mentions.map(m => m.username),
          _count: undefined,
          post_tags: undefined,
          user: undefined
        }
      });
    } catch (error) {
      logger.error('Create post error:', error);
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
      const { content } = value;

      // Vérifier que le post existe et appartient à l'utilisateur
      const existingPost = await prisma.post.findFirst({
        where: { 
          id_post: parseInt(id), // ✅ CORRECTION: Conversion en Int
          active: true
        },
        select: { id_post: true, id_user: true }
      });

      if (!existingPost) {
        return res.status(404).json({ error: 'Post not found' });
      }

      if (existingPost.id_user !== parseInt(req.user.id_user)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const now = new Date();

      // Transaction pour mettre à jour le post et re-traiter mentions/tags
      const result = await prisma.$transaction(async (tx) => {
        // Mettre à jour le post
        const post = await tx.post.update({
          where: { id_post: parseInt(id) },
          data: {
            content,
            updated_at: now
          }
        });

        // Supprimer les anciennes mentions et tags
        await Promise.all([
          tx.mention.deleteMany({
            where: { id_post: parseInt(id) }
          }),
          tx.postTag.deleteMany({
            where: { id_post: parseInt(id) }
          })
        ]);

        // Re-traiter les mentions et tags
        const [mentions, tags] = await Promise.all([
          this.processMentions(post.id_post, content, parseInt(req.user.id_user), tx),
          this.processTags(post.id_post, content, tx)
        ]);

        return { post, mentions, tags };
      });

      // Récupérer le post mis à jour avec ses relations
      const updatedPost = await prisma.post.findUnique({
        where: { id_post: result.post.id_post },
        include: {
          user: { // ✅ CORRECTION: "user" au lieu de "author"
            select: {
              id_user: true,
              username: true,
              photo_profil: true,
              certified: true
            }
          },
          _count: {
            select: {
              likes: { where: { active: true } },
              mentions: true
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          }
        }
      });

      res.json({
        message: 'Post updated successfully',
        post: {
          ...updatedPost,
          author: updatedPost.user, // ✅ MAPPING: user -> author
          isLiked: false, // Sera recalculé par le frontend
          likeCount: updatedPost._count.likes,
          mentionCount: updatedPost._count.mentions,
          tags: updatedPost.post_tags.map(pt => pt.tag.tag),
          mentions: result.mentions.map(m => m.username),
          _count: undefined,
          post_tags: undefined,
          user: undefined
        }
      });
    } catch (error) {
      logger.error('Update post error:', error);
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
          id_post: parseInt(id), // ✅ CORRECTION: Conversion en Int
          active: true
        },
        include: {
          user: { // ✅ CORRECTION: "user" au lieu de "author"
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
              likes: { where: { active: true } },
              mentions: true,
              replies: { 
                where: { 
                  active: true, 
                  user: { is_active: true } 
                } 
              }
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          ...(req.user && {
            likes: {
              where: { 
                id_user: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion
                active: true 
              },
              select: { id_user: true }
            }
          })
        }
      });

      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Vérifier permissions pour comptes privés
      if (post.user.private && req.user && post.user.id_user !== parseInt(req.user.id_user)) {
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
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const postWithData = {
        ...post,
        author: post.user, // ✅ MAPPING: user -> author
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined
      };

      res.json(postWithData);
    } catch (error) {
      logger.error('Get post error:', error);
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
      const existingPost = await prisma.post.findFirst({
        where: { 
          id_post: parseInt(id), // ✅ CORRECTION: Conversion en Int
          active: true
        },
        select: { id_post: true, id_user: true }
      });

      if (!existingPost) {
        return res.status(404).json({ error: 'Post not found' });
      }

      if (existingPost.id_user !== parseInt(req.user.id_user)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Soft delete du post et de ses réponses
      await prisma.$transaction(async (tx) => {
        // Supprimer le post principal
        await tx.post.update({
          where: { id_post: parseInt(id) },
          data: { 
            active: false,
            updated_at: new Date()
          }
        });

        // Supprimer aussi toutes les réponses
        await tx.post.updateMany({
          where: { 
            post_parent: parseInt(id),
            active: true
          },
          data: { 
            active: false,
            updated_at: new Date()
          }
        });
      });

      res.json({ message: 'Post deleted successfully' });
    } catch (error) {
      logger.error('Delete post error:', error);
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

      // Construction de la clause WHERE
      const whereClause = {
        active: true,
        user: { // ✅ CORRECTION: "user" au lieu de "author"
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

      // Construction de l'ordre de tri
      const orderBy = {};
      if (sortBy === 'likes_count') {
        orderBy.likes = { _count: order };
      } else {
        orderBy[sortBy] = order;
      }

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where: whereClause,
          include: {
            user: { // ✅ CORRECTION: "user" au lieu de "author"
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                certified: true
              }
            },
            _count: {
              select: {
                likes: { where: { active: true } },
                mentions: true,
                replies: { 
                  where: { 
                    active: true, 
                    user: { is_active: true } 
                  } 
                }
              }
            },
            post_tags: {
              include: {
                tag: true
              }
            },
            ...(req.user && {
              likes: {
                where: { 
                  id_user: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion
                  active: true 
                },
                select: { id_user: true }
              }
            })
          },
          skip,
          take: limit,
          orderBy
        }),
        prisma.post.count({
          where: whereClause
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      const postsWithData = posts.map(post => ({
        ...post,
        author: post.user, // ✅ MAPPING: user -> author
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined
      }));

      res.json({
        posts: postsWithData,
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
   * Obtenir les posts d'un utilisateur spécifique
   */
  static async getUserPosts(req, res) {
    try {
      const { error: paramsError } = userPostsParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = getPostsSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { userId } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Vérifier que l'utilisateur existe
      const targetUser = await prisma.user.findFirst({
        where: { 
          id_user: parseInt(userId), // ✅ CORRECTION: Conversion en Int
          is_active: true
        },
        select: { 
          id_user: true, 
          username: true, 
          private: true 
        }
      });

      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Vérifier permissions pour comptes privés
      if (targetUser.private && req.user && targetUser.id_user !== parseInt(req.user.id_user)) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: parseInt(req.user.id_user),
              account: targetUser.id_user
            }
          },
          select: { active: true, pending: true }
        });

        if (!isFollowing || !isFollowing.active || isFollowing.pending) {
          return res.status(403).json({ error: 'Access denied to private account' });
        }
      }

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where: {
            id_user: parseInt(userId),
            active: true
          },
          include: {
            user: { // ✅ CORRECTION: "user" au lieu de "author"
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                certified: true
              }
            },
            _count: {
              select: {
                likes: { where: { active: true } },
                mentions: true,
                replies: { 
                  where: { 
                    active: true, 
                    user: { is_active: true } 
                  } 
                }
              }
            },
            post_tags: {
              include: {
                tag: true
              }
            },
            ...(req.user && {
              likes: {
                where: { 
                  id_user: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion
                  active: true 
                },
                select: { id_user: true }
              }
            })
          },
          skip,
          take: limit,
          orderBy: { created_at: 'desc' }
        }),
        prisma.post.count({
          where: {
            id_user: parseInt(userId),
            active: true
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      const postsWithData = posts.map(post => ({
        ...post,
        author: post.user, // ✅ MAPPING: user -> author
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined
      }));

      res.json({
        posts: postsWithData,
        user: {
          id_user: targetUser.id_user,
          username: targetUser.username
        },
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
      logger.error('Get user posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les réponses d'un post
   */
  static async getPostReplies(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = getPostsSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { id: postId } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Vérifier que le post parent existe et est accessible
      const parentPost = await prisma.post.findFirst({
        where: { 
          id_post: parseInt(postId), // ✅ CORRECTION: Conversion en Int
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
        return res.status(404).json({ error: 'Post not found or author inactive' });
      }

      // Vérifier permissions pour comptes privés
      if (parentPost.user.private && req.user && parentPost.user.id_user !== parseInt(req.user.id_user)) {
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
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const [replies, total] = await Promise.all([
        prisma.post.findMany({
          where: {
            post_parent: parseInt(postId),
            active: true,
            user: { is_active: true } // ✅ CORRECTION: "user" au lieu de "author"
          },
          include: {
            user: { // ✅ CORRECTION: "user" au lieu de "author"
              select: {
                id_user: true,
                username: true,
                photo_profil: true,
                certified: true
              }
            },
            _count: {
              select: {
                likes: { where: { active: true } },
                mentions: true,
                replies: { 
                  where: { 
                    active: true, 
                    user: { is_active: true } 
                  } 
                }
              }
            },
            post_tags: {
              include: {
                tag: true
              }
            },
            ...(req.user && {
              likes: {
                where: { 
                  id_user: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion
                  active: true
                },
                select: { id_user: true }
              }
            })
          },
          skip,
          take: limit,
          orderBy: { created_at: 'asc' } // Chronologique pour les réponses
        }),
        prisma.post.count({
          where: {
            post_parent: parseInt(postId),
            active: true,
            user: { is_active: true } // ✅ CORRECTION: "user" au lieu de "author"
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      const repliesWithData = replies.map(reply => ({
        ...reply,
        author: reply.user, // ✅ MAPPING: user -> author
        isLiked: req.user ? reply.likes?.length > 0 : false,
        likeCount: reply._count.likes,
        mentionCount: reply._count.mentions,
        replyCount: reply._count.replies,
        tags: reply.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined
      }));

      res.json({
        replies: repliesWithData,
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
      logger.error('Get post replies error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts par type de message
   */
  static async getPostsByType(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = getPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { type } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Récupérer le type de message
      const messageType = await prisma.messageType.findFirst({
        where: { message_type: type }
      });

      if (!messageType) {
        return res.status(400).json({ error: 'Invalid post type' });
      }

      const posts = await prisma.post.findMany({
        where: {
          id_message_type: messageType.id_message_type,
          active: true,
          user: { // ✅ CORRECTION: "user" au lieu de "author"
            is_active: true,
            private: false
          }
        },
        include: {
          user: { // ✅ CORRECTION: "user" au lieu de "author"
            select: {
              id_user: true,
              username: true,
              photo_profil: true,
              certified: true
            }
          },
          _count: {
            select: {
              likes: { where: { active: true } },
              mentions: true,
              replies: { 
                where: { 
                  active: true, 
                  user: { is_active: true } 
                } 
              }
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          ...(req.user && {
            likes: {
              where: { 
                id_user: parseInt(req.user.id_user), // ✅ CORRECTION: Conversion
                active: true 
              },
              select: { id_user: true }
            }
          })
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      });

      const postsWithData = posts.map(post => ({
        ...post,
        author: post.user, // ✅ MAPPING: user -> author
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined,
        user: undefined
      }));

      res.json(postsWithData);
    } catch (error) {
      logger.error('Get posts by type error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Répondre à un post
   */
  static async replyToPost(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = createPostSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { id: parentPostId } = req.params;
      const { content } = value;

      // Récupérer le type de message "reply"
      const replyType = await prisma.messageType.findFirst({
        where: { message_type: 'reply' }
      });

      if (!replyType) {
        return res.status(500).json({ error: 'Reply message type not configured' });
      }

      // Créer la réponse en utilisant createPost avec post_parent
      req.body.post_parent = parseInt(parentPostId); // ✅ CORRECTION: Conversion
      req.body.id_message_type = replyType.id_message_type;

      // Réutiliser la logique de createPost
      return this.createPost(req, res);
    } catch (error) {
      logger.error('Reply to post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir l'activité détaillée d'un post (analytics)
   */
  static async getPostActivity(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: postId } = req.params;

      // Vérifier que le post existe et appartient à l'utilisateur
      const post = await prisma.post.findFirst({
        where: { 
          id_post: parseInt(postId), // ✅ CORRECTION: Conversion en Int
          active: true
        },
        select: { id_post: true, id_user: true, created_at: true }
      });

      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }

      if (post.id_user !== parseInt(req.user.id_user)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Récupérer l'activité détaillée
      const [likes, mentions, replies, hourlyActivity] = await Promise.all([
        // Likes avec timeline
        prisma.like.findMany({
          where: { 
            id_post: parseInt(postId),
            active: true,
            user: { is_active: true } // ✅ CORRECTION: "user" au lieu de référence incorrecte
          },
          include: {
            user: {
              select: { username: true, photo_profil: true }
            }
          },
          orderBy: { created_at: 'desc' },
          take: 50 // Derniers 50 likes
        }),

        // Mentions
        prisma.mention.findMany({
          where: { id_post: parseInt(postId) },
          include: {
            user: {
              select: { username: true, photo_profil: true }
            }
          }
        }),

        // Réponses
        prisma.post.findMany({
          where: {
            post_parent: parseInt(postId),
            active: true,
            user: { is_active: true } // ✅ CORRECTION: "user" au lieu de "author"
          },
          include: {
            user: { // ✅ CORRECTION: "user" au lieu de "author"
              select: { username: true, photo_profil: true }
            }
          },
          orderBy: { created_at: 'desc' }
        }),

        // Activité par heure (dernières 24h)
        prisma.$queryRaw`
          SELECT 
            DATE_TRUNC('hour', created_at) as hour,
            COUNT(*) as activity_count
          FROM cercle.likes 
          WHERE id_post = ${parseInt(postId)} 
            AND active = true
            AND created_at >= NOW() - INTERVAL '24 hours'
          GROUP BY DATE_TRUNC('hour', created_at)
          ORDER BY hour DESC
        `
      ]);

      res.json({
        post: {
          id_post: post.id_post,
          created_at: post.created_at
        },
        activity: {
          likes: {
            count: likes.length,
            recent: likes.slice(0, 10),
            timeline: likes.map(like => ({
              user: like.user.username,
              created_at: like.created_at
            }))
          },
          mentions: {
            count: mentions.length,
            users: mentions.map(mention => mention.user.username)
          },
          replies: {
            count: replies.length,
            recent: replies.slice(0, 5).map(reply => ({
              author: reply.user.username, // ✅ CORRECTION: user.username
              content: reply.content.substring(0, 100),
              created_at: reply.created_at
            }))
          },
          hourlyActivity: hourlyActivity.map(activity => ({
            hour: activity.hour,
            count: parseInt(activity.activity_count)
          }))
        }
      });
    } catch (error) {
      logger.error('Get post activity error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Alias pour getPersonalTimeline (compatibilité)
   */
  static async getTimeline(req, res) {
    return this.getPersonalTimeline(req, res);
  }

  /**
   * Alias pour getPublicTimeline (compatibilité)
   */
  static async getPublicPosts(req, res) {
    return this.getPublicTimeline(req, res);
  }
}

module.exports = PostController;