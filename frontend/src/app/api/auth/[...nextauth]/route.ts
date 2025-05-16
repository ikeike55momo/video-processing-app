import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "メールアドレス", type: "email", placeholder: "email" },
        password: { label: "パスワード", type: "password", placeholder: "password" }
      },
      async authorize(credentials) {
        if (
          credentials?.email === "ikeike55momo@gmail.com" &&
          credentials?.password === "123456"
        ) {
          return { id: "1", name: "ikeike55momo", email: "ikeike55momo@gmail.com" };
        }
        return null;
        // );
        // if (user) {
        //   return { id: user.id, name: user.name };
        // }
        // return null;
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" }
});

export { handler as GET, handler as POST };
