// src/routes/likeRoutes.js - CORRECTION COMPLÈTE
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
      // ✅ CORRECTION: Like - créer un nouveau like avec TOUS les champs obligatoires
      const now = new Date();
      
      await db.like.create({
        data: {
          id_post: postIdInt,
          id_user: userIdInt,
          active: true,        // ✅ AJOUTÉ: champ obligatoire
          notif_view: false,   // ✅ AJOUTÉ: champ obligatoire
          created_at: now,     // ✅ AJOUTÉ: champ obligatoire
          updated_at: now      // ✅ AJOUTÉ: champ obligatoire
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

// ✅ AUTRES ROUTES À AJOUTER SI NÉCESSAIRE

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

module.exports = router;