// 1. src/services/tokenService.js - Version corrigée avec durées optimales
const jwt = require('jsonwebtoken');

class TokenService {
  /**
   * Génère les tokens d'accès et de rafraîchissement avec durées optimisées
   */
  static generateTokens(userId) {
    const accessToken = jwt.sign(
      { id_user: userId },
      process.env.JWT_SECRET || 'your-secret-key',
      { 
        expiresIn: process.env.JWT_EXPIRES_IN || '1h', // ✅ CHANGÉ: 1h au lieu de 15m
        issuer: 'social-network-api',
        audience: 'social-network-client'
      }
    );
    
    const refreshToken = jwt.sign(
      { id_user: userId },
      process.env.JWT_REFRESH_SECRET || 'your-refresh-secret',
      { 
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d', // ✅ CHANGÉ: 30j au lieu de 7j
        issuer: 'social-network-api',
        audience: 'social-network-client'
      }
    );
    
    return { accessToken, refreshToken };
  }

  /**
   * Génère seulement un nouveau token d'accès (pour le refresh)
   */
  static generateAccessToken(userPayload) {
    return jwt.sign(
      userPayload,
      process.env.JWT_SECRET || 'your-secret-key',
      { 
        expiresIn: process.env.JWT_EXPIRES_IN || '1h',
        issuer: 'social-network-api',
        audience: 'social-network-client'
      }
    );
  }

  /**
   * Vérifie et décode un token de rafraîchissement
   */
  static verifyRefreshToken(token) {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET || 'your-refresh-secret', {
      issuer: 'social-network-api',
      audience: 'social-network-client'
    });
  }

  /**
   * Vérifie et décode un token d'accès
   */
  static verifyAccessToken(token) {
    return jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', {
      issuer: 'social-network-api',
      audience: 'social-network-client'
    });
  }

  /**
   * Génère un nouveau token d'accès à partir d'un refresh token
   */
  static refreshAccessToken(refreshToken) {
    const decoded = this.verifyRefreshToken(refreshToken);
    const accessToken = this.generateAccessToken({
      id_user: decoded.id_user
    });
    return accessToken;
  }

  /**
   * Extrait les informations du token sans vérification (pour debug)
   */
  static decodeToken(token) {
    return jwt.decode(token);
  }

  /**
   * ✅ NOUVEAU: Vérifie si un token est proche de l'expiration
   */
  static isTokenNearExpiry(token, thresholdMinutes = 10) {
    try {
      const decoded = this.decodeToken(token);
      const expiryTime = decoded.exp * 1000;
      const currentTime = Date.now();
      const timeUntilExpiry = expiryTime - currentTime;
      
      return timeUntilExpiry < (thresholdMinutes * 60 * 1000);
    } catch (error) {
      return true; // Si on ne peut pas décoder, considérer comme expiré
    }
  }
}

module.exports = TokenService;

// ============================================================================

// 2. .env - Variables d'environnement optimisées
/*
# ============= JWT TOKENS - DURÉES OPTIMISÉES =============
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this-in-production

# ✅ DURÉES OPTIMISÉES:
JWT_EXPIRES_IN=1h          # 1 heure au lieu de 15 minutes
JWT_REFRESH_EXPIRES_IN=30d # 30 jours au lieu de 7 jours

# ============= DATABASE =============
DATABASE_URL=postgresql://username:password@host:5432/social_network

# ============= SERVER =============
NODE_ENV=development
API_PORT=3000
FRONTEND_URL=http://localhost:5173

# ============= SECURITY =============
BCRYPT_ROUNDS=12

# ============= RATE LIMITING =============
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
*/

// ============================================================================

// 3. src/controllers/authController.js - Correction méthode refresh
class AuthController {
  /**
   * ✅ CORRECTION: Méthode refresh avec réponse consistante
   */
  static async refresh(req, res) {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(400).json({ 
          error: 'Refresh token required',
          message: 'No refresh token provided'
        });
      }

      try {
        const decoded = TokenService.verifyRefreshToken(refreshToken);
        
        const user = await prisma.user.findFirst({
          where: { 
            id_user: decoded.id_user,
            is_active: true 
          }
        });

        if (!user) {
          return res.status(401).json({ 
            error: 'Invalid token',
            message: 'User not found or inactive'
          });
        }

        // ✅ CORRECTION: Utiliser generateAccessToken au lieu de generateTokens
        const newAccessToken = TokenService.generateAccessToken({
          id_user: user.id_user,
          username: user.username,
          mail: user.mail
        });

        // ✅ AMÉLIORATION: Réponse consistante avec login
        res.json({
          accessToken: newAccessToken,
          message: 'Token refreshed successfully',
          expiresIn: 3600, // 1 heure en secondes
          user: {
            id_user: user.id_user,
            username: user.username,
            mail: user.mail,
            nom: user.nom,
            prenom: user.prenom
          }
        });

      } catch (tokenError) {
        console.error('Token verification error:', tokenError);
        return res.status(401).json({ 
          error: 'Invalid token',
          message: 'Refresh token is invalid or expired'
        });
      }
    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

// ============================================================================

// 4. src/middleware/auth.js - Amélioration avec meilleurs logs
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ 
        error: 'Access denied',
        message: 'No token provided' 
      });
    }

    // ✅ AMÉLIORATION: Meilleure gestion des erreurs de token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token expired',
          message: 'Access token has expired, please refresh'
        });
      }
      
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Token is malformed or invalid'
      });
    }
    
    const user = await prisma.user.findFirst({
      where: { 
        id_user: decoded.id_user,
        is_active: true
      },
      select: {
        id_user: true,
        username: true,
        mail: true,
        nom: true,
        prenom: true,
        photo_profil: true,
        certified: true,
        private: true,
        is_active: true
      }
    });

    if (!user) {
      return res.status(401).json({ 
        error: 'Access denied',
        message: 'User not found or inactive' 
      });
    }

    req.user = user;
    next();

  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Authentication failed'
    });
  }
};