# 📖 Documentation API Social Network - Guide Complet

## 🌐 Base URL
```
http://localhost:3000
```

## 🔧 Headers Standards
```
Content-Type: application/json
Authorization: Bearer <votre_access_token>  // Pour les routes protégées
```

---

## 🏥 SYSTÈME

### Health Check
**GET** `/health`

**Description:** Vérifier le statut de l'API

**Headers:** Aucun

**Réponse:**
```json
{
  "status": "OK",
  "timestamp": "2025-06-03T10:30:00.000Z",
  "version": "1.0.0"
}
```

---

## 🔐 AUTHENTIFICATION

### 1. Inscription
**POST** `/api/v1/auth/register`

**Description:** Créer un nouveau compte utilisateur

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "username": "john_doe",
  "mail": "john@example.com",
  "password": "password123",
  "nom": "Doe",
  "prenom": "John",
  "telephone": "+33123456789"  // Optionnel
}
```

**Réponse Success (201):**
```json
{
  "message": "User created successfully",
  "user": {
    "id_user": "cmbg8m5wx000a2rxc...",
    "username": "john_doe",
    "mail": "john@example.com",
    "nom": "Doe",
    "prenom": "John",
    "created_at": "2025-06-03T10:30:00.000Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Erreurs:**
- `400` - Données invalides
- `409` - Utilisateur existe déjà

### 2. Connexion
**POST** `/api/v1/auth/login`

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "mail": "john@example.com",
  "password": "password123"
}
```

**Réponse Success (200):**
```json
{
  "message": "Login successful",
  "user": {
    "id_user": "cmbg8m5wx000a2rxc...",
    "username": "john_doe",
    "mail": "john@example.com",
    "nom": "Doe",
    "prenom": "John",
    "role": "USER",
    "certified": false,
    "photo_profil": null
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

### 3. Rafraîchir le Token
**POST** `/api/v1/auth/refresh`

**Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Réponse:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "message": "Token refreshed successfully"
}
```

### 4. Mon Profil
**GET** `/api/v1/auth/me`

**Headers:**
```
Authorization: Bearer <access_token>
```

**Réponse:**
```json
{
  "id_user": "cmbg8m5wx000a2rxc...",
  "username": "john_doe",
  "mail": "john@example.com",
  "nom": "Doe",
  "prenom": "John",
  "bio": "Développeur passionné",
  "photo_profil": "https://...",
  "private": false,
  "certified": false,
  "role": "USER",
  "created_at": "2025-06-03T10:30:00.000Z",
  "stats": {
    "posts": 15,
    "followers": 42,
    "following": 38
  }
}
```

### 5. Changer de Mot de Passe
**POST** `/api/v1/auth/change-password`

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "currentPassword": "password123",
  "newPassword": "newPassword456"
}
```

### 6. Déconnexion
**POST** `/api/v1/auth/logout`

**Headers:**
```
Authorization: Bearer <access_token>
```

---

## 👥 UTILISATEURS

### 1. Profil d'un Utilisateur
**GET** `/api/v1/users/{id_user}`

**Exemple:** `/api/v1/users/cmbg8m5wx000a2rxc...`

**Headers:** Optionnel
```
Authorization: Bearer <access_token>
```

**Réponse:**
```json
{
  "id_user": "cmbg8m5wx000a2rxc...",
  "username": "alice_doe",
  "nom": "Doe",
  "prenom": "Alice",
  "bio": "Passionnée de technologie",
  "photo_profil": null,
  "certified": true,
  "private": false,
  "created_at": "2025-06-03T08:30:00.000Z",
  "isFollowing": false,
  "stats": {
    "posts": 8,
    "followers": 25,
    "following": 12
  }
}
```

### 2. Modifier Mon Profil
**PUT** `/api/v1/users/me`

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "bio": "Ma nouvelle bio",
  "photo_profil": "https://example.com/photo.jpg",
  "nom": "Nouveau Nom",
  "prenom": "Nouveau Prénom",
  "telephone": "+33987654321",
  "private": true
}
```

### 3. Rechercher des Utilisateurs
**GET** `/api/v1/users/search?search=alice&page=1&limit=20`

**Parameters:**
- `search` (optionnel) - Terme de recherche
- `page` (défaut: 1) - Numéro de page
- `limit` (défaut: 20, max: 50) - Nombre de résultats

**Réponse:**
```json
{
  "users": [
    {
      "id_user": "cmbg8m5wx000a2rxc...",
      "username": "alice_doe",
      "nom": "Doe",
      "prenom": "Alice",
      "bio": "Passionnée de technologie",
      "photo_profil": null,
      "certified": true,
      "private": false,
      "followerCount": 25
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  }
}
```

### 4. Utilisateurs Suggérés
**GET** `/api/v1/users/suggested?page=1&limit=10`

**Headers:**
```
Authorization: Bearer <access_token>
```

### 5. Statistiques d'un Utilisateur
**GET** `/api/v1/users/{id_user}/stats`

**Réponse:**
```json
{
  "posts": 15,
  "followers": 42,
  "following": 38,
  "likes": 156
}
```

---

## 📝 POSTS

### 1. Créer un Post
**POST** `/api/v1/posts`

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "content": "Mon premier post sur l'API ! 🚀"
}
```

**Réponse Success (201):**
```json
{
  "message": "Post created successfully",
  "post": {
    "id_post": "cmbg9n6yz000b3sxd...",
    "content": "Mon premier post sur l'API ! 🚀",
    "created_at": "2025-06-03T10:45:00.000Z",
    "updated_at": "2025-06-03T10:45:00.000Z",
    "active": true,
    "author": {
      "id_user": "cmbg8m5wx000a2rxc...",
      "username": "john_doe",
      "photo_profil": null,
      "certified": false
    },
    "isLiked": false,
    "likeCount": 0
  }
}
```

### 2. Timeline Personnalisée
**GET** `/api/v1/posts/timeline/personal?page=1&limit=20`

**Description:** Posts de vos amis + vos posts

**Headers:**
```
Authorization: Bearer <access_token>
```

### 3. Timeline Publique
**GET** `/api/v1/posts/public?page=1&limit=20`

**Description:** Posts publics de tous les utilisateurs

**Réponse:**
```json
[
  {
    "id_post": "cmbg9n6yz000b3sxd...",
    "content": "Hello world ! 🌍",
    "created_at": "2025-06-03T10:45:00.000Z",
    "author": {
      "id_user": "cmbg8m5wx000a2rxc...",
      "username": "alice_doe",
      "photo_profil": null,
      "certified": true
    },
    "isLiked": false,
    "likeCount": 5
  }
]
```

### 4. Posts Tendances
**GET** `/api/v1/posts/trending?page=1&limit=20`

**Description:** Posts populaires des dernières 24h

### 5. Rechercher des Posts
**GET** `/api/v1/posts/search?search=hello&page=1&limit=20&sortBy=created_at&order=desc`

**Parameters:**
- `search` - Terme de recherche dans le contenu
- `sortBy` - `created_at` ou `likes_count`
- `order` - `asc` ou `desc`

### 6. Posts d'un Utilisateur
**GET** `/api/v1/posts/user/{id_user}?page=1&limit=20`

### 7. Détails d'un Post
**GET** `/api/v1/posts/{id_post}`

### 8. Modifier un Post
**PUT** `/api/v1/posts/{id_post}`

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "content": "Contenu modifié du post"
}
```

### 9. Supprimer un Post
**DELETE** `/api/v1/posts/{id_post}`

**Headers:**
```
Authorization: Bearer <access_token>
```

---

## 💝 LIKES

### 1. Liker/Unliker un Post
**POST** `/api/v1/likes/posts/{id_post}`

**Headers:**
```
Authorization: Bearer <access_token>
```

**Réponse:**
```json
{
  "message": "Post liked",
  "isLiked": true,
  "likeCount": 6
}
```

### 2. Voir qui a Liké un Post
**GET** `/api/v1/likes/posts/{id_post}?page=1&limit=20`

**Réponse:**
```json
{
  "users": [
    {
      "id_user": "cmbg8m5wx000a2rxc...",
      "username": "alice_doe",
      "nom": "Doe",
      "prenom": "Alice",
      "photo_profil": null,
      "certified": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  }
}
```

### 3. Posts Likés par un Utilisateur
**GET** `/api/v1/likes/users/{id_user}/posts?page=1&limit=20`

### 4. Statistiques de Likes
**GET** `/api/v1/likes/users/{id_user}/stats`

**Réponse:**
```json
{
  "likesGiven": 45,
  "likesReceived": 78,
  "ratio": "1.73"
}
```

---

## 👥 FOLLOWS

### 1. Suivre un Utilisateur
**POST** `/api/v1/follow/{id_user}`

**Headers:**
```
Authorization: Bearer <access_token>
```

**Réponse:**
```json
{
  "message": "User followed successfully",
  "isPending": false,
  "targetUser": {
    "id_user": "cmbg8m5wx000a2rxc...",
    "username": "alice_doe"
  }
}
```

**Note:** Si le compte est privé, `isPending: true` et `message: "Follow request sent"`

### 2. Ne Plus Suivre
**DELETE** `/api/v1/follow/{id_user}`

**Headers:**
```
Authorization: Bearer <access_token>
```

### 3. Mes Followers
**GET** `/api/v1/follow/{id_user}/followers?page=1&limit=20`

### 4. Qui Je Suis
**GET** `/api/v1/follow/{id_user}/following?page=1&limit=20`

### 5. Demandes en Attente
**GET** `/api/v1/follow/requests/pending?page=1&limit=20`

**Headers:**
```
Authorization: Bearer <access_token>
```

**Réponse:**
```json
{
  "requests": [
    {
      "id_user": "cmbg8m5wx000a2rxc...",
      "username": "john_doe",
      "nom": "Doe",
      "prenom": "John",
      "photo_profil": null,
      "certified": false,
      "requestDate": "2025-06-03T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  }
}
```

### 6. Accepter une Demande
**POST** `/api/v1/follow/requests/{id_user}/accept`

**Headers:**
```
Authorization: Bearer <access_token>
```

### 7. Rejeter une Demande
**POST** `/api/v1/follow/requests/{id_user}/reject`

**Headers:**
```
Authorization: Bearer <access_token>
```

### 8. Statut de Suivi
**GET** `/api/v1/follow/status/{id_user}`

**Headers:**
```
Authorization: Bearer <access_token>
```

**Réponse:**
```json
{
  "status": "following"  // "not_following", "pending", "following", "self"
}
```

---

## 💬 MESSAGES PRIVÉS

### 1. Envoyer un Message
**POST** `/api/v1/messages`

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "receiver": "cmbg8m5wx000a2rxc...",
  "message": "Salut ! Comment ça va ?"
}
```

**Réponse Success (201):**
```json
{
  "message": "Message sent successfully",
  "data": {
    "id_message": "cmbg9p7za000c4tye...",
    "sender": "cmbh1q8ab000d5uzf...",
    "receiver": "cmbg8m5wx000a2rxc...",
    "message": "Salut ! Comment ça va ?",
    "send_at": "2025-06-03T11:00:00.000Z",
    "read_at": null,
    "active": true,
    "sender_user": {
      "id_user": "cmbh1q8ab000d5uzf...",
      "username": "john_doe",
      "photo_profil": null
    },
    "receiver_user": {
      "id_user": "cmbg8m5wx000a2rxc...",
      "username": "alice_doe",
      "photo_profil": null
    }
  }
}
```

### 2. Mes Conversations
**GET** `/api/v1/messages/conversations?page=1&limit=20`

**Headers:**
```
Authorization: Bearer <access_token>
```

**Réponse:**
```json
[
  {
    "otherUser": {
      "id_user": "cmbg8m5wx000a2rxc...",
      "username": "alice_doe",
      "photo_profil": null,
      "certified": true
    },
    "lastMessage": {
      "content": "Merci pour l'info !",
      "senderId": "cmbg8m5wx000a2rxc...",
      "timestamp": "2025-06-03T10:55:00.000Z",
      "isRead": true
    },
    "unreadCount": 0
  }
]
```

### 3. Messages avec un Utilisateur
**GET** `/api/v1/messages/{id_user}?page=1&limit=50`

**Headers:**
```
Authorization: Bearer <access_token>
```

**Réponse:**
```json
{
  "messages": [
    {
      "id_message": "cmbg9p7za000c4tye...",
      "sender": "cmbh1q8ab000d5uzf...",
      "receiver": "cmbg8m5wx000a2rxc...",
      "message": "Salut ! Comment ça va ?",
      "send_at": "2025-06-03T11:00:00.000Z",
      "read_at": "2025-06-03T11:01:00.000Z",
      "sender_user": {
        "id_user": "cmbh1q8ab000d5uzf...",
        "username": "john_doe",
        "photo_profil": null
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  }
}
```

### 4. Marquer comme Lu
**PUT** `/api/v1/messages/{id_user}/read`

**Headers:**
```
Authorization: Bearer <access_token>
```

### 5. Nombre de Messages Non Lus
**GET** `/api/v1/messages/unread-count`

**Headers:**
```
Authorization: Bearer <access_token>
```

**Réponse:**
```json
{
  "unreadCount": 3
}
```

### 6. Supprimer un Message
**DELETE** `/api/v1/messages/{id_message}`

**Headers:**
```
Authorization: Bearer <access_token>
```

---

## ❌ CODES D'ERREUR

### Codes de Statut HTTP
- `200` - OK
- `201` - Créé avec succès
- `400` - Erreur de validation
- `401` - Non authentifié
- `403` - Accès refusé
- `404` - Ressource non trouvée
- `409` - Conflit (ex: utilisateur existe déjà)
- `429` - Trop de requêtes (rate limiting)
- `500` - Erreur serveur interne

### Format des Erreurs
```json
{
  "error": "Validation failed",
  "message": "Username must be at least 3 characters long",
  "details": [...]
}
```

---

## 🧪 COMPTES DE TEST

Si vous avez lancé `npm run db:seed` :

| Email | Mot de passe | Rôle | Description |
|-------|-------------|------|-------------|
| admin@social.com | password123 | ADMIN | Administrateur |
| mod@social.com | password123 | MODERATOR | Modérateur |
| alice@example.com | password123 | USER | Utilisateur certifié |
| bob@example.com | password123 | USER | Compte public |
| charlie@example.com | password123 | USER | Compte privé |
| diana@example.com | password123 | USER | Marketing |
| eve@example.com | password123 | USER | Photographe |
| frank@example.com | password123 | USER | Entrepreneur |

---

## 🔄 WORKFLOW TYPIQUE

### 1. S'authentifier
```
POST /api/v1/auth/login
→ Récupérer accessToken
```

### 2. Voir son profil
```
GET /api/v1/auth/me
→ Headers: Authorization: Bearer <token>
```

### 3. Créer du contenu
```
POST /api/v1/posts
→ Body: {"content": "Mon post"}
```

### 4. Interagir
```
POST /api/v1/likes/posts/{id}
POST /api/v1/follow/{user_id}
```

### 5. Consulter
```
GET /api/v1/posts/public
GET /api/v1/posts/timeline/personal
```

---

## 🛠️ COMMANDES UTILES

### Développement
```bash
npm run dev          # Démarrer en mode développement
npm run db:migrate   # Lancer les migrations
npm run db:seed      # Peupler la base avec des données de test
npm run db:studio    # Interface Prisma Studio
```

### Docker
```bash
npm run docker:build  # Construire l'image
npm run docker:up     # Démarrer avec docker-compose
npm run docker:logs   # Voir les logs
npm run docker:down   # Arrêter
```

### Base de données PostgreSQL locale
```bash
# Démarrer PostgreSQL en Docker
docker run -d \
  --name social_network_postgres \
  -e POSTGRES_DB=social_network \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres123 \
  -p 5433:5432 \
  postgres:15-alpine
```

---

**🎯 Cette documentation couvre tous les endpoints disponibles de votre API Social Network !**