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
    // id?: string; // next-auth.d.tsのJWT拡張にidを追加。CustomAppJWTと重複する可能性があるので一旦コメントアウト。必要なら戻す。
    role?: string;
  }
}
