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
    return matches ? matches.map(t => t.substring(1).toLowerCase()) : [];
  }

  /**
   * Traiter les mentions pour un post
   */
  static async processMentions(postId, content, currentUserId, transaction = prisma) {
    const mentionedUsernames = this.extractMentions(content);
    
    if (mentionedUsernames.length === 0) return [];

    // Récupérer les utilisateurs mentionnés (actifs uniquement)
    const mentionedUsers = await transaction.user.findMany({
      where: {
        username: { in: mentionedUsernames },
        is_active: true
      },
      select: { id_user: true, username: true }
    });

    // Créer les mentions (exclure l'auteur du post)
    const mentionsToCreate = mentionedUsers
      .filter(user => user.id_user !== currentUserId)
      .map(user => ({
        id_user: user.id_user,
        id_post: postId,
        notif_view: false
      }));

    if (mentionsToCreate.length > 0) {
      await transaction.mention.createMany({
        data: mentionsToCreate,
        skipDuplicates: true
      });
    }

    return mentionedUsers;
  }

  /**
   * Traiter les tags pour un post
   */
  static async processTags(postId, content, transaction = prisma) {
    const tagNames = this.extractTags(content);
    
    if (tagNames.length === 0) return [];

    const processedTags = [];

    for (const tagName of tagNames) {
      // Créer le tag s'il n'existe pas
      const tag = await transaction.tag.upsert({
        where: { tag: tagName },
        update: {},
        create: { tag: tagName },
        select: { id_tag: true, tag: true }
      });

      // Associer le tag au post
      await transaction.postTag.upsert({
        where: {
          id_post_id_tag: {
            id_post: postId,
            id_tag: tag.id_tag
          }
        },
        update: {},
        create: {
          id_post: postId,
          id_tag: tag.id_tag
        }
      });

      processedTags.push(tag);
    }

    return processedTags;
  }

  /**
   * Créer un nouveau post avec extraction automatique mentions/tags
   */
  static async createPost(req, res) {
    try {
      const { error, value } = createPostSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { content, id_message_type, post_parent } = value;

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

      // Si c'est une réponse, vérifier le post parent
      if (post_parent) {
        const parentPost = await prisma.post.findFirst({
          where: { 
            id_post: post_parent,
            active: true
          },
          select: { 
            id_post: true,
            author: {
              select: { id_user: true, private: true, is_active: true }
            }
          }
        });

        if (!parentPost || !parentPost.author.is_active) {
          return res.status(404).json({ error: 'Parent post not found or author inactive' });
        }

        // Vérifier permissions pour comptes privés
        if (parentPost.author.private && parentPost.author.id_user !== req.user.id_user) {
          const isFollowing = await prisma.follow.findUnique({
            where: {
              follower_account: {
                follower: req.user.id_user,
                account: parentPost.author.id_user
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
            id_user: req.user.id_user,
            id_message_type: id_message_type || 1, // 1 = post par défaut
            post_parent: post_parent || null,
            active: true,
            created_at: now,
            updated_at: now
          }
        });

        // Traiter les mentions et tags
        const [mentions, tags] = await Promise.all([
          this.processMentions(post.id_post, content, req.user.id_user, tx),
          this.processTags(post.id_post, content, tx)
        ]);

        return { post, mentions, tags };
      });

      // Récupérer le post complet avec ses relations
      const createdPost = await prisma.post.findUnique({
        where: { id_post: result.post.id_post },
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
              likes: { where: { active: true, user: { is_active: true } } },
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
          isLiked: false,
          likeCount: createdPost._count.likes,
          mentionCount: createdPost._count.mentions,
          tags: createdPost.post_tags.map(pt => pt.tag.tag),
          mentions: result.mentions.map(m => m.username),
          _count: undefined,
          post_tags: undefined
        }
      });
    } catch (error) {
      logger.error('Create post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Mettre à jour un post avec re-extraction mentions/tags
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
          id_post: id,
          active: true
        },
        select: { id_post: true, id_user: true, content: true }
      });

      if (!existingPost) {
        return res.status(404).json({ error: 'Post not found' });
      }

      if (existingPost.id_user !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const now = new Date();

      // Transaction pour mettre à jour le post et re-traiter mentions/tags
      const result = await prisma.$transaction(async (tx) => {
        // Mettre à jour le post
        const updatedPost = await tx.post.update({
          where: { id_post: id },
          data: { 
            content,
            updated_at: now
          }
        });

        // Supprimer anciennes mentions et tags
        await Promise.all([
          tx.mention.deleteMany({
            where: { id_post: id }
          }),
          tx.postTag.deleteMany({
            where: { id_post: id }
          })
        ]);

        // Re-traiter les mentions et tags
        const [mentions, tags] = await Promise.all([
          this.processMentions(id, content, req.user.id_user, tx),
          this.processTags(id, content, tx)
        ]);

        return { updatedPost, mentions, tags };
      });

      // Récupérer le post mis à jour avec ses relations
      const finalPost = await prisma.post.findUnique({
        where: { id_post: id },
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
              likes: { where: { active: true, user: { is_active: true } } },
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

      logger.info(`Post updated by ${req.user.username}: ${id} with ${result.mentions.length} mentions and ${result.tags.length} tags`);

      res.json({
        message: 'Post updated successfully',
        post: {
          ...finalPost,
          likeCount: finalPost._count.likes,
          mentionCount: finalPost._count.mentions,
          tags: finalPost.post_tags.map(pt => pt.tag.tag),
          mentions: result.mentions.map(m => m.username),
          _count: undefined,
          post_tags: undefined
        }
      });
    } catch (error) {
      logger.error('Update post error:', error);
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
      req.body.post_parent = parentPostId;
      req.body.id_message_type = replyType.id_message_type;

      // Réutiliser la logique de createPost
      return this.createPost(req, res);
    } catch (error) {
      logger.error('Reply to post error:', error);
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
          id_post: postId,
          active: true
        },
        select: { 
          id_post: true,
          author: {
            select: { id_user: true, private: true, is_active: true }
          }
        }
      });

      if (!parentPost || !parentPost.author.is_active) {
        return res.status(404).json({ error: 'Post not found or author inactive' });
      }

      // Vérifier permissions pour comptes privés
      if (parentPost.author.private && req.user && parentPost.author.id_user !== req.user.id_user) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: parentPost.author.id_user
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
            post_parent: postId,
            active: true,
            author: { is_active: true }
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
                likes: { where: { active: true, user: { is_active: true } } },
                mentions: true,
                replies: { where: { active: true, author: { is_active: true } } }
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
                  id_user: req.user.id_user,
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
            post_parent: postId,
            active: true,
            author: { is_active: true }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      const repliesWithData = replies.map(reply => ({
        ...reply,
        isLiked: req.user ? reply.likes?.length > 0 : false,
        likeCount: reply._count.likes,
        mentionCount: reply._count.mentions,
        replyCount: reply._count.replies,
        tags: reply.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined
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

      const posts = await prisma.post.findMany({
        where: {
          AND: [
            { active: true },
            {
              OR: [
                { id_user: req.user.id_user },
                {
                  author: {
                    followers: {
                      some: { 
                        follower: req.user.id_user,
                        active: true,
                        pending: false
                      }
                    },
                    is_active: true
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
              likes: { where: { active: true, user: { is_active: true } } },
              mentions: true,
              replies: { where: { active: true, author: { is_active: true } } }
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          likes: {
            where: { id_user: req.user.id_user, active: true },
            select: { id_user: true }
          }
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      });

      const postsWithData = posts.map(post => ({
        ...post,
        isLiked: post.likes.length > 0,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined
      }));

      res.json(postsWithData);
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
              likes: { where: { active: true, user: { is_active: true } } },
              mentions: true,
              replies: { where: { active: true, author: { is_active: true } } }
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          ...(req.user && {
            likes: {
              where: { id_user: req.user.id_user, active: true },
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
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined
      }));

      res.json(postsWithData);
    } catch (error) {
      logger.error('Get public timeline error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir un post spécifique par son ID avec contexte
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
          id_post: id,
          active: true
        },
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
          parent_post: {
            select: {
              id_post: true,
              content: true,
              author: {
                select: {
                  username: true,
                  photo_profil: true
                }
              }
            }
          },
          _count: {
            select: {
              likes: { where: { active: true, user: { is_active: true } } },
              mentions: true,
              replies: { where: { active: true, author: { is_active: true } } }
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          ...(req.user && {
            likes: {
              where: { id_user: req.user.id_user, active: true },
              select: { id_user: true }
            }
          })
        }
      });

      if (!post) {
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

      const postWithData = {
        ...post,
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined
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
          id_post: id,
          active: true
        },
        select: { id_post: true, id_user: true }
      });

      if (!existingPost) {
        return res.status(404).json({ error: 'Post not found' });
      }

      if (existingPost.id_user !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Soft delete du post et de ses réponses
      await prisma.$transaction(async (tx) => {
        // Supprimer le post principal
        await tx.post.update({
          where: { id_post: id },
          data: { 
            active: false,
            updated_at: new Date()
          }
        });

        // Supprimer les réponses au post
        await tx.post.updateMany({
          where: { 
            post_parent: id,
            active: true
          },
          data: { 
            active: false,
            updated_at: new Date()
          }
        });
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

      // Vérifier que l'utilisateur existe et est actif
      const user = await prisma.user.findFirst({
        where: { 
          id_user: userId,
          is_active: true
        },
        select: { private: true, is_active: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
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
              likes: { where: { active: true, user: { is_active: true } } },
              mentions: true,
              replies: { where: { active: true, author: { is_active: true } } }
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          ...(req.user && {
            likes: {
              where: { id_user: req.user.id_user, active: true },
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
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined
      }));

      res.json(postsWithData);
    } catch (error) {
      logger.error('Get user posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Rechercher des posts avec filtres avancés
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
          { author: { is_active: true, private: false } },
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
                likes: { where: { active: true, user: { is_active: true } } },
                mentions: true,
                replies: { where: { active: true, author: { is_active: true } } }
              }
            },
            post_tags: {
              include: {
                tag: true
              }
            },
            ...(req.user && {
              likes: {
                where: { id_user: req.user.id_user, active: true },
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

      const postsWithData = posts.map(post => ({
        ...post,
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined
      }));

      const totalPages = Math.ceil(total / limit);

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

      // Posts des dernières 24h triés par score composite
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
              likes: { where: { active: true, user: { is_active: true } } },
              mentions: true,
              replies: { where: { active: true, author: { is_active: true } } }
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          ...(req.user && {
            likes: {
              where: { id_user: req.user.id_user, active: true },
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
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        // Score composite pour le tri (likes * 2 + réponses + mentions)
        trendingScore: (post._count.likes * 2) + post._count.replies + post._count.mentions,
        likes: undefined,
        _count: undefined,
        post_tags: undefined
      }));

      res.json(postsWithData);
    } catch (error) {
      logger.error('Get trending posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts où l'utilisateur est mentionné
   */
  static async getMentionedPosts(req, res) {
    try {
      const { error, value } = getPostsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier que l'utilisateur connecté existe et est actif
      const currentUser = await prisma.user.findFirst({
        where: { 
          id_user: req.user.id_user,
          is_active: true
        },
        select: { id_user: true }
      });

      if (!currentUser) {
        return res.status(404).json({ error: 'Current user not found or inactive' });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const [mentions, total] = await Promise.all([
        prisma.mention.findMany({
          where: {
            id_user: req.user.id_user,
            post: {
              active: true,
              author: { is_active: true }
            }
          },
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
                    likes: { where: { active: true, user: { is_active: true } } },
                    mentions: true,
                    replies: { where: { active: true, author: { is_active: true } } }
                  }
                },
                post_tags: {
                  include: {
                    tag: true
                  }
                },
                likes: {
                  where: { id_user: req.user.id_user, active: true },
                  select: { id_user: true }
                }
              }
            }
          },
          skip,
          take: limit,
          orderBy: { post: { created_at: 'desc' } }
        }),
        prisma.mention.count({
          where: {
            id_user: req.user.id_user,
            post: {
              active: true,
              author: { is_active: true }
            }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

      const postsWithMentions = mentions.map(mention => ({
        ...mention.post,
        isLiked: mention.post.likes.length > 0,
        likeCount: mention.post._count.likes,
        mentionCount: mention.post._count.mentions,
        replyCount: mention.post._count.replies,
        tags: mention.post.post_tags.map(pt => pt.tag.tag),
        mentionViewed: mention.notif_view,
        mentionId: `${mention.id_user}_${mention.id_post}`,
        likes: undefined,
        _count: undefined,
        post_tags: undefined
      }));

      res.json({
        posts: postsWithMentions,
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
      logger.error('Get mentioned posts error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les posts par type (post, reply, repost)
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
              likes: { where: { active: true, user: { is_active: true } } },
              mentions: true,
              replies: { where: { active: true, author: { is_active: true } } }
            }
          },
          post_tags: {
            include: {
              tag: true
            }
          },
          ...(req.user && {
            likes: {
              where: { id_user: req.user.id_user, active: true },
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
        isLiked: req.user ? post.likes?.length > 0 : false,
        likeCount: post._count.likes,
        mentionCount: post._count.mentions,
        replyCount: post._count.replies,
        tags: post.post_tags.map(pt => pt.tag.tag),
        likes: undefined,
        _count: undefined,
        post_tags: undefined
      }));

      res.json(postsWithData);
    } catch (error) {
      logger.error('Get posts by type error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir le thread complet d'une conversation
   */
  static async getPostThread(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: postId } = req.params;

      // Fonction récursive pour construire le thread
      const buildThread = async (currentPostId, visited = new Set()) => {
        if (visited.has(currentPostId)) return null; // Éviter les boucles
        visited.add(currentPostId);

        const post = await prisma.post.findFirst({
          where: { 
            id_post: currentPostId,
            active: true
          },
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
                likes: { where: { active: true, user: { is_active: true } } },
                mentions: true,
                replies: { where: { active: true, author: { is_active: true } } }
              }
            },
            post_tags: {
              include: {
                tag: true
              }
            },
            ...(req.user && {
              likes: {
                where: { id_user: req.user.id_user, active: true },
                select: { id_user: true }
              }
            })
          }
        });

        if (!post) return null;

        // Vérifier permissions pour comptes privés
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
            return null; // Ignorer ce post dans le thread
          }
        }

        // Récupérer les réponses directes
        const replies = await prisma.post.findMany({
          where: {
            post_parent: currentPostId,
            active: true,
            author: { is_active: true }
          },
          select: { id_post: true },
          orderBy: { created_at: 'asc' }
        });

        const repliesData = [];
        for (const reply of replies) {
          const replyThread = await buildThread(reply.id_post, new Set([...visited]));
          if (replyThread) repliesData.push(replyThread);
        }

        return {
          ...post,
          isLiked: req.user ? post.likes?.length > 0 : false,
          likeCount: post._count.likes,
          mentionCount: post._count.mentions,
          replyCount: post._count.replies,
          tags: post.post_tags.map(pt => pt.tag.tag),
          replies: repliesData,
          likes: undefined,
          _count: undefined,
          post_tags: undefined
        };
      };

      // Construire le thread à partir du post demandé
      const thread = await buildThread(postId);

      if (!thread) {
        return res.status(404).json({ error: 'Post not found or access denied' });
      }

      res.json({ thread });
    } catch (error) {
      logger.error('Get post thread error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir l'activité détaillée d'un post (propriétaire uniquement)
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
          id_post: postId,
          active: true
        },
        select: { id_post: true, id_user: true, created_at: true }
      });

      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }

      if (post.id_user !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Récupérer l'activité détaillée
      const [likes, mentions, replies, hourlyActivity] = await Promise.all([
        // Likes avec timeline
        prisma.like.findMany({
          where: { 
            id_post: postId,
            active: true,
            user: { is_active: true }
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
          where: { id_post: postId },
          include: {
            user: {
              select: { username: true, photo_profil: true }
            }
          }
        }),

        // Réponses
        prisma.post.findMany({
          where: {
            post_parent: postId,
            active: true,
            author: { is_active: true }
          },
          include: {
            author: {
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
          WHERE id_post = ${postId} 
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
              author: reply.author.username,
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
}

module.exports = PostController;
