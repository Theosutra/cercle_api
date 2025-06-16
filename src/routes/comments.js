// routes/comments.js
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/authMiddleware');
const router = express.Router();
const prisma = new PrismaClient();

// ✅ NOUVEAU: Obtenir les commentaires d'un post (utilise l'auto-relation)
router.get('/posts/:id_post/replies', authMiddleware, async (req, res) => {
  try {
    const { id_post } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Vérifier que le post existe
    const post = await prisma.post.findUnique({
      where: { id_post: parseInt(id_post) }
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Récupérer les réponses (commentaires) du post
    const replies = await prisma.post.findMany({
      where: { 
        post_parent: parseInt(id_post),
        active: true
      },
      include: {
        author: {
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
            likes: {
              where: { active: true }
            },
            replies: {
              where: { active: true }
            }
          }
        },
        likes: {
          where: {
            id_user: req.user.id_user,
            active: true
          }
        }
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit
    });

    // Formater les réponses
    const formattedReplies = replies.map(reply => ({
      ...reply,
      likeCount: reply._count.likes,
      replyCount: reply._count.replies,
      isLiked: reply.likes.length > 0,
      isLikedByCurrentUser: reply.likes.length > 0
    }));

    // Compter le total pour la pagination
    const total = await prisma.post.count({
      where: { 
        post_parent: parseInt(id_post),
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

// ✅ NOUVEAU: Créer un commentaire (réponse à un post)
router.post('/posts/:id_post/replies', authMiddleware, async (req, res) => {
  try {
    const { id_post } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (content.trim().length > 280) {
      return res.status(400).json({ error: 'Content too long (max 280 characters)' });
    }

    // Vérifier que le post parent existe
    const parentPost = await prisma.post.findUnique({
      where: { id_post: parseInt(id_post) }
    });

    if (!parentPost) {
      return res.status(404).json({ error: 'Parent post not found' });
    }

    // Créer le commentaire (réponse)
    const reply = await prisma.post.create({
      data: {
        content: content.trim(),
        id_user: req.user.id_user,
        post_parent: parseInt(id_post),
        id_message_type: 1, // Type par défaut pour les posts
        active: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      include: {
        author: {
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

    // Formater la réponse
    const formattedReply = {
      ...reply,
      likeCount: 0,
      replyCount: 0,
      isLiked: false,
      isLikedByCurrentUser: false
    };

    res.status(201).json({
      message: 'Reply created successfully',
      post: formattedReply
    });

  } catch (error) {
    console.error('Error creating reply:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ NOUVEAU: Supprimer un commentaire
router.delete('/posts/:id_post/replies/:reply_id', authMiddleware, async (req, res) => {
  try {
    const { id_post, reply_id } = req.params;

    // Vérifier que la réponse existe et appartient à l'utilisateur
    const reply = await prisma.post.findFirst({
      where: {
        id_post: parseInt(reply_id),
        post_parent: parseInt(id_post),
        id_user: req.user.id_user
      }
    });

    if (!reply) {
      return res.status(404).json({ error: 'Reply not found or unauthorized' });
    }

    // Marquer comme inactive au lieu de supprimer
    await prisma.post.update({
      where: { id_post: parseInt(reply_id) },
      data: { 
        active: false,
        updated_at: new Date()
      }
    });

    res.json({ message: 'Reply deleted successfully' });

  } catch (error) {
    console.error('Error deleting reply:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ NOUVEAU: Modifier un commentaire
router.put('/posts/:id_post/replies/:reply_id', authMiddleware, async (req, res) => {
  try {
    const { id_post, reply_id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (content.trim().length > 280) {
      return res.status(400).json({ error: 'Content too long (max 280 characters)' });
    }

    // Vérifier que la réponse existe et appartient à l'utilisateur
    const reply = await prisma.post.findFirst({
      where: {
        id_post: parseInt(reply_id),
        post_parent: parseInt(id_post),
        id_user: req.user.id_user,
        active: true
      }
    });

    if (!reply) {
      return res.status(404).json({ error: 'Reply not found or unauthorized' });
    }

    // Mettre à jour le contenu
    const updatedReply = await prisma.post.update({
      where: { id_post: parseInt(reply_id) },
      data: { 
        content: content.trim(),
        updated_at: new Date()
      },
      include: {
        author: {
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
            likes: {
              where: { active: true }
            },
            replies: {
              where: { active: true }
            }
          }
        },
        likes: {
          where: {
            id_user: req.user.id_user,
            active: true
          }
        }
      }
    });

    // Formater la réponse
    const formattedReply = {
      ...updatedReply,
      likeCount: updatedReply._count.likes,
      replyCount: updatedReply._count.replies,
      isLiked: updatedReply.likes.length > 0,
      isLikedByCurrentUser: updatedReply.likes.length > 0
    };

    res.json({
      message: 'Reply updated successfully',
      post: formattedReply
    });

  } catch (error) {
    console.error('Error updating reply:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;