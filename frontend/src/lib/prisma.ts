import { PrismaClient } from '@prisma/client';

// PrismaClientのグローバルシングルトンを作成
// これにより、サーバーレス環境での不必要な接続の作成を防ぎます
const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Prismaクライアントのインスタンスをグローバルに保持
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query', 'error', 'warn'],
  });

// 開発環境でのホットリロード時に複数のPrismaClientインスタンスが作成されるのを防ぐ
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// エラーハンドリングを追加
prisma.$use(async (params, next) => {
  try {
    const result = await next(params);
    return result;
  } catch (error) {
    console.error('Prisma Error:', error);
    console.error('Query Params:', params);
    throw error;
  }
});

export default prisma;
