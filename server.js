// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const logger = require('./src/utils/logger');
const errorHandler = require('./src/middleware/errorHandler');

// Import routes
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const postRoutes = require('./src/routes/postRoutes'); // ✅ Sera mis à jour avec les commentaires
const likeRoutes = require('./src/routes/likeRoutes');
const followRoutes = require('./src/routes/followRoutes');
const messageRoutes = require('./src/routes/messageRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration plus permissive pour le développement
const corsOptions = {
  origin: function (origin, callback) {
    // Permettre les requêtes sans origin (ex: applications mobiles, Postman)
    if (!origin) return callback(null, true);
    
    // Liste des origins autorisées
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
      process.env.FRONTEND_URL
    ].filter(Boolean);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS origin rejected: ${origin}`);
      callback(null, true); // Temporairement permissif en développement
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Authorization']
};

// Security middlewares
app.use(helmet({
  crossOriginEmbedderPolicy: false // Désactiver en développement si nécessaire
}));

app.use(cors(corsOptions));

// Middleware pour gérer les requêtes OPTIONS explicitement
app.options('*', cors(corsOptions));

// 🚨 RATE LIMITING - DÉSACTIVÉ EN DÉVELOPPEMENT
if (process.env.NODE_ENV === 'production') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limite en production
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);
  logger.info('✅ Rate limiting enabled for production');
} else {
  logger.info('⚠️  Rate limiting DISABLED in development mode');
}

// ✅ NOUVEAU: Rate limiting spécial pour l'auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives de connexion max
  message: {
    error: 'Too many authentication attempts',
    message: 'Please try again in 15 minutes'
  }
});

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);

// General middlewares
app.use(morgan('combined', { 
  stream: { write: message => logger.info(message.trim()) }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ✅ Logging des requêtes
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request processed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  });
  
  next();
});

// ✅ API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/posts', postRoutes); // ✅ Route mise à jour avec support commentaires
app.use('/api/v1/likes', likeRoutes);
app.use('/api/v1/follow', followRoutes);
app.use('/api/v1/messages', messageRoutes);

// ✅ Health check avec plus d'informations
app.get('/health', async (req, res) => {
  try {
    // Optionnel: Vérifier la connexion à la base de données
    // const { PrismaClient } = require('@prisma/client');
    // const prisma = new PrismaClient();
    // await prisma.$queryRaw`SELECT 1`;
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: process.uptime(),
      cors: 'enabled',
      environment: process.env.NODE_ENV || 'development',
      rateLimiting: process.env.NODE_ENV === 'production' ? 'enabled' : 'disabled'
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: 'Database connection failed'
    });
  }
});

// ✅ Root endpoint pour test
app.get('/', (req, res) => {
  res.json({
    message: 'Social Network API is running!',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    rateLimiting: process.env.NODE_ENV === 'production' ? 'enabled' : 'disabled',
    endpoints: {
      health: '/health',
      auth: '/api/v1/auth',
      users: '/api/v1/users',
      posts: '/api/v1/posts', // ✅ Support des commentaires
      likes: '/api/v1/likes',
      follow: '/api/v1/follow',
      messages: '/api/v1/messages'
    },
    // ✅ NOUVEAU: Documentation des nouvelles fonctionnalités
    features: {
      posts: {
        comments: 'Posts support replies via post_parent field',
        endpoints: [
          'POST /api/v1/posts (with optional post_parent)',
          'GET /api/v1/posts/:id/replies',
          'GET /api/v1/posts/:id/stats'
        ]
      },
      likes: {
        support: 'Posts and comments can be liked',
        endpoint: 'POST /api/v1/likes/posts/:id'
      }
    }
  });
});

// ✅ Route 404 pour les API
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
    availableEndpoints: {
      auth: '/api/v1/auth',
      users: '/api/v1/users',
      posts: '/api/v1/posts',
      likes: '/api/v1/likes',
      follow: '/api/v1/follow',
      messages: '/api/v1/messages'
    }
  });
});

// ✅ Error handling
app.use(errorHandler);
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ✅ Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// ✅ Fermeture propre
process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  try {
    // Optionnel: Fermer la connexion Prisma
    // const { PrismaClient } = require('@prisma/client');
    // const prisma = new PrismaClient();
    // await prisma.$disconnect();
    logger.info('Database disconnected');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  try {
    // Optionnel: Fermer la connexion Prisma
    // const { PrismaClient } = require('@prisma/client');
    // const prisma = new PrismaClient();
    // await prisma.$disconnect();
    logger.info('Database disconnected');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📱 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🔗 API URL: http://localhost:${PORT}`);
  
  if (process.env.NODE_ENV === 'production') {
    logger.info(`🔒 Rate limiting: ENABLED`);
  } else {
    logger.info(`🔓 Rate limiting: DISABLED (development mode)`);
  }
  
  // ✅ NOUVEAU: Log des nouvelles fonctionnalités
  logger.info(`✨ New features enabled:`);
  logger.info(`   - Comments system (via post_parent)`);
  logger.info(`   - Enhanced likes with stats`);
  logger.info(`   - Improved error handling`);
});

module.exports = app;