import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text", placeholder: "username" },
        password: { label: "Password", type: "password", placeholder: "password" }
      },
      async authorize(credentials) {
        // 固定アカウント・パスワード
        const users = [
          { id: "1", name: "ikeike55momo@gmail.com", password: "123456" },
          { id: "2", name: "wado-team@sample.com", password: "12345677" }
        ];
        const user = users.find(
          u => u.name === credentials?.username && u.password === credentials?.password
        );
        if (user) {
          return { id: user.id, name: user.name };
        }
        return null;
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" }
});

export { handler as GET, handler as POST };
