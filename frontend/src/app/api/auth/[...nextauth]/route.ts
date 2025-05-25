import NextAuth, { NextAuthOptions, User as NextAuthUser, Session, Account, Profile } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
// import { PrismaAdapter } from "@auth/prisma-adapter"; // For Auth.js v5+ and not currently used
import { compare } from "bcrypt";
import prisma from "@/lib/prisma";
import { JWT } from "next-auth/jwt";
import { AdapterUser } from "next-auth/adapters";

// Session type is augmented in next-auth.d.ts

interface DemoUser {
  id: string;
  name?: string | null;
  email?: string | null;
  password?: string; 
  role: string;
  image?: string | null; 
}

const DEMO_USERS: DemoUser[] = [
  {
    id: "1",
    name: "Admin User",
    email: "admin@example.com",
    password: "$2b$10$bkXwmHx.JB2twmxQBa6Exu2JJaOVH0jbn8nVgcPtCrWZcBNRwwP..", 
    role: "ADMIN",
  },
  {
    id: "2",
    name: "Regular User",
    email: "user@example.com",
    password: "$2b$10$8OxDEuDS1WFsGiHJ5Iv3qOdQeZlW.UEQ.OqUuHCfEyqGfdC5PvJ2W", 
    role: "USER",
  },
  {
    id: "3",
    name: "Admin",
    email: "ikeike55momo@gmail.com",
    password: "$2b$10$bkXwmHx.JB2twmxQBa6Exu2JJaOVH0jbn8nVgcPtCrWZcBNRwwP..", 
    role: "ADMIN",
  },
];

// Custom JWT type that extends the base JWT from next-auth/jwt
// This will carry the properties we add in the jwt callback
interface CustomAppJWT extends JWT {
  id?: string;
  role?: string;
}

// User type returned by authorize and received by jwt callback
interface AppUser extends NextAuthUser {
  role: string;
  // id is inherited from NextAuthUser (which is an alias for User from 'next-auth')
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials: Record<string, string> | undefined): Promise<AppUser | null> {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = DEMO_USERS.find(
          (u) => u.email === credentials.email
        );

        if (!user || !user.password) { 
          return null;
        }

        const isPasswordValid = await compare(
          credentials.password,
          user.password
        );

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: user.id, // id is part of NextAuthUser, so AppUser has it
          name: user.name,
          email: user.email,
          image: user.image, 
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
    async jwt({ token, user, account, profile, trigger, isNewUser, session: jwtSession } : {
      token: JWT; 
      user?: AppUser | NextAuthUser | AdapterUser; 
      account?: Account | null; 
      profile?: Profile; 
      trigger?: "signIn" | "signUp" | "update";
      isNewUser?: boolean;
      session?: any; // session parameter for update trigger
    }): Promise<JWT> { // Return type is base JWT, we modify it
      // If it's the sign-in event and we have a user object (from authorize or OAuth)
      if (user) {
        const appUser = user as AppUser; // Assume user from authorize is AppUser
        (token as CustomAppJWT).id = appUser.id;
        if (appUser.role) {
          (token as CustomAppJWT).role = appUser.role;
        }
      }
      return token; // The token (now potentially with id and role) is passed to the session callback
    },
    async session({ session, token, user: adapterUserFromToken } : {
      session: Session; 
      token: JWT; // This token comes from the jwt callback, so it should have our custom props
      user?: AdapterUser; // This is the user from the adapter, if using one for session management
    }): Promise<Session> { 
      if (token && session.user) {
        // Cast token to CustomAppJWT to access custom properties
        const customToken = token as CustomAppJWT;
        session.user.id = customToken.id as string; 
        session.user.role = customToken.role;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
