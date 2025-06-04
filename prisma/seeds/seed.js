const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  try {
    // Nettoyer les données existantes (dans l'ordre des dépendances)
    await prisma.like.deleteMany();
    await prisma.follow.deleteMany();
    await prisma.message.deleteMany();
    await prisma.post.deleteMany();
    await prisma.user.deleteMany();
    await prisma.role.deleteMany();

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
          private: true, // Compte privé
          id_role: roles[2].id_role // USER
        }
      }),
      prisma.user.create({
        data: {
          username: 'diana_wilson',
          mail: 'diana@example.com',
          password_hash: defaultPassword,
          nom: 'Wilson',
          prenom: 'Diana',
          bio: 'Marketing digital et réseaux sociaux 📱',
          id_role: roles[2].id_role // USER
        }
      }),
      prisma.user.create({
        data: {
          username: 'eve_brown',
          mail: 'eve@example.com',
          password_hash: defaultPassword,
          nom: 'Brown',
          prenom: 'Eve',
          bio: 'Photographe professionnelle 📸',
          id_role: roles[2].id_role // USER
        }
      }),
      prisma.user.create({
        data: {
          username: 'frank_davis',
          mail: 'frank@example.com',
          password_hash: defaultPassword,
          nom: 'Davis',
          prenom: 'Frank',
          bio: 'Entrepreneur et investisseur 💼',
          id_role: roles[2].id_role // USER
        }
      })
    ]);

    console.log('✅ Created users');

    // 3. Créer des relations de suivi
    const follows = await Promise.all([
      // Alice suit Bob
      prisma.follow.create({
        data: {
          follower: users[2].id_user, // Alice
          account: users[3].id_user,  // Bob
          pending: false
        }
      }),
      // Bob suit Alice
      prisma.follow.create({
        data: {
          follower: users[3].id_user, // Bob
          account: users[2].id_user,  // Alice
          pending: false
        }
      }),
      // Diana suit Alice
      prisma.follow.create({
        data: {
          follower: users[5].id_user, // Diana
          account: users[2].id_user,  // Alice
          pending: false
        }
      }),
      // Eve demande à suivre Charlie (compte privé)
      prisma.follow.create({
        data: {
          follower: users[6].id_user, // Eve
          account: users[4].id_user,  // Charlie
          pending: true // En attente car compte privé
        }
      }),
      // Frank suit Diana
      prisma.follow.create({
        data: {
          follower: users[7].id_user, // Frank
          account: users[5].id_user,  // Diana
          pending: false
        }
      }),
      // Alice suit Diana
      prisma.follow.create({
        data: {
          follower: users[2].id_user, // Alice
          account: users[5].id_user,  // Diana
          pending: false
        }
      })
    ]);

    console.log('✅ Created follow relationships');

    // 4. Créer des posts
    const posts = await Promise.all([
      // Posts d'Alice
      prisma.post.create({
        data: {
          content: "Salut tout le monde ! Ravi de rejoindre ce nouveau réseau social 🎉",
          id_user: users[2].id_user
        }
      }),
      prisma.post.create({
        data: {
          content: "Magnifique coucher de soleil aujourd'hui ! La nature est vraiment apaisante 🌅",
          id_user: users[2].id_user
        }
      }),
      // Posts de Bob
      prisma.post.create({
        data: {
          content: "Nouveau projet en cours : développement d'une API REST avec Node.js et PostgreSQL 💻 #dev #nodejs",
          id_user: users[3].id_user
        }
      }),
      prisma.post.create({
        data: {
          content: "Tips du jour : n'oubliez pas de commiter régulièrement vos changements ! Git est votre ami 🔧",
          id_user: users[3].id_user
        }
      }),
      // Posts de Charlie (compte privé)
      prisma.post.create({
        data: {
          content: "Nouvelle création en cours... Hâte de vous montrer le résultat final ! 🎨",
          id_user: users[4].id_user
        }
      }),
      // Posts de Diana
      prisma.post.create({
        data: {
          content: "Les réseaux sociaux évoluent constamment. Il faut s'adapter aux nouvelles tendances ! 📈",
          id_user: users[5].id_user
        }
      }),
      prisma.post.create({
        data: {
          content: "Stratégie marketing 2024 : l'authenticité avant tout. Les utilisateurs veulent du vrai contenu 💯",
          id_user: users[5].id_user
        }
      }),
      // Posts d'Eve
      prisma.post.create({
        data: {
          content: "Session photo en studio aujourd'hui. L'éclairage naturel reste mon préféré ✨",
          id_user: users[6].id_user
        }
      }),
      // Posts de Frank
      prisma.post.create({
        data: {
          content: "L'innovation technologique ouvre de nouvelles opportunités d'investissement 🚀",
          id_user: users[7].id_user
        }
      }),
      prisma.post.create({
        data: {
          content: "Rencontre inspirante avec une startup prometteuse. L'avenir s'annonce brillant ! 💡",
          id_user: users[7].id_user
        }
      })
    ]);

    console.log('✅ Created posts');

    // 5. Créer des likes
    const likes = await Promise.all([
      // Alice like le post de Bob
      prisma.like.create({
        data: {
          id_user: users[2].id_user, // Alice
          id_post: posts[2].id_post  // Post de Bob sur Node.js
        }
      }),
      // Bob like le post d'Alice
      prisma.like.create({
        data: {
          id_user: users[3].id_user, // Bob
          id_post: posts[0].id_post  // Premier post d'Alice
        }
      }),
      // Diana like plusieurs posts
      prisma.like.create({
        data: {
          id_user: users[5].id_user, // Diana
          id_post: posts[0].id_post  // Post d'Alice
        }
      }),
      prisma.like.create({
        data: {
          id_user: users[5].id_user, // Diana
          id_post: posts[2].id_post  // Post de Bob
        }
      }),
      // Frank like les posts business
      prisma.like.create({
        data: {
          id_user: users[7].id_user, // Frank
          id_post: posts[5].id_post  // Post de Diana sur le marketing
        }
      }),
      // Eve like le post d'Alice sur la nature
      prisma.like.create({
        data: {
          id_user: users[6].id_user, // Eve
          id_post: posts[1].id_post  // Post d'Alice sur le coucher de soleil
        }
      })
    ]);

    console.log('✅ Created likes');

    // 6. Créer quelques messages privés
    const messages = await Promise.all([
      // Conversation Alice - Bob
      prisma.message.create({
        data: {
          sender: users[2].id_user,    // Alice
          receiver: users[3].id_user,  // Bob
          message: "Salut Bob ! J'ai vu ton post sur Node.js, très intéressant !"
        }
      }),
      prisma.message.create({
        data: {
          sender: users[3].id_user,    // Bob
          receiver: users[2].id_user,  // Alice
          message: "Merci Alice ! Si tu veux des conseils sur le développement, n'hésite pas 😊"
        }
      }),
      // Diana écrit à Alice
      prisma.message.create({
        data: {
          sender: users[5].id_user,    // Diana
          receiver: users[2].id_user,  // Alice
          message: "Hello ! Ton contenu sur les voyages m'intéresse beaucoup. On pourrait collaborer ?"
        }
      })
    ]);

    console.log('✅ Created messages');

    // 7. Afficher les statistiques finales
    const stats = {
      roles: await prisma.role.count(),
      users: await prisma.user.count(),
      posts: await prisma.post.count(),
      follows: await prisma.follow.count(),
      likes: await prisma.like.count(),
      messages: await prisma.message.count()
    };

    console.log('\n📊 Database seeding completed!');
    console.log('Statistics:');
    console.log(`- Roles: ${stats.roles}`);
    console.log(`- Users: ${stats.users}`);
    console.log(`- Posts: ${stats.posts}`);
    console.log(`- Follows: ${stats.follows}`);
    console.log(`- Likes: ${stats.likes}`);
    console.log(`- Messages: ${stats.messages}`);

    console.log('\n👥 Test accounts created:');
    console.log('- admin@social.com (Admin)');
    console.log('- mod@social.com (Moderator)');
    console.log('- alice@example.com (User - Certified)');
    console.log('- bob@example.com (User - Public)');
    console.log('- charlie@example.com (User - Private)');
    console.log('- diana@example.com (User)');
    console.log('- eve@example.com (User)');
    console.log('- frank@example.com (User)');
    console.log('\n🔑 Default password for all accounts: password123');

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