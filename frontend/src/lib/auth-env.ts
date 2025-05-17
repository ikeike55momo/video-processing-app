// Shared environment fallback values for NextAuth

export const SITE_URL =
  process.env.NEXTAUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret';

if (!process.env.NEXTAUTH_URL) {
  process.env.NEXTAUTH_URL = SITE_URL;
}

if (!process.env.NEXTAUTH_SECRET) {
  process.env.NEXTAUTH_SECRET = NEXTAUTH_SECRET;
}
