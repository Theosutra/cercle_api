// src/routes/postRoutes.js
const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const PostController = require('../controllers/postController');

const router = express.Router();

// ✅ CORRECTION: Utiliser les méthodes qui existent dans votre PostController

// Routes publiques avec authentification optionnelle (correspondent à votre contrôleur existant)
router.get('/public', optionalAuth, PostController.getPublicTimeline);
router.get('/trending', optionalAuth, PostController.getTrendingPosts);
router.get('/search', optionalAuth, PostController.searchPosts);
router.get('/user/:userId', optionalAuth, PostController.getUserPosts);

// ✅ CORRECTION: Route pour post individuel (votre méthode s'appelle getPost, pas getPostById)
router.get('/:id', optionalAuth, PostController.getPost);

// Routes protégées (nécessitent une authentification)
router.post('/', authenticateToken, PostController.createPost);
router.get('/timeline/personal', authenticateToken, PostController.getTimeline);
router.put('/:id', authenticateToken, PostController.updatePost);
router.delete('/:id', authenticateToken, PostController.deletePost);

// ✅ NOUVEAU: Routes pour les commentaires (utilisant les méthodes existantes ou des placeholders)

// GET /api/v1/posts/:id/replies - Commentaires d'un post (nouvelle fonctionnalité)
router.get('/:id/replies', optionalAuth, async (req, res) => {
  try {
    const { id: postId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Récupérer les commentaires (posts avec post_parent)
    const replies = await require('../utils/database').post.findMany({
      where: { 
        post_parent: parseInt(postId),
        active: true
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
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit
    });

    // Formater les réponses pour le frontend
    const formattedReplies = replies.map(reply => ({
      ...reply,
      author: reply.user, // Mapping pour compatibilité frontend
      likeCount: reply._count.likes,
      replyCount: reply._count.replies,
      isLiked: req.user ? reply.likes?.length > 0 : false,
      isLikedByCurrentUser: req.user ? reply.likes?.length > 0 : false,
      // Nettoyer les propriétés internes
      likes: undefined,
      _count: undefined,
      user: undefined
    }));

    // Compter le total pour la pagination
    const total = await require('../utils/database').post.count({
      where: { 
        post_parent: parseInt(postId),
        active: true
      }
    });

    res.json({
      replies: formattedReplies,
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
    console.error('Error fetching replies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/posts/:id/stats - Statistiques d'un post (nouvelle fonctionnalité)
router.get('/:id/stats', optionalAuth, async (req, res) => {
  try {
    const { id: postId } = req.params;

    // Vérifier que le post existe
    const post = await require('../utils/database').post.findUnique({
      where: { id_post: parseInt(postId) },
      select: { id_post: true, active: true }
    });

    if (!post || !post.active) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Récupérer les statistiques
    const [likesCount, repliesCount] = await Promise.all([
      require('../utils/database').like.count({
        where: { 
          id_post: parseInt(postId),
          active: true
        }
      }),
      require('../utils/database').post.count({
        where: { 
          post_parent: parseInt(postId),
          active: true
        }
      })
    ]);

    res.json({
      postId: parseInt(postId),
      stats: {
        likes: likesCount,
        replies: repliesCount,
        comments: repliesCount // Alias pour compatibilité
      }
    });

  } catch (error) {
    console.error('Error fetching post stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;