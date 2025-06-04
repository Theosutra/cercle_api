const Joi = require('joi');

// Schéma de validation pour l'inscription
const registerSchema = Joi.object({
  username: Joi.string()
    .alphanum()
    .min(3)
    .max(30)
    .required()
    .messages({
      'string.alphanum': 'Username must contain only alphanumeric characters',
      'string.min': 'Username must be at least 3 characters long',
      'string.max': 'Username must not exceed 30 characters',
      'any.required': 'Username is required'
    }),
    
  mail: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
    
  password: Joi.string()
    .min(6)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required()
    .messages({
      'string.min': 'Password must be at least 6 characters long',
      'string.max': 'Password must not exceed 128 characters',
      'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, and one number',
      'any.required': 'Password is required'
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
    })
});

// Schéma de validation pour la connexion
const loginSchema = Joi.object({
  mail: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
    
  password: Joi.string()
    .required()
    .messages({
      'any.required': 'Password is required'
    })
});

// Schéma de validation pour le rafraîchissement du token
const refreshSchema = Joi.object({
  refreshToken: Joi.string()
    .required()
    .messages({
      'any.required': 'Refresh token is required'
    })
});

// Schéma de validation pour le changement de mot de passe
const changePasswordSchema = Joi.object({
  currentPassword: Joi.string()
    .required()
    .messages({
      'any.required': 'Current password is required'
    }),
    
  newPassword: Joi.string()
    .min(6)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required()
    .messages({
      'string.min': 'New password must be at least 6 characters long',
      'string.max': 'New password must not exceed 128 characters',
      'string.pattern.base': 'New password must contain at least one lowercase letter, one uppercase letter, and one number',
      'any.required': 'New password is required'
    })
});

module.exports = { 
  registerSchema, 
  loginSchema, 
  refreshSchema, 
  changePasswordSchema 
};