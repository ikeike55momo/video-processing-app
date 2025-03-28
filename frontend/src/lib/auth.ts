import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
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
  {
    id: "4",
    name: "Wado Team",
    email: "wadoteam@example.com",
    password: "$2b$10$dD2GFKQqwf0ykTwjYLmjeOss/4Lqn3wHI52.RfbLmmBPhTESBQUbK", // "w12345677"
    role: "USER",
  },
];

// カスタムJWT型の定義
type CustomJWT = JWT & {
  role?: string;
};

// 環境変数からサイトURLを取得
const SITE_URL = process.env.NEXTAUTH_URL || 'https://vpm.ririaru-stg.cloud';

export const authOptions: NextAuthOptions = {
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

        // 認証成功
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
  callbacks: {
    // JWTにユーザー情報を追加
    jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
      }
      return token;
    },
    // セッションにユーザー情報を追加
    session({ session, token }) {
      if (token && session.user) {
        (session.user as any).role = (token as CustomJWT).role;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET || "your-secret-key-change-in-production",
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true
      }
    }
  },
  debug: process.env.NODE_ENV === 'development',
};
