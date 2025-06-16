// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
// const helmet = require('helmet'); // Optionnel - installer avec npm install helmet
// const compression = require('compression'); // Optionnel - installer avec npm install compression

// Import des routes existantes
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const postRoutes = require('./src/routes/postRoutes'); 
const likeRoutes = require('./src/routes/likeRoutes');
const followRoutes = require('./src/routes/followRoutes');
const messageRoutes = require('./src/routes/messageRoutes');

// Import des middlewares existants
const errorHandler = require('./src/middleware/errorHandler');
const logger = require('./src/utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Configuration CORS améliorée mais simple
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      process.env.FRONTEND_URL
    ].filter(Boolean);
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count']
};

// Security & Performance middlewares (optionnels)
// app.use(helmet({
//   crossOriginEmbedderPolicy: false,
//   contentSecurityPolicy: false // Désactiver pour le développement
// }));
// app.use(compression());
app.use(cors(corsOptions));

// ✅ Rate limiting conditionnel - SIMPLIFIÉ
if (process.env.NODE_ENV === 'production') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: {
      error: 'Too many requests',
      message: 'Please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);
  logger.info('✅ Rate limiting enabled for production');
} else {
  logger.info('⚠️  Rate limiting DISABLED in development mode');
}

// ✅ NOUVEAU: Rate limiting spécial pour l'auth (plus restrictif)
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

// ✅ Logging des requêtes (optionnel mais utile pour debug)
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request processed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });
  
  next();
});

// ✅ API Routes - UTILISATION DE VOS ROUTES EXISTANTES
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/posts', postRoutes); // ✅ Maintenant compatible avec votre PostController
app.use('/api/v1/likes', likeRoutes); // ✅ Routes likes corrigées  
app.use('/api/v1/follow', followRoutes);
app.use('/api/v1/messages', messageRoutes);

// ✅ Health check simple
app.get('/health', async (req, res) => {
  try {
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// ✅ Root endpoint pour test
app.get('/', (req, res) => {
  res.json({
    message: 'Social Network API is running!',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: '/health',
      auth: '/api/v1/auth',
      users: '/api/v1/users',
      posts: '/api/v1/posts', // ✅ Support des commentaires via post_parent
      likes: '/api/v1/likes', // ✅ Routes corrigées
      follow: '/api/v1/follow',
      messages: '/api/v1/messages'
    },
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

// ✅ Gestion des erreurs non capturées (importante pour la stabilité)
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
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
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
  
  logger.info(`✨ Features enabled:`);
  logger.info(`   - Comments system (via post_parent)`);
  logger.info(`   - Enhanced likes with corrected routes`);
  logger.info(`   - Compatible with existing controllers`);
});

module.exports = app;