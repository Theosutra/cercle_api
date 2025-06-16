// src/routes/likeRoutes.js
const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const LikeController = require('../controllers/likeController');

const router = express.Router();

// ✅ CORRECTION: Routes de base qui correspondent exactement à votre structure

// Routes protégées (nécessitent une authentification)
// POST /api/v1/likes/posts/:id - Liker/unliker un post
router.post('/posts/:id', authenticateToken, async (req, res) => {
  try {
    console.log('🔄 Like toggle request:', { 
      params: req.params, 
      user: req.user?.id_user,
      userType: typeof req.user?.id_user 
    });

    const postId = parseInt(req.params.id, 10);
    const userId = parseInt(req.user.id_user, 10);

    console.log('🔄 Parsed IDs:', { postId, userId, postIdType: typeof postId, userIdType: typeof userId });

    if (isNaN(postId) || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid post ID or user ID' });
    }

    // Vérifier que le post existe et est actif
    const post = await require('../utils/database').post.findFirst({
      where: { 
        id_post: postId,
        active: true
      },
      include: {
        user: {
          select: { 
            id_user: true, 
            private: true,
            is_active: true
          }
        }
      }
    });

    console.log('🔄 Post found:', post ? { id: post.id_post, active: post.active, authorActive: post.user.is_active } : 'Not found');

    if (!post || !post.user.is_active) {
      return res.status(404).json({ error: 'Post not found or author inactive' });
    }

    // Vérifier si le like existe déjà
    const existingLike = await require('../utils/database').like.findUnique({
      where: {
        id_user_id_post: {
          id_user: userId,
          id_post: postId
        }
      }
    });

    console.log('🔄 Existing like:', existingLike ? 'Found' : 'Not found');

    let isLiked;
    let message;
    const now = new Date();
    
    if (existingLike) {
      // Unlike - supprimer le like
      await require('../utils/database').like.delete({
        where: {
          id_user_id_post: {
            id_user: userId,
            id_post: postId
          }
        }
      });
      isLiked = false;
      message = 'Post unliked';
      console.log('✅ Post unliked');
    } else {
      // Like - créer le like
      await require('../utils/database').like.create({
        data: {
          id_user: userId,
          id_post: postId,
          active: true,
          notif_view: false,
          created_at: now,
          updated_at: now
        }
      });
      isLiked = true;
      message = 'Post liked';
      console.log('✅ Post liked');
    }

    // Obtenir le nombre total de likes mis à jour
    const likeCount = await require('../utils/database').like.count({
      where: { 
        id_post: postId,
        active: true,
        user: {
          is_active: true
        }
      }
    });

    console.log('✅ Like count updated:', likeCount);

    res.json({
      message,
      isLiked,
      likeCount
    });

  } catch (error) {
    console.error('❌ Error in like toggle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/likes/posts/:id - Voir qui a liké un post
router.get('/posts/:id', optionalAuth, async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }

    // Récupérer les likes d'un post
    const [likes, total] = await Promise.all([
      require('../utils/database').like.findMany({
        where: { 
          id_post: postId,
          active: true,
          user: { is_active: true }
        },
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
      require('../utils/database').like.count({
        where: { 
          id_post: postId,
          active: true,
          user: { is_active: true }
        }
      })
    ]);

    res.json({
      users: likes.map(like => like.user),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching post likes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/likes/users/:id/posts - Posts likés par un utilisateur
router.get('/users/:id/posts', optionalAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Récupérer les posts likés par un utilisateur
    const [likedPosts, total] = await Promise.all([
      require('../utils/database').like.findMany({
        where: { 
          id_user: userId,
          active: true,
          post: {
            active: true,
            user: { is_active: true }
          }
        },
        include: {
          post: {
            include: {
              user: {
                select: {
                  id_user: true,
                  username: true,
                  photo_profil: true,
                  certified: true
                }
              },
              _count: {
                select: {
                  likes: { 
                    where: { 
                      active: true,
                      user: { is_active: true }
                    }
                  }
                }
              }
            }
          }
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      }),
      require('../utils/database').like.count({
        where: { 
          id_user: userId,
          active: true,
          post: {
            active: true,
            user: { is_active: true }
          }
        }
      })
    ]);

    res.json({
      posts: likedPosts.map(like => ({
        ...like.post,
        author: like.post.user,
        likeCount: like.post._count.likes,
        isLiked: true,
        likedAt: like.created_at,
        // Nettoyer les propriétés internes
        _count: undefined,
        user: undefined
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching user liked posts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/likes/users/:id/stats - Statistiques de likes d'un utilisateur
router.get('/users/:id/stats', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Vérifier que l'utilisateur existe
    const user = await require('../utils/database').user.findFirst({
      where: { 
        id_user: userId,
        is_active: true
      },
      select: { id_user: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found or inactive' });
    }

    // Calculer les statistiques
    const [likesGiven, likesReceived] = await Promise.all([
      // Likes donnés par l'utilisateur
      require('../utils/database').like.count({
        where: { 
          id_user: userId,
          active: true,
          post: {
            active: true,
            user: { is_active: true }
          }
        }
      }),
      // Likes reçus sur ses posts
      require('../utils/database').like.count({
        where: {
          active: true,
          user: { is_active: true },
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
      ratio: likesGiven > 0 ? (likesReceived / likesGiven).toFixed(2) : '0.00'
    });

  } catch (error) {
    console.error('Error fetching user like stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;