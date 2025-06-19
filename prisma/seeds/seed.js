const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  try {
    // ✅ CORRECTION : Supprimer dans l'ordre inverse des dépendances
    console.log('🧹 Cleaning existing data...');
    
    // Supprimer les tables de liaison en premier
    await prisma.$executeRaw`DELETE FROM cercle.post_tags;`;
    await prisma.$executeRaw`DELETE FROM cercle.img_vid_post;`;
    await prisma.$executeRaw`DELETE FROM cercle.img_vid_msg;`;
    await prisma.$executeRaw`DELETE FROM cercle.likes;`;
    await prisma.$executeRaw`DELETE FROM cercle.mentions;`;
    await prisma.$executeRaw`DELETE FROM cercle.report;`;
    await prisma.$executeRaw`DELETE FROM cercle.follow;`;
    await prisma.$executeRaw`DELETE FROM cercle.user_bannissements;`;
    await prisma.$executeRaw`DELETE FROM cercle.messages_prives;`;
    
    // Ensuite les tables principales
    await prisma.$executeRaw`DELETE FROM cercle.post;`;
    await prisma.$executeRaw`DELETE FROM cercle.user_preferences;`;
    await prisma.$executeRaw`DELETE FROM cercle.users;`;
    
    // Enfin les tables de référence
    await prisma.$executeRaw`DELETE FROM cercle.roles;`;
    await prisma.$executeRaw`DELETE FROM cercle.tags;`;
    await prisma.$executeRaw`DELETE FROM cercle.message_type;`;
    await prisma.$executeRaw`DELETE FROM cercle.type_media;`;
    await prisma.$executeRaw`DELETE FROM cercle.themes;`;
    await prisma.$executeRaw`DELETE FROM cercle.langues;`;

    console.log('🧹 Cleaned existing data');

    // 1. Créer les rôles
    const roles = await Promise.all([
      prisma.role.create({
        data: { role: 'ADMIN' }
      }),
      prisma.role.create({
        data: { role: 'MODERATOR' }
      }),
      prisma.role.create({
        data: { role: 'USER' }
      })
    ]);

    console.log('✅ Created roles');

    // 2. Créer les utilisateurs
    const saltRounds = 12;
    const defaultPassword = await bcrypt.hash('password123', saltRounds);
    const currentDate = new Date();

    const users = await Promise.all([
      // Admin
      prisma.user.create({
        data: {
          username: 'admin',
          mail: 'admin@social.com',
          password_hash: defaultPassword,
          nom: 'Administrator',
          prenom: 'System',
          bio: 'Administrateur du réseau social',
          certified: true,
          private: false,
          is_active: true,
          created_at: currentDate,
          updated_at: currentDate,
          id_role: roles[0].id_role // ADMIN
        }
      }),
      // Modérateur
      prisma.user.create({
        data: {
          username: 'moderator',
          mail: 'mod@social.com',
          password_hash: defaultPassword,
          nom: 'Moderator',
          prenom: 'Team',
          bio: 'Modérateur du contenu',
          certified: true,
          private: false,
          is_active: true,
          created_at: currentDate,
          updated_at: currentDate,
          id_role: roles[1].id_role // MODERATOR
        }
      }),
      // Utilisateurs normaux
      prisma.user.create({
        data: {
          username: 'alice_doe',
          mail: 'alice@example.com',
          password_hash: defaultPassword,
          nom: 'Doe',
          prenom: 'Alice',
          bio: 'Passionnée de technologie et de voyages ✈️',
          certified: true,
          private: false,
          is_active: true,
          created_at: currentDate,
          updated_at: currentDate,
          id_role: roles[2].id_role // USER
        }
      }),
      prisma.user.create({
        data: {
          username: 'bob_martin',
          mail: 'bob@example.com',
          password_hash: defaultPassword,
          nom: 'Martin',
          prenom: 'Bob',
          bio: 'Développeur web full-stack 💻',
          private: false,
          certified: false,
          is_active: true,
          created_at: currentDate,
          updated_at: currentDate,
          id_role: roles[2].id_role // USER
        }
      }),
      prisma.user.create({
        data: {
          username: 'charlie_smith',
          mail: 'charlie@example.com',
          password_hash: defaultPassword,
          nom: 'Smith',
          prenom: 'Charlie',
          bio: 'Designer UI/UX créatif 🎨',
          private: true,
          certified: false,
          is_active: true,
          created_at: currentDate,
          updated_at: currentDate,
          id_role: roles[2].id_role // USER
        }
      })
    ]);

    console.log('✅ Created users');

    // 3. Afficher les statistiques finales
    const stats = {
      roles: await prisma.role.count(),
      users: await prisma.user.count()
    };

    console.log('\n📊 Database seeding completed!');
    console.log('Statistics:');
    console.log(`- Roles: ${stats.roles}`);
    console.log(`- Users: ${stats.users}`);

    console.log('\n👥 Test accounts created:');
    console.log('- admin@social.com (ADMIN) - password: password123');
    console.log('- mod@social.com (MODERATOR) - password: password123');
    console.log('- alice@example.com (USER) - password: password123');
    console.log('- bob@example.com (USER) - password: password123');
    console.log('- charlie@example.com (USER) - password: password123');

  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });