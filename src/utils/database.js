const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

// Handle graceful shutdown
process.on('beforeExit', async () => {
  console.log('Disconnecting from database...');
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Gracefully shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Gracefully shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = prisma;