const Joi = require('joi');

// Schéma de validation pour l'inscription (VERSION ASSOUPLIE)
const registerSchema = Joi.object({
  username: Joi.string()
    .alphanum()
    .min(2) // Réduit de 3 à 2 caractères
    .max(50) // Augmenté de 30 à 50 caractères
    .required()
    .messages({
      'string.alphanum': 'Username must contain only alphanumeric characters',
      'string.min': 'Username must be at least 2 characters long', // Mis à jour
      'string.max': 'Username must not exceed 50 characters', // Mis à jour
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
    .min(4) // Réduit de 6 à 4 caractères
    .max(128)
    // Suppression de la regex complexe pour un pattern plus simple
    .pattern(/^(?=.*[a-zA-Z])(?=.*\d)/) // Juste une lettre et un chiffre
    .required()
    .messages({
      'string.min': 'Password must be at least 4 characters long', // Mis à jour
      'string.max': 'Password must not exceed 128 characters',
      'string.pattern.base': 'Password must contain at least one letter and one number', // Simplifié
      'any.required': 'Password is required'
    }),
    
  nom: Joi.string()
    .max(100) // Augmenté de 50 à 100
    .optional()
    .allow('')
    .messages({
      'string.max': 'Last name must not exceed 100 characters' // Mis à jour
    }),
    
  prenom: Joi.string()
    .max(100) // Augmenté de 50 à 100
    .optional()
    .allow('')
    .messages({
      'string.max': 'First name must not exceed 100 characters' // Mis à jour
    }),
    
  telephone: Joi.string()
    .pattern(/^[\+]?[\d\s\-\(\)\.]+$/) // Ajout du point comme caractère accepté
    .max(30) // Augmenté de 20 à 30
    .optional()
    .allow('')
    .messages({
      'string.pattern.base': 'Please provide a valid phone number',
      'string.max': 'Phone number must not exceed 30 characters' // Mis à jour
    })
});

// Schéma de validation pour la connexion (INCHANGÉ)
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

// Schéma de validation pour le rafraîchissement du token (INCHANGÉ)
const refreshSchema = Joi.object({
  refreshToken: Joi.string()
    .required()
    .messages({
      'any.required': 'Refresh token is required'
    })
});

// Schéma de validation pour le changement de mot de passe (ASSOUPLI)
const changePasswordSchema = Joi.object({
  currentPassword: Joi.string()
    .required()
    .messages({
      'any.required': 'Current password is required'
    }),
    
  newPassword: Joi.string()
    .min(4) // Réduit de 6 à 4
    .max(128)
    .pattern(/^(?=.*[a-zA-Z])(?=.*\d)/) // Pattern simplifié
    .required()
    .messages({
      'string.min': 'New password must be at least 4 characters long', // Mis à jour
      'string.max': 'New password must not exceed 128 characters',
      'string.pattern.base': 'New password must contain at least one letter and one number', // Simplifié
      'any.required': 'New password is required'
    })
});

module.exports = { 
  registerSchema, 
  loginSchema, 
  refreshSchema, 
  changePasswordSchema 
};