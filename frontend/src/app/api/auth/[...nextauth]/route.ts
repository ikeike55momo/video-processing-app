import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcrypt";
import prisma from "@/lib/prisma";
import { JWT } from "next-auth/jwt";
import { Session } from "next-auth";

// 本番環境では実際のユーザーデータベースと連携する必要があります
// 現在はデモ用の固定ユーザーを使用しています
const DEMO_USERS = [
  {
    id: "1",
    name: "Admin User",
    email: "admin@example.com",
    password: "$2b$10$bkXwmHx.JB2twmxQBa6Exu2JJaOVH0jbn8nVgcPtCrWZcBNRwwP..", // "tyu28008"
    role: "ADMIN",
  },
  {
    id: "2",
    name: "Regular User",
    email: "user@example.com",
    password: "$2b$10$8OxDEuDS1WFsGiHJ5Iv3qOdQeZlW.UEQ.OqUuHCfEyqGfdC5PvJ2W", // "password"
    role: "USER",
  },
  {
    id: "3",
    name: "Admin",
    email: "ikeike55momo@gmail.com",
    password: "$2b$10$bkXwmHx.JB2twmxQBa6Exu2JJaOVH0jbn8nVgcPtCrWZcBNRwwP..", // "tyu28008"
    role: "ADMIN",
  },
];

// カスタムJWT型の定義
type CustomJWT = JWT & {
  role?: string;
};

const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // デモユーザーの検索
        const user = DEMO_USERS.find(
          (user) => user.email === credentials.email
        );

        if (!user) {
          return null;
        }

        // パスワードの検証
        const isPasswordValid = await compare(
          credentials.password,
          user.password
        );

        if (!isPasswordValid) {
          return null;
        }

        // ユーザー情報を返す（パスワードは除外）
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt" as const,
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
