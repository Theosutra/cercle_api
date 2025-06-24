// backend/src/validators/notificationValidator.js
const Joi = require('joi');

// Schéma pour la pagination
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

// Schéma pour les paramètres de notification
const notificationParamsSchema = Joi.object({
  notificationId: Joi.string().required()
});

// Schéma pour les paramètres de like notification
const likeNotificationParamsSchema = Joi.object({
  likeId: Joi.string().required()
});

// Schéma pour les paramètres de message
const messageParamsSchema = Joi.object({
  messageId: Joi.string().required()
});

module.exports = {
  paginationSchema,
  notificationParamsSchema,
  likeNotificationParamsSchema,
  messageParamsSchema
};