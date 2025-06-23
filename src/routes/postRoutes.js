const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const PostController = require('../controllers/postController');

const router = express.Router();

// Routes existantes (conservées)
router.get('/public', optionalAuth, PostController.getPublicTimeline);
router.get('/trending', optionalAuth, PostController.getTrendingPosts);
router.get('/search', optionalAuth, PostController.searchPosts);
router.get('/user/:userId', optionalAuth, PostController.getUserPosts);
router.get('/:id', optionalAuth, PostController.getPost);
router.post('/', authenticateToken, PostController.createPost);
router.get('/timeline/personal', authenticateToken, PostController.getTimeline);
router.put('/:id', authenticateToken, PostController.updatePost);
router.delete('/:id', authenticateToken, PostController.deletePost);

// ===== CONVERSATIONS HIÉRARCHIQUES INFINIES =====

// Fonction helper pour construire l'arbre de conversation
const buildConversationTree = (comments, parentId = null, depth = 0) => {
  return comments
    .filter(comment => comment.post_parent === parentId)
    .map(comment => ({
      ...comment,
      depth,
      replies: buildConversationTree(comments, comment.id_post, depth + 1)
    }))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // Ordre chronologique
};

// GET /api/v1/posts/:id/conversation - Récupérer toute la conversation hiérarchique
router.get('/:id/conversation', optionalAuth, async (req, res) => {
  try {
    const { id: postId } = req.params;
    const maxDepth = parseInt(req.query.maxDepth) || 999; // Limite de profondeur
    const prisma = require('../utils/database');

    console.log('🔄 Fetching conversation tree for post:', postId);

    // Récupérer TOUS les commentaires/réponses de manière récursive
    const allComments = await prisma.post.findMany({
      where: {
        active: true,
        OR: [
          { post_parent: parseInt(postId) }, // Commentaires directs
          // Récupération récursive via une sous-requête
          {
            post_parent: {
              in: await getRecursivePostIds(prisma, parseInt(postId), maxDepth)
            }
          }
        ]
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
      orderBy: { created_at: 'asc' }
    });

    console.log('✅ Found comments:', allComments.length);

    // Formater les commentaires
    const formattedComments = allComments.map(comment => ({
      ...comment,
      author: comment.user,
      likeCount: comment._count.likes,
      replyCount: comment._count.replies,
      isLiked: req.user ? comment.likes?.length > 0 : false,
      isLikedByCurrentUser: req.user ? comment.likes?.length > 0 : false,
      // Nettoyer les propriétés internes
      user: undefined,
      likes: undefined,
      _count: undefined
    }));

    // Construire l'arbre hiérarchique
    const conversationTree = buildConversationTree(formattedComments, parseInt(postId));

    res.json({
      conversation: conversationTree,
      total: formattedComments.length,
      maxDepth
    });

  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fonction helper pour récupérer récursivement tous les IDs de posts enfants
async function getRecursivePostIds(prisma, parentId, maxDepth, currentDepth = 0) {
  if (currentDepth >= maxDepth) return [];
  
  const directChildren = await prisma.post.findMany({
    where: {
      post_parent: parentId,
      active: true
    },
    select: { id_post: true }
  });
  
  const childIds = directChildren.map(child => child.id_post);
  
  // Récursion pour obtenir les petits-enfants, etc.
  for (const childId of childIds) {
    const grandChildren = await getRecursivePostIds(prisma, childId, maxDepth, currentDepth + 1);
    childIds.push(...grandChildren);
  }
  
  return childIds;
}

// POST /api/v1/posts/:parentId/reply - Répondre à N'IMPORTE QUEL post (commentaire ou réponse)
router.post('/:parentId/reply', authenticateToken, async (req, res) => {
  try {
    const { parentId } = req.params;
    const { content } = req.body;
    const prisma = require('../utils/database');

    console.log('🔄 Creating reply to post:', parentId, 'by user:', req.user.id_user);

    // Validation
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (content.trim().length > 280) {
      return res.status(400).json({ error: 'Content too long (max 280 characters)' });
    }

    // Vérifier que le post parent existe
    const parentPost = await prisma.post.findUnique({
      where: { 
        id_post: parseInt(parentId),
        active: true
      }
    });

    if (!parentPost) {
      console.log('❌ Parent post not found:', parentId);
      return res.status(404).json({ error: 'Parent post not found' });
    }

    // Calculer la profondeur pour éviter des conversations trop profondes
    const depth = await getPostDepth(prisma, parseInt(parentId));
    const MAX_DEPTH = 999; // Limite de profondeur
    
    if (depth >= MAX_DEPTH) {
      return res.status(400).json({ 
        error: 'Maximum conversation depth reached',
        maxDepth: MAX_DEPTH 
      });
    }

    // Créer la réponse
    const reply = await prisma.post.create({
      data: {
        content: content.trim(),
        id_user: req.user.id_user,
        post_parent: parseInt(parentId), // Peut être un post, commentaire, ou réponse
        id_message_type: 1,
        active: true,
        created_at: new Date(),
        updated_at: new Date()
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
      }
    });

    console.log('✅ Reply created successfully:', reply.id_post, 'depth:', depth + 1);

    // Formater la réponse
    const formattedReply = {
      ...reply,
      author: reply.user,
      likeCount: 0,
      replyCount: 0,
      isLiked: false,
      isLikedByCurrentUser: false,
      depth: depth + 1,
      replies: [], // Nouvelle réponse = pas de sous-réponses
      user: undefined
    };

    res.status(201).json({
      message: 'Reply created successfully',
      reply: formattedReply
    });

  } catch (error) {
    console.error('Error creating reply:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fonction helper pour calculer la profondeur d'un post
async function getPostDepth(prisma, postId, depth = 0) {
  const post = await prisma.post.findUnique({
    where: { id_post: postId },
    select: { post_parent: true }
  });
  
  if (!post || !post.post_parent) {
    return depth;
  }
  
  return getPostDepth(prisma, post.post_parent, depth + 1);
}

// GET /api/v1/posts/:id/replies - Compatibilité avec l'ancienne API (commentaires directs seulement)
router.get('/:id/replies', optionalAuth, async (req, res) => {
  try {
    const { id: postId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const prisma = require('../utils/database');

    // Récupérer seulement les commentaires directs (profondeur 1)
    const replies = await prisma.post.findMany({
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

    // Formater les réponses
    const formattedReplies = replies.map(reply => ({
      ...reply,
      author: reply.user,
      likeCount: reply._count.likes,
      replyCount: reply._count.replies,
      isLiked: req.user ? reply.likes?.length > 0 : false,
      isLikedByCurrentUser: req.user ? reply.likes?.length > 0 : false,
      depth: 1,
      replies: [], // Sera chargé séparément
      // Nettoyer les propriétés internes
      likes: undefined,
      _count: undefined,
      user: undefined
    }));

    const total = await prisma.post.count({
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

module.exports = router;