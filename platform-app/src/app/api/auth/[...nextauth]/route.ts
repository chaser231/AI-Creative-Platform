/**
 * NextAuth Route Handler
 *
 * Exposes /api/auth/* routes for NextAuth.js
 */

import { handlers } from "@/server/auth";

export const { GET, POST } = handlers;
