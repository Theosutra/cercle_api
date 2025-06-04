const jwt = require('jsonwebtoken');

class TokenService {
  /**
   * Génère les tokens d'accès et de rafraîchissement
   * @param {string} userId - ID de l'utilisateur
   * @returns {Object} - Object contenant accessToken et refreshToken
   */
  static generateTokens(userId) {
    const accessToken = jwt.sign(
      { userId },
      process.env.JWT_SECRET,
      { 
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
        issuer: 'social-network-api',
        audience: 'social-network-client'
      }
    );
    
    const refreshToken = jwt.sign(
      { userId },
      process.env.JWT_REFRESH_SECRET,
      { 
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
        issuer: 'social-network-api',
        audience: 'social-network-client'
      }
    );
    
    return { accessToken, refreshToken };
  }

  /**
   * Vérifie et décode un token de rafraîchissement
   * @param {string} token - Token de rafraîchissement
   * @returns {Object} - Payload décodé du token
   */
  static verifyRefreshToken(token) {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
      issuer: 'social-network-api',
      audience: 'social-network-client'
    });
  }

  /**
   * Vérifie et décode un token d'accès
   * @param {string} token - Token d'accès
   * @returns {Object} - Payload décodé du token
   */
  static verifyAccessToken(token) {
    return jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'social-network-api',
      audience: 'social-network-client'
    });
  }

  /**
   * Génère un nouveau token d'accès à partir d'un refresh token
   * @param {string} refreshToken - Token de rafraîchissement
   * @returns {string} - Nouveau token d'accès
   */
  static refreshAccessToken(refreshToken) {
    const decoded = this.verifyRefreshToken(refreshToken);
    const { accessToken } = this.generateTokens(decoded.userId);
    return accessToken;
  }

  /**
   * Extrait les informations du token sans vérification (pour debug)
   * @param {string} token - Token à décoder
   * @returns {Object} - Payload du token
   */
  static decodeToken(token) {
    return jwt.decode(token);
  }
}

module.exports = TokenService;