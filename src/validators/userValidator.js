const Joi = require('joi');

// Schéma de validation pour la mise à jour du profil
const updateProfileSchema = Joi.object({
  bio: Joi.string()
    .max(255)
    .allow('')
    .optional()
    .messages({
      'string.max': 'Bio must not exceed 255 characters'
    }),
    
  photo_profil: Joi.string()
    .uri()
    .allow('')
    .optional()
    .messages({
      'string.uri': 'Profile photo must be a valid URL'
    }),
    
  nom: Joi.string()
    .max(50)
    .optional()
    .allow('')
    .messages({
      'string.max': 'Last name must not exceed 50 characters'
    }),
    
  prenom: Joi.string()
    .max(50)
    .optional()
    .allow('')
    .messages({
      'string.max': 'First name must not exceed 50 characters'
    }),
    
  telephone: Joi.string()
    .pattern(/^[\+]?[\d\s\-\(\)]+$/)
    .max(20)
    .optional()
    .allow('')
    .messages({
      'string.pattern.base': 'Please provide a valid phone number',
      'string.max': 'Phone number must not exceed 20 characters'
    }),
    
  private: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'Private setting must be true or false'
    })
});

// Schéma de validation pour la recherche d'utilisateurs
const searchSchema = Joi.object({
  search: Joi.string()
    .min(1)
    .max(50)
    .optional()
    .messages({
      'string.min': 'Search term must be at least 1 character long',
      'string.max': 'Search term must not exceed 50 characters'
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
    })
});

// Schéma de validation pour les paramètres d'utilisateur
const userParamsSchema = Joi.object({
  id: Joi.string()
    .required()
    .messages({
      'any.required': 'User ID is required',
      'string.base': 'User ID must be a string'
    })
});

// Schéma de validation pour la pagination générique
const paginationSchema = Joi.object({
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
    .max(100)
    .default(20)
    .messages({
      'number.base': 'Limit must be a number',
      'number.integer': 'Limit must be an integer',
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit must not exceed 100'
    })
});

module.exports = { 
  updateProfileSchema, 
  searchSchema, 
  userParamsSchema,
  paginationSchema 
};