// Statusの列挙型を確認するスクリプト
const { PrismaClient } = require('@prisma/client');

async function main() {
  try {
    console.log('Prismaクライアントを初期化中...');
    const prisma = new PrismaClient();
    
    // Statusの列挙型を確認
    console.log('Statusの列挙型:');
    console.log(prisma.$type.Status);
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  }
}

main();
