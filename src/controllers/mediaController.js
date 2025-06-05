const prisma = require('../utils/database');
const logger = require('../utils/logger');
const Joi = require('joi');
const path = require('path');
const fs = require('fs').promises;
const { postParamsSchema } = require('../validators/postValidator');
const { paginationSchema } = require('../validators/userValidator');

// Schémas de validation pour les médias
const addMediaSchema = Joi.object({
  media_type: Joi.string().valid('image', 'video').required().messages({
    'any.only': 'Media type must be either image or video',
    'any.required': 'Media type is required'
  }),
  file_path: Joi.string().required().messages({
    'any.required': 'File path is required',
    'string.base': 'File path must be a string'
  })
});

const uploadSchema = Joi.object({
  compress: Joi.boolean().default(true),
  generate_thumbnails: Joi.boolean().default(true),
  quality: Joi.number().min(1).max(100).default(80).messages({
    'number.min': 'Quality must be between 1 and 100',
    'number.max': 'Quality must be between 1 and 100'
  })
});

const mediaParamsSchema = Joi.object({
  mediaId: Joi.string().required().messages({
    'any.required': 'Media ID is required',
    'string.base': 'Media ID must be a string'
  })
});

const resizeImageSchema = Joi.object({
  width: Joi.number().integer().min(50).max(4096).messages({
    'number.min': 'Width must be at least 50px',
    'number.max': 'Width must not exceed 4096px'
  }),
  height: Joi.number().integer().min(50).max(4096).messages({
    'number.min': 'Height must be at least 50px',
    'number.max': 'Height must not exceed 4096px'
  }),
  quality: Joi.number().min(1).max(100).default(80)
});

class MediaController {
  /**
   * Configuration des limites
   */
  static config = {
    maxImagesPerPost: 4,
    maxVideosPerPost: 1,
    maxFileSize: {
      image: 10 * 1024 * 1024, // 10MB
      video: 100 * 1024 * 1024  // 100MB
    },
    allowedFormats: {
      image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
      video: ['.mp4', '.webm', '.mov', '.avi']
    },
    uploadPath: process.env.UPLOAD_PATH || './uploads'
  };

  /**
   * Valider format et taille de fichier
   */
  static validateMediaFormat(filePath, mediaType, fileSize = null) {
    const ext = path.extname(filePath).toLowerCase();
    const allowedExts = this.config.allowedFormats[mediaType];
    
    if (!allowedExts.includes(ext)) {
      throw new Error(`Invalid ${mediaType} format. Allowed: ${allowedExts.join(', ')}`);
    }

    if (fileSize && fileSize > this.config.maxFileSize[mediaType]) {
      const maxSizeMB = this.config.maxFileSize[mediaType] / (1024 * 1024);
      throw new Error(`File too large. Maximum size for ${mediaType}: ${maxSizeMB}MB`);
    }

    return true;
  }

  /**
   * Ajouter une image à un post
   */
  static async addImageToPost(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = addMediaSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { id: postId } = req.params;
      const { file_path } = value;

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

      // Vérifier que le post existe, est actif et appartient à l'utilisateur
      const post = await prisma.post.findFirst({
        where: { 
          id_post: postId,
          active: true,
          id_user: req.user.id_user
        },
        select: { id_post: true }
      });

      if (!post) {
        return res.status(404).json({ error: 'Post not found or access denied' });
      }

      // Valider le format de l'image
      this.validateMediaFormat(file_path, 'image');

      // Vérifier le nombre d'images déjà associées au post
      const imageType = await prisma.typeMedia.findFirst({
        where: { media: 'image' }
      });

      if (!imageType) {
        return res.status(500).json({ error: 'Image media type not configured' });
      }

      const existingImages = await prisma.imgVidPost.count({
        where: {
          id_post: postId,
          id_media: imageType.id_media
        }
      });

      if (existingImages >= this.config.maxImagesPerPost) {
        return res.status(400).json({ 
          error: 'Maximum images per post exceeded',
          message: `Maximum ${this.config.maxImagesPerPost} images allowed per post`
        });
      }

      const now = new Date();

      // Transaction pour ajouter l'image et mettre à jour le post
      const result = await prisma.$transaction(async (tx) => {
        // Créer l'entrée média
        const media = await tx.imgVidPost.create({
          data: {
            id_post: postId,
            id_media: imageType.id_media,
            lien_media: file_path
          },
          include: {
            type_media: true
          }
        });

        // Mettre à jour le timestamp du post
        await tx.post.update({
          where: { id_post: postId },
          data: { updated_at: now }
        });

        return media;
      });

      logger.info(`Image added to post ${postId} by ${currentUser.username}: ${file_path}`);

      res.status(201).json({
        message: 'Image added to post successfully',
        media: {
          id_img_vid_post: result.id_img_vid_post,
          type: result.type_media.media,
          url: result.lien_media,
          added_at: now
        }
      });
    } catch (error) {
      if (error.message.includes('Invalid') || error.message.includes('File too large')) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('Add image to post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Ajouter une vidéo à un post
   */
  static async addVideoToPost(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = addMediaSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { id: postId } = req.params;
      const { file_path } = value;

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

      // Vérifier que le post existe, est actif et appartient à l'utilisateur
      const post = await prisma.post.findFirst({
        where: { 
          id_post: postId,
          active: true,
          id_user: req.user.id_user
        },
        select: { id_post: true }
      });

      if (!post) {
        return res.status(404).json({ error: 'Post not found or access denied' });
      }

      // Valider le format de la vidéo
      this.validateMediaFormat(file_path, 'video');

      // Vérifier le nombre de vidéos déjà associées au post
      const videoType = await prisma.typeMedia.findFirst({
        where: { media: 'video' }
      });

      if (!videoType) {
        return res.status(500).json({ error: 'Video media type not configured' });
      }

      const existingVideos = await prisma.imgVidPost.count({
        where: {
          id_post: postId,
          id_media: videoType.id_media
        }
      });

      if (existingVideos >= this.config.maxVideosPerPost) {
        return res.status(400).json({ 
          error: 'Maximum videos per post exceeded',
          message: `Maximum ${this.config.maxVideosPerPost} video allowed per post`
        });
      }

      const now = new Date();

      // Transaction pour ajouter la vidéo et mettre à jour le post
      const result = await prisma.$transaction(async (tx) => {
        // Créer l'entrée média
        const media = await tx.imgVidPost.create({
          data: {
            id_post: postId,
            id_media: videoType.id_media,
            lien_media: file_path
          },
          include: {
            type_media: true
          }
        });

        // Mettre à jour le timestamp du post
        await tx.post.update({
          where: { id_post: postId },
          data: { updated_at: now }
        });

        return media;
      });

      logger.info(`Video added to post ${postId} by ${currentUser.username}: ${file_path}`);

      res.status(201).json({
        message: 'Video added to post successfully',
        media: {
          id_img_vid_post: result.id_img_vid_post,
          type: result.type_media.media,
          url: result.lien_media,
          added_at: now
        }
      });
    } catch (error) {
      if (error.message.includes('Invalid') || error.message.includes('File too large')) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('Add video to post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Supprimer une image d'un post
   */
  static async removeImageFromPost(req, res) {
    try {
      const { error: paramsError } = mediaParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { mediaId } = req.params;

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

      // Vérifier que le média existe et appartient à un post de l'utilisateur
      const media = await prisma.imgVidPost.findFirst({
        where: { 
          id_img_vid_post: mediaId
        },
        include: {
          post: {
            select: { id_user: true, id_post: true }
          },
          type_media: true
        }
      });

      if (!media) {
        return res.status(404).json({ error: 'Media not found' });
      }

      if (media.post.id_user !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Vérifier que c'est bien une image
      if (media.type_media.media !== 'image') {
        return res.status(400).json({ error: 'This endpoint is for images only' });
      }

      const filePath = media.lien_media;
      const now = new Date();

      // Transaction pour supprimer le média et mettre à jour le post
      await prisma.$transaction(async (tx) => {
        // Supprimer l'entrée de la base de données
        await tx.imgVidPost.delete({
          where: { id_img_vid_post: mediaId }
        });

        // Mettre à jour le timestamp du post
        await tx.post.update({
          where: { id_post: media.post.id_post },
          data: { updated_at: now }
        });
      });

      // Supprimer le fichier physique (en arrière-plan)
      this.deleteFileAsync(filePath);

      logger.info(`Image removed from post ${media.post.id_post} by ${currentUser.username}: ${filePath}`);

      res.json({ message: 'Image removed from post successfully' });
    } catch (error) {
      logger.error('Remove image from post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Supprimer une vidéo d'un post
   */
  static async removeVideoFromPost(req, res) {
    try {
      const { error: paramsError } = mediaParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { mediaId } = req.params;

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

      // Vérifier que le média existe et appartient à un post de l'utilisateur
      const media = await prisma.imgVidPost.findFirst({
        where: { 
          id_img_vid_post: mediaId
        },
        include: {
          post: {
            select: { id_user: true, id_post: true }
          },
          type_media: true
        }
      });

      if (!media) {
        return res.status(404).json({ error: 'Media not found' });
      }

      if (media.post.id_user !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Vérifier que c'est bien une vidéo
      if (media.type_media.media !== 'video') {
        return res.status(400).json({ error: 'This endpoint is for videos only' });
      }

      const filePath = media.lien_media;
      const now = new Date();

      // Transaction pour supprimer le média et mettre à jour le post
      await prisma.$transaction(async (tx) => {
        // Supprimer l'entrée de la base de données
        await tx.imgVidPost.delete({
          where: { id_img_vid_post: mediaId }
        });

        // Mettre à jour le timestamp du post
        await tx.post.update({
          where: { id_post: media.post.id_post },
          data: { updated_at: now }
        });
      });

      // Supprimer le fichier physique (en arrière-plan)
      this.deleteFileAsync(filePath);

      logger.info(`Video removed from post ${media.post.id_post} by ${currentUser.username}: ${filePath}`);

      res.json({ message: 'Video removed from post successfully' });
    } catch (error) {
      logger.error('Remove video from post error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Récupérer tous les médias d'un post
   */
  static async getPostMedia(req, res) {
    try {
      const { error: paramsError } = postParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { id: postId } = req.params;

      // Vérifier que le post existe et est actif
      const post = await prisma.post.findFirst({
        where: { 
          id_post: postId,
          active: true
        },
        select: { 
          id_post: true,
          author: {
            select: { 
              id_user: true, 
              private: true,
              is_active: true
            }
          }
        }
      });

      if (!post || !post.author.is_active) {
        return res.status(404).json({ error: 'Post not found or author inactive' });
      }

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
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Récupérer tous les médias du post
      const media = await prisma.imgVidPost.findMany({
        where: { id_post: postId },
        include: {
          type_media: true
        },
        orderBy: { id_img_vid_post: 'asc' }
      });

      // Grouper par type
      const groupedMedia = {
        images: [],
        videos: []
      };

      media.forEach(item => {
        const mediaInfo = {
          id: item.id_img_vid_post,
          url: item.lien_media,
          type: item.type_media.media
        };

        if (item.type_media.media === 'image') {
          groupedMedia.images.push(mediaInfo);
        } else if (item.type_media.media === 'video') {
          groupedMedia.videos.push(mediaInfo);
        }
      });

      res.json({
        post_id: postId,
        media: groupedMedia,
        counts: {
          images: groupedMedia.images.length,
          videos: groupedMedia.videos.length,
          total: media.length
        }
      });
    } catch (error) {
      logger.error('Get post media error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Upload d'un fichier média
   */
  static async uploadMedia(req, res) {
    try {
      const { error, value } = uploadSchema.validate(req.body);
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

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const file = req.file;
      const fileExt = path.extname(file.originalname).toLowerCase();
      
      // Déterminer le type de média
      let mediaType;
      if (this.config.allowedFormats.image.includes(fileExt)) {
        mediaType = 'image';
      } else if (this.config.allowedFormats.video.includes(fileExt)) {
        mediaType = 'video';
      } else {
        return res.status(400).json({ 
          error: 'Unsupported file format',
          allowedFormats: this.config.allowedFormats
        });
      }

      // Valider la taille
      this.validateMediaFormat(file.originalname, mediaType, file.size);

      // Générer nom unique
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(7);
      const fileName = `${currentUser.id_user}_${timestamp}_${randomStr}${fileExt}`;
      const relativePath = `${mediaType}s/${fileName}`;
      const fullPath = path.join(this.config.uploadPath, relativePath);

      // Créer le dossier si nécessaire
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // Déplacer le fichier uploadé
      await fs.rename(file.path, fullPath);

      logger.info(`Media uploaded by ${currentUser.username}: ${fileName} (${mediaType})`);

      res.status(201).json({
        message: 'File uploaded successfully',
        file: {
          filename: fileName,
          path: relativePath,
          type: mediaType,
          size: file.size,
          originalName: file.originalname
        }
      });
    } catch (error) {
      if (error.message.includes('Invalid') || error.message.includes('File too large')) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('Upload media error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les statistiques médias d'un utilisateur
   */
  static async getMediaStats(req, res) {
    try {
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

      // Récupérer les statistiques
      const [imageCount, videoCount, recentMedia] = await Promise.all([
        // Compter les images
        prisma.imgVidPost.count({
          where: {
            post: { id_user: req.user.id_user, active: true },
            type_media: { media: 'image' }
          }
        }),

        // Compter les vidéos
        prisma.imgVidPost.count({
          where: {
            post: { id_user: req.user.id_user, active: true },
            type_media: { media: 'video' }
          }
        }),

        // Médias récents
        prisma.imgVidPost.findMany({
          where: {
            post: { id_user: req.user.id_user, active: true }
          },
          include: {
            type_media: true,
            post: {
              select: { created_at: true }
            }
          },
          orderBy: { id_img_vid_post: 'desc' },
          take: 10
        })
      ]);

      res.json({
        user: currentUser.username,
        stats: {
          totalMedia: imageCount + videoCount,
          images: imageCount,
          videos: videoCount
        },
        recentMedia: recentMedia.map(media => ({
          id: media.id_img_vid_post,
          type: media.type_media.media,
          url: media.lien_media,
          uploadedAt: media.post.created_at
        }))
      });
    } catch (error) {
      logger.error('Get media stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Statistiques globales des médias (admin)
   */
  static async getGlobalMediaStats(req, res) {
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
          message: 'Only administrators can view global media statistics'
        });
      }

      const [totalImages, totalVideos, topUsers, recentUploads] = await Promise.all([
        // Total images
        prisma.imgVidPost.count({
          where: {
            type_media: { media: 'image' },
            post: { active: true, author: { is_active: true } }
          }
        }),

        // Total vidéos
        prisma.imgVidPost.count({
          where: {
            type_media: { media: 'video' },
            post: { active: true, author: { is_active: true } }
          }
        }),

        // Top utilisateurs par nombre de médias
        prisma.user.findMany({
          where: { is_active: true },
          select: {
            id_user: true,
            username: true,
            _count: {
              select: {
                posts: {
                  where: {
                    active: true,
                    img_vid_posts: { some: {} }
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

        // Uploads récents
        prisma.imgVidPost.findMany({
          where: {
            post: { active: true, author: { is_active: true } }
          },
          include: {
            type_media: true,
            post: {
              select: {
                created_at: true,
                author: {
                  select: { username: true }
                }
              }
            }
          },
          orderBy: { id_img_vid_post: 'desc' },
          take: 20
        })
      ]);

      res.json({
        globalStats: {
          totalMedia: totalImages + totalVideos,
          images: totalImages,
          videos: totalVideos,
          limits: {
            maxImagesPerPost: this.config.maxImagesPerPost,
            maxVideosPerPost: this.config.maxVideosPerPost,
            maxFileSizes: this.config.maxFileSize
          }
        },
        topUsers: topUsers.map(user => ({
          username: user.username,
          mediaCount: user._count.posts
        })),
        recentUploads: recentUploads.map(media => ({
          type: media.type_media.media,
          author: media.post.author.username,
          uploadedAt: media.post.created_at
        }))
      });
    } catch (error) {
      logger.error('Get global media stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Nettoyer les médias orphelins (admin)
   */
  static async cleanOrphanedMedia(req, res) {
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
          message: 'Only administrators can clean orphaned media'
        });
      }

      // Identifier les médias orphelins (posts inactifs ou auteurs inactifs)
      const orphanedMedia = await prisma.imgVidPost.findMany({
        where: {
          OR: [
            { post: { active: false } },
            { post: { author: { is_active: false } } }
          ]
        },
        select: {
          id_img_vid_post: true,
          lien_media: true
        }
      });

      let cleanedCount = 0;
      const failedDeletions = [];

      // Supprimer les médias orphelins
      for (const media of orphanedMedia) {
        try {
          // Supprimer de la base de données
          await prisma.imgVidPost.delete({
            where: { id_img_vid_post: media.id_img_vid_post }
          });

          // Supprimer le fichier physique
          await this.deleteFileAsync(media.lien_media);
          
          cleanedCount++;
        } catch (error) {
          logger.error(`Failed to delete orphaned media ${media.id_img_vid_post}:`, error);
          failedDeletions.push(media.id_img_vid_post);
        }
      }

      logger.info(`Orphaned media cleanup by ${currentUser.username}: ${cleanedCount} files cleaned, ${failedDeletions.length} failures`);

      res.json({
        message: 'Orphaned media cleanup completed',
        results: {
          totalFound: orphanedMedia.length,
          successfullyCleaned: cleanedCount,
          failed: failedDeletions.length,
          failedIds: failedDeletions
        }
      });
    } catch (error) {
      logger.error('Clean orphaned media error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Signaler un contenu média
   */
  static async reportMedia(req, res) {
    try {
      const { error: paramsError } = mediaParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const reportSchema = Joi.object({
        reason: Joi.string().min(5).max(255).required().messages({
          'string.min': 'Report reason must be at least 5 characters',
          'string.max': 'Report reason must not exceed 255 characters',
          'any.required': 'Report reason is required'
        })
      });

      const { error, value } = reportSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { mediaId } = req.params;
      const { reason } = value;

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

      // Vérifier que le média existe
      const media = await prisma.imgVidPost.findFirst({
        where: { id_img_vid_post: mediaId },
        include: {
          post: {
            select: { 
              id_post: true,
              author: { select: { is_active: true } }
            }
          }
        }
      });

      if (!media || !media.post.author.is_active) {
        return res.status(404).json({ error: 'Media not found or author inactive' });
      }

      // Vérifier si l'utilisateur a déjà signalé ce post
      const existingReport = await prisma.report.findUnique({
        where: {
          id_user_id_post: {
            id_user: req.user.id_user,
            id_post: media.post.id_post
          }
        }
      });

      if (existingReport) {
        return res.status(409).json({ error: 'You have already reported this content' });
      }

      // Créer le signalement
      await prisma.report.create({
        data: {
          id_user: req.user.id_user,
          id_post: media.post.id_post,
          raison: `Media content: ${reason}`,
          reported_at: new Date()
        }
      });

      logger.info(`Media reported by ${currentUser.username}: ${mediaId} - ${reason}`);

      res.status(201).json({ message: 'Media reported successfully' });
    } catch (error) {
      logger.error('Report media error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Modération de contenu média (modérateurs/admin)
   */
  static async moderateMedia(req, res) {
    try {
      const { error: paramsError } = mediaParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const moderationSchema = Joi.object({
        action: Joi.string().valid('approve', 'remove', 'warn').required().messages({
          'any.only': 'Action must be one of: approve, remove, warn',
          'any.required': 'Action is required'
        }),
        reason: Joi.string().max(500).optional().messages({
          'string.max': 'Reason must not exceed 500 characters'
        })
      });

      const { error, value } = moderationSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { mediaId } = req.params;
      const { action, reason } = value;

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
          message: 'Only moderators and administrators can moderate content'
        });
      }

      // Vérifier que le média existe
      const media = await prisma.imgVidPost.findFirst({
        where: { id_img_vid_post: mediaId },
        include: {
          post: {
            select: { 
              id_post: true,
              id_user: true,
              author: { 
                select: { 
                  username: true, 
                  is_active: true 
                } 
              }
            }
          },
          type_media: true
        }
      });

      if (!media) {
        return res.status(404).json({ error: 'Media not found' });
      }

      let actionTaken = '';

      switch (action) {
        case 'remove':
          // Supprimer le média
          await prisma.$transaction(async (tx) => {
            await tx.imgVidPost.delete({
              where: { id_img_vid_post: mediaId }
            });

            await tx.post.update({
              where: { id_post: media.post.id_post },
              data: { updated_at: new Date() }
            });
          });

          // Supprimer le fichier physique
          this.deleteFileAsync(media.lien_media);
          actionTaken = 'removed';
          break;

        case 'approve':
          actionTaken = 'approved';
          break;

        case 'warn':
          actionTaken = 'warned';
          break;
      }

      logger.info(`Media ${actionTaken} by ${currentUser.username}: ${mediaId} (${media.type_media.media}) - ${reason || 'No reason provided'}`);

      res.json({
        message: `Media ${actionTaken} successfully`,
        action: actionTaken,
        media: {
          id: mediaId,
          type: media.type_media.media,
          post_author: media.post.author.username
        },
        moderator: currentUser.username,
        reason: reason || null
      });
    } catch (error) {
      logger.error('Moderate media error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Obtenir les informations d'un fichier média
   */
  static async getMediaInfo(req, res) {
    try {
      const { error: paramsError } = mediaParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { mediaId } = req.params;

      // Récupérer les informations du média
      const media = await prisma.imgVidPost.findFirst({
        where: { id_img_vid_post: mediaId },
        include: {
          type_media: true,
          post: {
            select: {
              id_post: true,
              created_at: true,
              author: {
                select: {
                  id_user: true,
                  username: true,
                  private: true,
                  is_active: true
                }
              }
            }
          }
        }
      });

      if (!media || !media.post.author.is_active) {
        return res.status(404).json({ error: 'Media not found or author inactive' });
      }

      // Vérifier permissions pour comptes privés
      if (media.post.author.private && req.user && media.post.author.id_user !== req.user.id_user) {
        const isFollowing = await prisma.follow.findUnique({
          where: {
            follower_account: {
              follower: req.user.id_user,
              account: media.post.author.id_user
            }
          },
          select: { active: true, pending: true }
        });

        if (!isFollowing || !isFollowing.active || isFollowing.pending) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Essayer de récupérer les métadonnées du fichier
      let fileStats = null;
      try {
        const fullPath = path.join(this.config.uploadPath, media.lien_media);
        const stats = await fs.stat(fullPath);
        fileStats = {
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      } catch (error) {
        logger.warn(`Could not read file stats for media ${mediaId}: ${error.message}`);
      }

      res.json({
        media: {
          id: media.id_img_vid_post,
          type: media.type_media.media,
          url: media.lien_media,
          post: {
            id: media.post.id_post,
            author: media.post.author.username,
            created_at: media.post.created_at
          },
          file: fileStats
        }
      });
    } catch (error) {
      logger.error('Get media info error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Fonction utilitaire pour supprimer un fichier de manière asynchrone
   */
  static async deleteFileAsync(filePath) {
    try {
      const fullPath = path.join(this.config.uploadPath, filePath);
      await fs.unlink(fullPath);
      logger.info(`File deleted: ${filePath}`);
    } catch (error) {
      logger.error(`Failed to delete file ${filePath}:`, error);
    }
  }

  /**
   * Redimensionner une image (utilitaire)
   */
  static async resizeImage(req, res) {
    try {
      const { error: paramsError } = mediaParamsSchema.validate(req.params);
      if (paramsError) {
        return res.status(400).json({ error: paramsError.details[0].message });
      }

      const { error, value } = resizeImageSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { mediaId } = req.params;
      const { width, height, quality } = value;

      // Vérifier que le média existe et est une image
      const media = await prisma.imgVidPost.findFirst({
        where: { 
          id_img_vid_post: mediaId,
          type_media: { media: 'image' }
        },
        include: {
          post: {
            select: { 
              id_user: true,
              author: { select: { is_active: true } }
            }
          }
        }
      });

      if (!media || !media.post.author.is_active) {
        return res.status(404).json({ error: 'Image not found or author inactive' });
      }

      // Vérifier que l'utilisateur est propriétaire
      if (media.post.id_user !== req.user.id_user) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Note: Ici vous devriez intégrer une bibliothèque comme Sharp ou Jimp
      // pour effectuer le redimensionnement réel
      
      logger.info(`Image resize requested for media ${mediaId}: ${width}x${height}@${quality}%`);

      res.json({
        message: 'Image resize feature not implemented yet',
        requested: {
          mediaId,
          width,
          height,
          quality
        },
        note: 'This feature requires image processing library integration'
      });
    } catch (error) {
      logger.error('Resize image error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = MediaController;
