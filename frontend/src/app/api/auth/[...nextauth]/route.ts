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
        if (
          credentials?.username === "ikeike55momo@gmail.com" &&
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
