/**
 * NextAuth Type Augmentation
 *
 * Extends the default NextAuth types to include user ID in the session.
 */

import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      image?: string | null;
      status?: string;
    };
  }
}
