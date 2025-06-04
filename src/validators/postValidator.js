const Joi = require('joi');

// Schéma de validation pour la création d'un post
const createPostSchema = Joi.object({
  content: Joi.string()
    .min(1)
    .max(280)
    .required()
    .messages({
      'string.min': 'Post content cannot be empty',
      'string.max': 'Post content must not exceed 280 characters',
      'any.required': 'Post content is required'
    }),
    
  id_message_type: Joi.string()
    .optional()
    .messages({
      'string.base': 'Message type ID must be a string'
    })
});

// Schéma de validation pour la mise à jour d'un post
const updatePostSchema = Joi.object({
  content: Joi.string()
    .min(1)
    .max(280)
    .required()
    .messages({
      'string.min': 'Post content cannot be empty',
      'string.max': 'Post content must not exceed 280 characters',
      'any.required': 'Post content is required'
    })
});

// Schéma de validation pour récupérer les posts (pagination)
const getPostsSchema = Joi.object({
  page: Joi.number()
    .integer()
    .min(1)
    .default(1)
    .messages({
      'number.base': 'Page must be a number',
      'number.integer': 'Page must be an integer',
      'number.min': 'Page must be at least 1'
    }),
    
  limit: Joi.number()
    .integer()
    .min(1)
    .max(50)
    .default(20)
    .messages({
      'number.base': 'Limit must be a number',
      'number.integer': 'Limit must be an integer',
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit must not exceed 50'
    })
});

// Schéma de validation pour les paramètres de post
const postParamsSchema = Joi.object({
  id: Joi.string()
    .required()
    .messages({
      'any.required': 'Post ID is required',
      'string.base': 'Post ID must be a string'
    })
});

// Schéma de validation pour les paramètres d'utilisateur dans les posts
const userPostsParamsSchema = Joi.object({
  userId: Joi.string()
    .required()
    .messages({
      'any.required': 'User ID is required',
      'string.base': 'User ID must be a string'
    })
});

// Schéma de validation pour les posts avec recherche
const searchPostsSchema = Joi.object({
  search: Joi.string()
    .min(1)
    .max(100)
    .optional()
    .messages({
      'string.min': 'Search term must be at least 1 character long',
      'string.max': 'Search term must not exceed 100 characters'
    }),
    
  page: Joi.number()
    .integer()
    .min(1)
    .default(1)
    .messages({
      'number.base': 'Page must be a number',
      'number.integer': 'Page must be an integer',
      'number.min': 'Page must be at least 1'
    }),
    
  limit: Joi.number()
    .integer()
    .min(1)
    .max(50)
    .default(20)
    .messages({
      'number.base': 'Limit must be a number',
      'number.integer': 'Limit must be an integer',
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit must not exceed 50'
    }),
    
  sortBy: Joi.string()
    .valid('created_at', 'likes_count')
    .default('created_at')
    .messages({
      'any.only': 'Sort by must be either "created_at" or "likes_count"'
    }),
    
  order: Joi.string()
    .valid('asc', 'desc')
    .default('desc')
    .messages({
      'any.only': 'Order must be either "asc" or "desc"'
    })
});

module.exports = { 
  createPostSchema, 
  updatePostSchema, 
  getPostsSchema,
  postParamsSchema,
  userPostsParamsSchema,
  searchPostsSchema
};