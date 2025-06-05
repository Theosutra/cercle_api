const prisma = require('../utils/database');
const logger = require('../utils/logger');
const Joi = require('joi');
const { paginationSchema } = require('../validators/userValidator');

// Schémas de validation pour les tags
const createTagSchema = Joi.object({
  tag: Joi.string().min(1).max(50).pattern(/^[a-zA-Z0-9_]+$/).required().messages({
    'string.min': 'Tag must be at least 1 character long',
    'string.max': 'Tag must not exceed 50 characters',
    'string.pattern.base': 'Tag can only contain letters, numbers and underscores',
    'any.required': 'Tag is required'
  })
});

const tagParamsSchema = Joi.object({
  tag: Joi.string().required().messages({
    'any.required': 'Tag is required',
    'string.base': 'Tag must be a string'
  })
});

const tagIdParamsSchema = Joi.object({
  tagId: Joi.string().required().messages({
    'any.required': 'Tag ID is required',
    'string.base': 'Tag ID must be a string'
  })
});

const trendingTagsSchema = Joi.object({
  period: Joi.string().valid('24h', '7d', '30d').default('24h').messages({
    'any.only': 'Period must be one of: 24h, 7d, 30d'
  }),
  min_uses: Joi.number().integer().min(1).default(5).messages({
    'number.min': 'Minimum uses must be at least 1'
  }),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20)
});

const mergeTagsSchema = Joi.object({
  source_tag_id: Joi.string().required().messages({
    'any.required': 'Source tag ID is required'
  }),
  target_tag_id: Joi.string().required().messages({
    'any.required': 'Target tag ID is required'
  })
});

const renameTagSchema = Joi.object({
  new_name: Joi.string().min(1).max(50).pattern(/^[a-zA-Z0-9_]+$/).required().messages({
    'string.min': 'New tag name must be at least 1 character long',
    'string.max': 'New tag name must not exceed 50 characters',
    'string.pattern.base': 'New tag name can only contain letters, numbers and underscores',
    'any.required': 'New tag name is required'
  })
});

class TagController {
  /**
   * Normaliser un tag (lowercase, trim)
   */
  static normalizeTagName(tagName) {
    return tagName.toLowerCase().trim().replace(/^#/, '');
  }

  /**
   * Créer un nouveau tag
   */
  static async createTag(req, res) {
    try {
      const { error, value } = createTagSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

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

      const normalizedTag = this.normalizeTagName(value.tag);

      // Vérifier que le tag n'existe pas déjà
      const existingTag = await prisma.tag.findFirst({
        where: { tag: normalizedTag }
      });

      if (existingTag) {
        return res.status(409).json({ 
          error: 'Tag already exists',
          existing_tag: existingTag
        });
      }

      // Créer le tag
      const tag = await prisma.tag.create({
        data: { tag: normalizedTag }
      });

      logger.info(`Tag created by ${currentUser.username}: ${normalizedTag}`);

      res.status(201).json({
        message: 'Tag created successfully',
        tag: {
          id_tag: tag.id_tag,
          tag: tag.tag,
          created_by: currentUser.username
        }
      });
    } catch (error) {
      logger.error('Create tag error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Rechercher des posts par tag
   */
  static async searchByTag(req, res) {
    try {
      const { error: paramsError } = tagParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = paginationSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { tag: tagName } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const normalizedTag = this.normalizeTagName(tagName);

      // Vérifier que le tag existe
      const tag = await prisma.tag.findFirst({
        where: { tag: normalizedTag }
      });

      if (!tag) {
        return res.status(404).json({ error: 'Tag not found' });
      }

      // Récupérer les posts avec ce tag
      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where: {
            active: true,
            author: { 
              is_active: true,
              OR: [
                { private: false },
                ...(req.user ? [{
                  AND: [
                    { private: true },
                    {
                      followers: {
                        some: {
                          follower: req.user.id_user,
                          active: true,
                          pending: false
                        }
                      }
                    }
                  ]
                }] : [])
              ]
            },
            post_tags: {
              some: { id_tag: tag.id_tag }
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
              include: { tag: true }
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
        }),
        prisma.post.count({
          where: {
            active: true,
            author: { 
              is_active: true,
              private: false
            },
            post_tags: {
              some: { id_tag: tag.id_tag }
            }
          }
        })
      ]);

      const totalPages = Math.ceil(total / limit);

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

      res.json({
        tag: {
          id_tag: tag.id_tag,
          name: tag.tag,
          post_count: total
        },
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
      logger.error('Search by tag error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les tags populaires
   */
  static async getPopularTags(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { page, limit } = value;
      const skip = (page - 1) * limit;

      // Récupérer les tags avec leur nombre d'utilisations
      const popularTags = await prisma.tag.findMany({
        select: {
          id_tag: true,
          tag: true,
          _count: {
            select: {
              post_tags: {
                where: {
                  post: {
                    active: true,
                    author: { is_active: true }
                  }
                }
              }
            }
          }
        },
        orderBy: {
          post_tags: { _count: 'desc' }
        },
        skip,
        take: limit
      });

      // Filtrer les tags avec au moins 1 utilisation
      const filteredTags = popularTags
        .filter(tag => tag._count.post_tags > 0)
        .map(tag => ({
          id_tag: tag.id_tag,
          tag: tag.tag,
          post_count: tag._count.post_tags
        }));

      res.json({
        tags: filteredTags,
        pagination: {
          page,
          limit,
          hasNext: filteredTags.length === limit,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get popular tags error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les tags en tendance
   */
  static async getTrendingTags(req, res) {
    try {
      const { error, value } = trendingTagsSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { period, min_uses, page, limit } = value;
      const skip = (page - 1) * limit;

      // Calculer la date de début selon la période
      const startDate = new Date();
      switch (period) {
        case '24h':
          startDate.setHours(startDate.getHours() - 24);
          break;
        case '7d':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(startDate.getDate() - 30);
          break;
      }

      // Calculer les utilisations récentes et précédentes pour tendance
      const trendingTags = await prisma.$queryRaw`
        WITH recent_usage AS (
          SELECT 
            t.id_tag,
            t.tag,
            COUNT(pt.id_post) as recent_count
          FROM cercle.tags t
          LEFT JOIN cercle.post_tags pt ON t.id_tag = pt.id_tag
          LEFT JOIN cercle.post p ON pt.id_post = p.id_post
          WHERE p.active = true 
            AND p.created_at >= ${startDate}
            AND EXISTS (
              SELECT 1 FROM cercle.users u 
              WHERE u.id_user = p.id_user AND u.is_active = true
            )
          GROUP BY t.id_tag, t.tag
          HAVING COUNT(pt.id_post) >= ${min_uses}
        ),
        previous_usage AS (
          SELECT 
            t.id_tag,
            COUNT(pt.id_post) as previous_count
          FROM cercle.tags t
          LEFT JOIN cercle.post_tags pt ON t.id_tag = pt.id_tag
          LEFT JOIN cercle.post p ON pt.id_post = p.id_post
          WHERE p.active = true 
            AND p.created_at < ${startDate}
            AND p.created_at >= ${startDate}::timestamp - INTERVAL '${period}'
            AND EXISTS (
              SELECT 1 FROM cercle.users u 
              WHERE u.id_user = p.id_user AND u.is_active = true
            )
          GROUP BY t.id_tag
        )
        SELECT 
          r.id_tag,
          r.tag,
          r.recent_count,
          COALESCE(p.previous_count, 0) as previous_count,
          CASE 
            WHEN COALESCE(p.previous_count, 0) = 0 THEN r.recent_count * 100
            ELSE ((r.recent_count - p.previous_count)::float / p.previous_count * 100)
          END as growth_rate
        FROM recent_usage r
        LEFT JOIN previous_usage p ON r.id_tag = p.id_tag
        ORDER BY growth_rate DESC, r.recent_count DESC
        LIMIT ${limit} OFFSET ${skip}
      `;

      const tagsWithGrowth = trendingTags.map(tag => ({
        id_tag: tag.id_tag,
        tag: tag.tag,
        recent_count: parseInt(tag.recent_count),
        previous_count: parseInt(tag.previous_count),
        growth_rate: parseFloat(tag.growth_rate).toFixed(2)
      }));

      res.json({
        period,
        trending_tags: tagsWithGrowth,
        pagination: {
          page,
          limit,
          hasNext: tagsWithGrowth.length === limit,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get trending tags error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les tags utilisés par un utilisateur
   */
  static async getUserTags(req, res) {
    try {
      const { error: paramsError } = Joi.object({
        userId: Joi.string().required()
      }).validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = paginationSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
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
        select: { private: true, username: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Vérifier permissions pour comptes privés
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

      // Récupérer les tags utilisés par l'utilisateur avec fréquence
      const userTags = await prisma.tag.findMany({
        select: {
          id_tag: true,
          tag: true,
          _count: {
            select: {
              post_tags: {
                where: {
                  post: {
                    id_user: userId,
                    active: true
                  }
                }
              }
            }
          }
        },
        where: {
          post_tags: {
            some: {
              post: {
                id_user: userId,
                active: true
              }
            }
          }
        },
        orderBy: {
          post_tags: { _count: 'desc' }
        },
        skip,
        take: limit
      });

      const tagsWithUsage = userTags.map(tag => ({
        id_tag: tag.id_tag,
        tag: tag.tag,
        usage_count: tag._count.post_tags
      }));

      res.json({
        user: user.username,
        tags: tagsWithUsage,
        pagination: {
          page,
          limit,
          hasNext: tagsWithUsage.length === limit,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get user tags error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les détails complets d'un tag
   */
  static async getTagDetails(req, res) {
    try {
      const { error: paramsError } = tagParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { tag: tagName } = req.params;
      const normalizedTag = this.normalizeTagName(tagName);

      // Récupérer les informations du tag
      const tag = await prisma.tag.findFirst({
        where: { tag: normalizedTag },
        select: {
          id_tag: true,
          tag: true,
          _count: {
            select: {
              post_tags: {
                where: {
                  post: {
                    active: true,
                    author: { is_active: true }
                  }
                }
              }
            }
          }
        }
      });

      if (!tag) {
        return res.status(404).json({ error: 'Tag not found' });
      }

      // Statistiques temporelles (derniers 30 jours)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [recentActivity, topUsers, popularPosts] = await Promise.all([
        // Activité par jour sur 30 jours
        prisma.$queryRaw`
          SELECT 
            DATE(p.created_at) as date,
            COUNT(*) as post_count
          FROM cercle.post_tags pt
          JOIN cercle.post p ON pt.id_post = p.id_post
          JOIN cercle.users u ON p.id_user = u.id_user
          WHERE pt.id_tag = ${tag.id_tag}
            AND p.active = true
            AND u.is_active = true
            AND p.created_at >= ${thirtyDaysAgo}
          GROUP BY DATE(p.created_at)
          ORDER BY date DESC
        `,

        // Top utilisateurs du tag
        prisma.user.findMany({
          where: {
            is_active: true,
            posts: {
              some: {
                active: true,
                post_tags: {
                  some: { id_tag: tag.id_tag }
                }
              }
            }
          },
          select: {
            username: true,
            certified: true,
            _count: {
              select: {
                posts: {
                  where: {
                    active: true,
                    post_tags: {
                      some: { id_tag: tag.id_tag }
                    }
                  }
                }
              }
            }
          },
          orderBy: {
            posts: { _count: 'desc' }
          },
          take: 10
        }),

        // Posts les plus populaires avec ce tag
        prisma.post.findMany({
          where: {
            active: true,
            author: { 
              is_active: true,
              private: false
            },
            post_tags: {
              some: { id_tag: tag.id_tag }
            }
          },
          include: {
            author: {
              select: { username: true, certified: true }
            },
            _count: {
              select: {
                likes: { where: { active: true, user: { is_active: true } } }
              }
            }
          },
          orderBy: {
            likes: { _count: 'desc' }
          },
          take: 5
        })
      ]);

      res.json({
        tag: {
          id_tag: tag.id_tag,
          name: tag.tag,
          total_posts: tag._count.post_tags
        },
        activity: {
          daily_activity: recentActivity.map(day => ({
            date: day.date,
            post_count: parseInt(day.post_count)
          })),
          top_users: topUsers.map(user => ({
            username: user.username,
            certified: user.certified,
            posts_with_tag: user._count.posts
          })),
          popular_posts: popularPosts.map(post => ({
            id_post: post.id_post,
            content: post.content.substring(0, 100) + (post.content.length > 100 ? '...' : ''),
            author: post.author.username,
            like_count: post._count.likes,
            created_at: post.created_at
          }))
        }
      });
    } catch (error) {
      logger.error('Get tag details error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir des suggestions de tags
   */
  static async getSuggestedTags(req, res) {
    try {
      const { error, value } = paginationSchema.validate(req.query);
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

      // Récupérer les tags que l'utilisateur utilise déjà
      const userTags = await prisma.tag.findMany({
        where: {
          post_tags: {
            some: {
              post: {
                id_user: req.user.id_user,
                active: true
              }
            }
          }
        },
        select: { id_tag: true }
      });

      const userTagIds = userTags.map(tag => tag.id_tag);

      // Suggestions basées sur des utilisateurs similaires
      const suggestedTags = await prisma.$queryRaw`
        WITH similar_users AS (
          SELECT DISTINCT pt2.post_id_user
          FROM cercle.post_tags pt1
          JOIN cercle.post p1 ON pt1.id_post = p1.id_post
          JOIN cercle.post_tags pt2 ON pt1.id_tag = pt2.id_tag
          JOIN cercle.post p2 ON pt2.id_post = p2.id_post
          WHERE p1.id_user = ${req.user.id_user}
            AND p1.active = true
            AND p2.active = true
            AND p2.id_user != ${req.user.id_user}
          GROUP BY pt2.post_id_user
          HAVING COUNT(DISTINCT pt1.id_tag) >= 2
        ),
        tag_suggestions AS (
          SELECT 
            t.id_tag,
            t.tag,
            COUNT(DISTINCT pt.id_post) as usage_count,
            COUNT(DISTINCT p.id_user) as user_count
          FROM cercle.tags t
          JOIN cercle.post_tags pt ON t.id_tag = pt.id_tag
          JOIN cercle.post p ON pt.id_post = p.id_post
          WHERE p.active = true
            AND p.id_user IN (SELECT post_id_user FROM similar_users)
            AND t.id_tag != ALL(${userTagIds})
            AND EXISTS (
              SELECT 1 FROM cercle.users u 
              WHERE u.id_user = p.id_user AND u.is_active = true
            )
          GROUP BY t.id_tag, t.tag
          ORDER BY user_count DESC, usage_count DESC
        )
        SELECT * FROM tag_suggestions
        LIMIT ${limit} OFFSET ${skip}
      `;

      // Si pas assez de suggestions personnalisées, compléter avec tags populaires
      if (suggestedTags.length < limit) {
        const remainingLimit = limit - suggestedTags.length;
        const popularTags = await prisma.tag.findMany({
          where: {
            id_tag: { 
              notIn: [
                ...userTagIds, 
                ...suggestedTags.map(tag => tag.id_tag)
              ]
            }
          },
          select: {
            id_tag: true,
            tag: true,
            _count: {
              select: {
                post_tags: {
                  where: {
                    post: {
                      active: true,
                      author: { is_active: true }
                    }
                  }
                }
              }
            }
          },
          orderBy: {
            post_tags: { _count: 'desc' }
          },
          take: remainingLimit
        });

        // Ajouter les tags populaires aux suggestions
        popularTags.forEach(tag => {
          suggestedTags.push({
            id_tag: tag.id_tag,
            tag: tag.tag,
            usage_count: tag._count.post_tags,
            user_count: 0,
            is_popular: true
          });
        });
      }

      const formattedSuggestions = suggestedTags.map(tag => ({
        id_tag: tag.id_tag,
        tag: tag.tag,
        usage_count: parseInt(tag.usage_count || 0),
        user_count: parseInt(tag.user_count || 0),
        suggestion_type: tag.is_popular ? 'popular' : 'similar_users'
      }));

      res.json({
        suggestions: formattedSuggestions,
        pagination: {
          page,
          limit,
          hasNext: formattedSuggestions.length === limit,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get suggested tags error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Fusionner deux tags (modérateurs)
   */
  static async mergeTag(req, res) {
    try {
      const { error, value } = mergeTagsSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier que l'utilisateur connecté a les permissions
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
          message: 'Only moderators and administrators can merge tags'
        });
      }

      const { source_tag_id, target_tag_id } = value;

      // Vérifier que les deux tags existent
      const [sourceTag, targetTag] = await Promise.all([
        prisma.tag.findUnique({ where: { id_tag: source_tag_id } }),
        prisma.tag.findUnique({ where: { id_tag: target_tag_id } })
      ]);

      if (!sourceTag || !targetTag) {
        return res.status(404).json({ error: 'One or both tags not found' });
      }

      if (source_tag_id === target_tag_id) {
        return res.status(400).json({ error: 'Cannot merge a tag with itself' });
      }

      // Transaction pour fusionner les tags
      const result = await prisma.$transaction(async (tx) => {
        // Transférer toutes les associations vers le tag cible
        await tx.postTag.updateMany({
          where: { id_tag: source_tag_id },
          data: { id_tag: target_tag_id }
        });

        // Supprimer les doublons éventuels
        await tx.$executeRaw`
          DELETE FROM cercle.post_tags pt1
          WHERE pt1.id_tag = ${target_tag_id}
          AND EXISTS (
            SELECT 1 FROM cercle.post_tags pt2 
            WHERE pt2.id_post = pt1.id_post 
            AND pt2.id_tag = ${target_tag_id}
            AND pt2.id_post < pt1.id_post
          )
        `;

        // Supprimer le tag source
        await tx.tag.delete({
          where: { id_tag: source_tag_id }
        });

        // Compter les nouveaux totaux
        const newCount = await tx.postTag.count({
          where: { id_tag: target_tag_id }
        });

        return { newCount };
      });

      logger.info(`Tags merged by ${currentUser.username}: ${sourceTag.tag} -> ${targetTag.tag}`);

      res.json({
        message: 'Tags merged successfully',
        result: {
          source_tag: sourceTag.tag,
          target_tag: targetTag.tag,
          new_post_count: result.newCount
        },
        merged_by: currentUser.username
      });
    } catch (error) {
      logger.error('Merge tag error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Renommer un tag (modérateurs)
   */
  static async renameTag(req, res) {
    try {
      const { error: paramsError } = tagIdParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = renameTagSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Vérifier que l'utilisateur connecté a les permissions
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
          message: 'Only moderators and administrators can rename tags'
        });
      }

      const { tagId } = req.params;
      const newName = this.normalizeTagName(value.new_name);

      // Vérifier que le tag existe
      const existingTag = await prisma.tag.findUnique({
        where: { id_tag: tagId }
      });

      if (!existingTag) {
        return res.status(404).json({ error: 'Tag not found' });
      }

      // Vérifier que le nouveau nom n'existe pas déjà
      const conflictTag = await prisma.tag.findFirst({
        where: { 
          tag: newName,
          id_tag: { not: tagId }
        }
      });

      if (conflictTag) {
        return res.status(409).json({ 
          error: 'New tag name already exists',
          existing_tag: conflictTag
        });
      }

      // Renommer le tag
      const updatedTag = await prisma.tag.update({
        where: { id_tag: tagId },
        data: { tag: newName }
      });

      logger.info(`Tag renamed by ${currentUser.username}: ${existingTag.tag} -> ${newName}`);

      res.json({
        message: 'Tag renamed successfully',
        tag: {
          id_tag: updatedTag.id_tag,
          old_name: existingTag.tag,
          new_name: updatedTag.tag
        },
        renamed_by: currentUser.username
      });
    } catch (error) {
      logger.error('Rename tag error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Supprimer un tag (admin)
   */
  static async deleteTag(req, res) {
    try {
      const { error: paramsError } = tagIdParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

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
          message: 'Only administrators can delete tags'
        });
      }

      const { tagId } = req.params;

      // Vérifier que le tag existe et compter ses utilisations
      const tag = await prisma.tag.findUnique({
        where: { id_tag: tagId },
        select: {
          id_tag: true,
          tag: true,
          _count: {
            select: {
              post_tags: true
            }
          }
        }
      });

      if (!tag) {
        return res.status(404).json({ error: 'Tag not found' });
      }

      // Transaction pour supprimer le tag et ses associations
      await prisma.$transaction(async (tx) => {
        // Supprimer toutes les associations post-tag
        await tx.postTag.deleteMany({
          where: { id_tag: tagId }
        });

        // Supprimer le tag
        await tx.tag.delete({
          where: { id_tag: tagId }
        });
      });

      logger.info(`Tag deleted by ${currentUser.username}: ${tag.tag} (${tag._count.post_tags} associations removed)`);

      res.json({
        message: 'Tag deleted successfully',
        deleted_tag: {
          id_tag: tag.id_tag,
          name: tag.tag,
          associations_removed: tag._count.post_tags
        },
        deleted_by: currentUser.username
      });
    } catch (error) {
      logger.error('Delete tag error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les tags connexes (souvent utilisés ensemble)
   */
  static async getRelatedTags(req, res) {
    try {
      const { error: paramsError } = tagParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error: queryError, value } = paginationSchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ error: queryError.details[0].message });
      }

      const { tag: tagName } = req.params;
      const { page, limit } = value;
      const skip = (page - 1) * limit;

      const normalizedTag = this.normalizeTagName(tagName);

      // Vérifier que le tag existe
      const tag = await prisma.tag.findFirst({
        where: { tag: normalizedTag }
      });

      if (!tag) {
        return res.status(404).json({ error: 'Tag not found' });
      }

      // Trouver les tags qui apparaissent souvent avec ce tag
      const relatedTags = await prisma.$queryRaw`
        WITH tag_cooccurrence AS (
          SELECT 
            t2.id_tag,
            t2.tag,
            COUNT(DISTINCT p.id_post) as cooccurrence_count,
            COUNT(DISTINCT p.id_user) as user_count
          FROM cercle.post_tags pt1
          JOIN cercle.post p ON pt1.id_post = p.id_post
          JOIN cercle.post_tags pt2 ON p.id_post = pt2.id_post
          JOIN cercle.tags t2 ON pt2.id_tag = t2.id_tag
          JOIN cercle.users u ON p.id_user = u.id_user
          WHERE pt1.id_tag = ${tag.id_tag}
            AND pt2.id_tag != ${tag.id_tag}
            AND p.active = true
            AND u.is_active = true
          GROUP BY t2.id_tag, t2.tag
          HAVING COUNT(DISTINCT p.id_post) >= 2
        )
        SELECT 
          id_tag,
          tag,
          cooccurrence_count,
          user_count,
          (cooccurrence_count::float / (
            SELECT COUNT(DISTINCT pt.id_post) 
            FROM cercle.post_tags pt 
            JOIN cercle.post p ON pt.id_post = p.id_post
            WHERE pt.id_tag = ${tag.id_tag} AND p.active = true
          ) * 100) as correlation_percentage
        FROM tag_cooccurrence
        ORDER BY cooccurrence_count DESC, correlation_percentage DESC
        LIMIT ${limit} OFFSET ${skip}
      `;

      const formattedRelatedTags = relatedTags.map(relatedTag => ({
        id_tag: relatedTag.id_tag,
        tag: relatedTag.tag,
        cooccurrence_count: parseInt(relatedTag.cooccurrence_count),
        user_count: parseInt(relatedTag.user_count),
        correlation_percentage: parseFloat(relatedTag.correlation_percentage).toFixed(2)
      }));

      res.json({
        tag: {
          id_tag: tag.id_tag,
          name: tag.tag
        },
        related_tags: formattedRelatedTags,
        pagination: {
          page,
          limit,
          hasNext: formattedRelatedTags.length === limit,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      logger.error('Get related tags error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Nettoyer les tags inutilisés (admin)
   */
  static async cleanUnusedTags(req, res) {
    try {
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
          message: 'Only administrators can clean unused tags'
        });
      }

      const olderThanSchema = Joi.object({
        older_than_days: Joi.number().integer().min(1).max(365).default(90).messages({
          'number.min': 'Days must be at least 1',
          'number.max': 'Days must not exceed 365'
        })
      });

      const { error, value } = olderThanSchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { older_than_days } = value;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - older_than_days);

      // Identifier les tags inutilisés
      const unusedTags = await prisma.tag.findMany({
        where: {
          OR: [
            // Tags sans associations
            {
              post_tags: { none: {} }
            },
            // Tags dont toutes les associations sont sur des posts inactifs ou d'auteurs inactifs
            {
              post_tags: {
                every: {
                  OR: [
                    { post: { active: false } },
                    { post: { author: { is_active: false } } },
                    { post: { created_at: { lt: cutoffDate } } }
                  ]
                }
              }
            }
          ]
        },
        select: {
          id_tag: true,
          tag: true,
          _count: {
            select: {
              post_tags: true
            }
          }
        }
      });

      let cleanedCount = 0;
      const cleanedTags = [];

      // Supprimer les tags inutilisés
      for (const tag of unusedTags) {
        try {
          await prisma.$transaction(async (tx) => {
            // Supprimer les associations
            await tx.postTag.deleteMany({
              where: { id_tag: tag.id_tag }
            });

            // Supprimer le tag
            await tx.tag.delete({
              where: { id_tag: tag.id_tag }
            });
          });

          cleanedTags.push({
            id_tag: tag.id_tag,
            name: tag.tag,
            associations_removed: tag._count.post_tags
          });

          cleanedCount++;
        } catch (error) {
          logger.error(`Failed to delete unused tag ${tag.id_tag}:`, error);
        }
      }

      logger.info(`Unused tags cleanup by ${currentUser.username}: ${cleanedCount} tags removed`);

      res.json({
        message: 'Unused tags cleanup completed',
        results: {
          total_found: unusedTags.length,
          successfully_cleaned: cleanedCount,
          older_than_days,
          cleaned_tags: cleanedTags
        },
        cleaned_by: currentUser.username
      });
    } catch (error) {
      logger.error('Clean unused tags error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les analytics d'un tag (admin)
   */
  static async getTagAnalytics(req, res) {
    try {
      const { error: paramsError } = tagParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      // Vérifier que l'utilisateur connecté a les permissions
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
          message: 'Only moderators and administrators can view tag analytics'
        });
      }

      const { tag: tagName } = req.params;
      const normalizedTag = this.normalizeTagName(tagName);

      // Vérifier que le tag existe
      const tag = await prisma.tag.findFirst({
        where: { tag: normalizedTag }
      });

      if (!tag) {
        return res.status(404).json({ error: 'Tag not found' });
      }

      const [growthData, userDemographics, peakActivity, relatedTags] = await Promise.all([
        // Croissance sur les 90 derniers jours
        prisma.$queryRaw`
          SELECT 
            DATE(p.created_at) as date,
            COUNT(*) as daily_count
          FROM cercle.post_tags pt
          JOIN cercle.post p ON pt.id_post = p.id_post
          WHERE pt.id_tag = ${tag.id_tag}
            AND p.active = true
            AND p.created_at >= NOW() - INTERVAL '90 days'
          GROUP BY DATE(p.created_at)
          ORDER BY date
        `,

        // Démographie des utilisateurs
        prisma.$queryRaw`
          SELECT 
            u.username,
            COUNT(DISTINCT p.id_post) as post_count,
            MIN(p.created_at) as first_use,
            MAX(p.created_at) as last_use
          FROM cercle.post_tags pt
          JOIN cercle.post p ON pt.id_post = p.id_post
          JOIN cercle.users u ON p.id_user = u.id_user
          WHERE pt.id_tag = ${tag.id_tag}
            AND p.active = true
            AND u.is_active = true
          GROUP BY u.username
          ORDER BY post_count DESC
          LIMIT 20
        `,

        // Activité de pointe
        prisma.$queryRaw`
          SELECT 
            DATE(p.created_at) as peak_date,
            COUNT(*) as post_count
          FROM cercle.post_tags pt
          JOIN cercle.post p ON pt.id_post = p.id_post
          WHERE pt.id_tag = ${tag.id_tag}
            AND p.active = true
          GROUP BY DATE(p.created_at)
          ORDER BY post_count DESC
          LIMIT 5
        `,

        // Tags les plus corrélés
        prisma.$queryRaw`
          SELECT 
            t2.tag,
            COUNT(*) as cooccurrence
          FROM cercle.post_tags pt1
          JOIN cercle.post_tags pt2 ON pt1.id_post = pt2.id_post
          JOIN cercle.tags t2 ON pt2.id_tag = t2.id_tag
          WHERE pt1.id_tag = ${tag.id_tag}
            AND pt2.id_tag != ${tag.id_tag}
          GROUP BY t2.tag
          ORDER BY cooccurrence DESC
          LIMIT 10
        `
      ]);

      res.json({
        tag: {
          id_tag: tag.id_tag,
          name: tag.tag
        },
        analytics: {
          growth_data: growthData.map(day => ({
            date: day.date,
            count: parseInt(day.daily_count)
          })),
          user_demographics: userDemographics.map(user => ({
            username: user.username,
            post_count: parseInt(user.post_count),
            first_use: user.first_use,
            last_use: user.last_use
          })),
          peak_activity: peakActivity.map(peak => ({
            date: peak.peak_date,
            post_count: parseInt(peak.post_count)
          })),
          related_tags: relatedTags.map(related => ({
            tag: related.tag,
            cooccurrence: parseInt(related.cooccurrence)
          }))
        },
        generated_by: currentUser.username
      });
    } catch (error) {
      logger.error('Get tag analytics error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = TagController;
