// src/routes/likeRoutes.js
const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const db = require('../utils/database');

const router = express.Router();

// POST /api/v1/likes/posts/:id - Like/Unlike un post
router.post('/posts/:id', authenticateToken, async (req, res) => {
  try {
    const { id: postId } = req.params;
    const userId = req.user.id_user;

    console.log('🔄 Like request:', { postId, userId, userType: typeof userId });

    // Validation des données
    if (!postId || isNaN(parseInt(postId))) {
      return res.status(400).json({ 
        error: 'ID de post invalide',
        received: postId 
      });
    }

    // Conversion en nombres
    const postIdInt = parseInt(postId);
    const userIdInt = parseInt(userId);

    console.log('🔄 Converted IDs:', { postIdInt, userIdInt });

    // Vérifier que le post existe et est actif
    const post = await db.post.findUnique({
      where: { id_post: postIdInt },
      select: { 
        id_post: true, 
        active: true,
        user: {
          select: {
            id_user: true,
            is_active: true
          }
        }
      }
    });

    console.log('🔄 Post found:', post);

    if (!post) {
      return res.status(404).json({ error: 'Post non trouvé' });
    }

    if (!post.active) {
      return res.status(410).json({ error: 'Post supprimé' });
    }

    if (!post.user.is_active) {
      return res.status(410).json({ error: 'Auteur du post inactif' });
    }

    // Vérifier si l'utilisateur a déjà liké ce post
    const existingLike = await db.like.findUnique({
      where: {
        id_user_id_post: {
          id_user: userIdInt,
          id_post: postIdInt
        }
      }
    });

    console.log('🔄 Existing like:', existingLike);

    if (existingLike) {
      // Unlike - supprimer le like existant
      await db.like.delete({
        where: {
          id_user_id_post: {
            id_user: userIdInt,
            id_post: postIdInt
          }
        }
      });

      // Compter les likes restants
      const likeCount = await db.like.count({
        where: { id_post: postIdInt }
      });

      console.log('✅ Post unliked successfully');
      return res.json({
        success: true,
        action: 'unliked',
        isLiked: false,
        likeCount,
        message: 'Like retiré avec succès'
      });

    } else {
      // Like - créer un nouveau like
      await db.like.create({
        data: {
          id_post: postIdInt,
          id_user: userIdInt
        }
      });

      // Compter les likes
      const likeCount = await db.like.count({
        where: { id_post: postIdInt }
      });

      console.log('✅ Post liked successfully');
      return res.json({
        success: true,
        action: 'liked',
        isLiked: true,
        likeCount,
        message: 'Post liké avec succès'
      });
    }

  } catch (error) {
    console.error('❌ Error in like route:', error);
    
    // Erreurs spécifiques de base de données
    if (error.code === 'P2002') {
      return res.status(409).json({ 
        error: 'Conflit de données', 
        message: 'Action déjà effectuée' 
      });
    }
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        error: 'Ressource non trouvée',
        message: 'Post ou utilisateur introuvable'
      });
    }

    res.status(500).json({ 
      error: 'Erreur serveur',
      message: 'Impossible de traiter la demande de like',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/v1/likes/users/:id/posts - Posts likés par un utilisateur
router.get('/users/:id/posts', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    console.log('🔄 Fetching liked posts for user:', userId);

    const userIdInt = parseInt(userId);

    // Vérifier que l'utilisateur existe
    const user = await db.user.findUnique({
      where: { id_user: userIdInt },
      select: { id_user: true, is_active: true }
    });

    if (!user || !user.is_active) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Récupérer les posts likés avec leurs détails
    const likedPosts = await db.like.findMany({
      where: {
        id_user: userIdInt,
        post: { active: true }
      },
      include: {
        post: {
          include: {
            user: {
              select: {
                id_user: true,
                username: true,
                nom: true,
                prenom: true,
                photo_profil: true
              }
            },
            _count: {
              select: {
                likes: true,
                replies: { where: { active: true } }
              }
            }
          }
        }
      },
      orderBy: { created_at: 'desc' },
      skip: offset,
      take: limit
    });

    // Formater les résultats
    const formattedPosts = likedPosts
      .filter(like => like.post)
      .map(like => ({
        ...like.post,
        likeCount: like.post._count?.likes || 0,
        replyCount: like.post._count?.replies || 0,
        isLiked: true,
        isLikedByCurrentUser: req.user.id_user === userIdInt,
        author: like.post.user,
        likedAt: like.created_at
      }));

    // Compter le total pour la pagination
    const total = await db.like.count({
      where: {
        id_user: userIdInt,
        post: { active: true }
      }
    });

    console.log('✅ Liked posts fetched successfully');
    res.json({
      posts: formattedPosts,
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
    console.error('❌ Error fetching liked posts:', error);
    res.status(500).json({ 
      error: 'Erreur serveur',
      message: 'Impossible de récupérer les posts likés',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;