# ============= DOCKERFILE SIMPLE =============

FROM node:18-alpine

# Métadonnées
LABEL maintainer="votre-email@example.com"
LABEL description="Social Network API"
LABEL version="1.0.0"

# Installer les dépendances système nécessaires
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/cache/apk/*

# Créer un utilisateur non-root pour la sécurité
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Créer le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./
COPY prisma ./prisma/

# Installer les dépendances
RUN npm ci --only=production

# Générer le client Prisma
RUN npx prisma generate

# Copier le code source
COPY . .

# Créer les répertoires nécessaires et changer les permissions
RUN mkdir -p logs uploads && \
    chown -R nodejs:nodejs /app

# Changer vers l'utilisateur non-root
USER nodejs

# Exposer le port
EXPOSE 3000

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Commande par défaut
CMD ["npm", "start"]