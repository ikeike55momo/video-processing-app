import "next-auth";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  /**
   * セッションユーザーの型を拡張して id と role プロパティを追加
   */
  interface Session {
    user: {
      id: string;
      role?: string;
    } & DefaultSession["user"];
  }

  /**
   * ユーザーの型を拡張して role プロパティを追加
   */
  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  /**
   * JWT トークンの型を拡張して role プロパティを追加
   */
  interface JWT {
    role?: string;
  }
}
