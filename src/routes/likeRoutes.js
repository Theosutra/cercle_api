// src/routes/likeRoutes.js - AVEC ROUTE POSTS LIKÉS
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

      // Compter les likes restants (seulement les actifs)
      const likeCount = await db.like.count({
        where: { 
          id_post: postIdInt,
          active: true
        }
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
      // Like - créer un nouveau like avec TOUS les champs obligatoires
      const now = new Date();
      
      await db.like.create({
        data: {
          id_post: postIdInt,
          id_user: userIdInt,
          active: true,
          notif_view: false,
          created_at: now,
          updated_at: now
        }
      });

      // Compter les likes (seulement les actifs)
      const likeCount = await db.like.count({
        where: { 
          id_post: postIdInt,
          active: true
        }
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

// GET /api/v1/likes/posts/:id - Obtenir les likes d'un post
router.get('/posts/:id', optionalAuth, async (req, res) => {
  try {
    const { id: postId } = req.params;
    const postIdInt = parseInt(postId);

    if (!postId || isNaN(postIdInt)) {
      return res.status(400).json({ error: 'ID de post invalide' });
    }

    // Vérifier que le post existe
    const post = await db.post.findUnique({
      where: { id_post: postIdInt },
      select: { id_post: true, active: true }
    });

    if (!post || !post.active) {
      return res.status(404).json({ error: 'Post non trouvé' });
    }

    // Compter les likes actifs
    const likeCount = await db.like.count({
      where: { 
        id_post: postIdInt,
        active: true
      }
    });

    // Vérifier si l'utilisateur connecté a liké ce post
    let isLikedByCurrentUser = false;
    if (req.user) {
      const userLike = await db.like.findUnique({
        where: {
          id_user_id_post: {
            id_user: req.user.id_user,
            id_post: postIdInt
          }
        },
        select: { active: true }
      });
      isLikedByCurrentUser = userLike?.active || false;
    }

    res.json({
      likeCount,
      isLikedByCurrentUser,
      postId: postIdInt
    });

  } catch (error) {
    console.error('❌ Error getting likes:', error);
    res.status(500).json({ 
      error: 'Erreur serveur',
      message: 'Impossible de récupérer les likes'
    });
  }
});

// ✅ NOUVELLE ROUTE: GET /api/v1/likes/users/:id/posts - Posts likés par un utilisateur
router.get('/users/:id/posts', optionalAuth, async (req, res) => {
  try {
    const { id: userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50); // Max 50
    const skip = (page - 1) * limit;

    // Validation de l'ID utilisateur
    const userIdInt = parseInt(userId);
    if (!userId || isNaN(userIdInt)) {
      return res.status(400).json({ error: 'ID utilisateur invalide' });
    }

    // Vérifier que l'utilisateur existe et est actif
    const user = await db.user.findUnique({
      where: { id_user: userIdInt },
      select: { 
        id_user: true, 
        is_active: true,
        private: true
      }
    });

    if (!user || !user.is_active) {
      return res.status(404).json({ error: 'Utilisateur non trouvé ou inactif' });
    }

    // Vérifier les permissions d'accès (compte privé)
    if (user.private && (!req.user || req.user.id_user !== userIdInt)) {
      // Si c'est un compte privé et qu'on n'est pas le propriétaire
      // Vérifier si on suit cet utilisateur
      if (req.user) {
        const isFollowing = await db.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: userIdInt
            }
          },
          select: { active: true }
        });

        if (!isFollowing?.active) {
          return res.status(403).json({ 
            error: 'Accès refusé', 
            message: 'Ce compte est privé' 
          });
        }
      } else {
        return res.status(403).json({ 
          error: 'Accès refusé', 
          message: 'Ce compte est privé' 
        });
      }
    }

    // Récupérer les posts likés par cet utilisateur
    const likes = await db.like.findMany({
      where: {
        id_user: userIdInt,
        active: true,
        post: {
          active: true,
          user: {
            is_active: true
          }
        }
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
                photo_profil: true,
                certified: true
              }
            },
            _count: {
              select: {
                likes: { where: { active: true } },
                replies: { where: { active: true } }
              }
            },
            ...(req.user && {
              likes: {
                where: {
                  id_user: req.user.id_user,
                  active: true
                }
              }
            })
          }
        }
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit
    });

    // Compter le total pour la pagination
    const total = await db.like.count({
      where: {
        id_user: userIdInt,
        active: true,
        post: {
          active: true,
          user: {
            is_active: true
          }
        }
      }
    });

    // Formater les posts pour le frontend
    const posts = likes.map(like => ({
      ...like.post,
      author: like.post.user, // Mapping pour compatibilité frontend
      likeCount: like.post._count.likes,
      replyCount: like.post._count.replies,
      isLiked: req.user ? like.post.likes?.length > 0 : false,
      isLikedByCurrentUser: req.user ? like.post.likes?.length > 0 : true, // Forcément true puisque c'est dans ses likes
      likedAt: like.created_at,
      // Nettoyer les propriétés internes
      likes: undefined,
      _count: undefined,
      user: undefined
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
    console.error('❌ Error getting user liked posts:', error);
    res.status(500).json({ 
      error: 'Erreur serveur',
      message: 'Impossible de récupérer les posts likés',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ✅ NOUVELLE ROUTE: GET /api/v1/likes/users/:id/stats - Statistiques de likes d'un utilisateur
router.get('/users/:id/stats', optionalAuth, async (req, res) => {
  try {
    const { id: userId } = req.params;
    const userIdInt = parseInt(userId);

    if (!userId || isNaN(userIdInt)) {
      return res.status(400).json({ error: 'ID utilisateur invalide' });
    }

    // Vérifier que l'utilisateur existe et est actif
    const user = await db.user.findUnique({
      where: { id_user: userIdInt },
      select: { 
        id_user: true, 
        is_active: true 
      }
    });

    if (!user || !user.is_active) {
      return res.status(404).json({ error: 'Utilisateur non trouvé ou inactif' });
    }

    const [likesGiven, likesReceived] = await Promise.all([
      // Likes donnés par l'utilisateur (sur posts actifs d'auteurs actifs)
      db.like.count({
        where: { 
          id_user: userIdInt,
          active: true,
          post: {
            active: true,
            user: { is_active: true }
          }
        }
      }),
      // Likes reçus sur ses posts (de likeurs actifs)
      db.like.count({
        where: {
          active: true,
          user: { is_active: true },
          post: {
            id_user: userIdInt,
            active: true
          }
        }
      })
    ]);

    res.json({
      likesGiven,
      likesReceived,
      ratio: likesGiven > 0 ? (likesReceived / likesGiven).toFixed(2) : "0.00"
    });

  } catch (error) {
    console.error('❌ Error getting user like stats:', error);
    res.status(500).json({ 
      error: 'Erreur serveur',
      message: 'Impossible de récupérer les statistiques de likes'
    });
  }
});

module.exports = router;