import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { apiKey } from "@better-auth/api-key";

import * as schema from "@/db/schema";
import { db } from "@/db";
import { getAllowedGoogleEmails, getAppUrl } from "@/lib/env";

// Better Auth is imported during `next build`; this placeholder only keeps route
// analysis possible. Every real auth entry point calls assertAuthEnvironment().
const localBuildSecret =
  "agentboard-local-build-secret-change-this-before-running-the-app";

export const auth = betterAuth({
  appName: "Agentboard",
  baseURL: getAppUrl(),
  secret: process.env.BETTER_AUTH_SECRET ?? localBuildSecret,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  user: {
    validateUserInfo: async ({ user, source }) => {
      if (source.method !== "oauth" || source.oauth?.providerId !== "google") {
        return {
          error: "google_only",
          errorDescription: "Agentboard only accepts Google accounts.",
        };
      }

      const allowedEmails = getAllowedGoogleEmails();
      if (
        allowedEmails.size === 0 ||
        !user.email ||
        !allowedEmails.has(user.email.toLowerCase())
      ) {
        return {
          error: "email_not_allowed",
          errorDescription: "This Google account is not allowed to access Agentboard.",
        };
      }
    },
  },
  trustedOrigins: [getAppUrl()],
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [
    apiKey({
      references: "user",
      defaultPrefix: "ab_",
      requireName: true,
      maximumNameLength: 80,
      startingCharactersConfig: {
        shouldStore: true,
        charactersLength: 18,
      },
      enableMetadata: false,
      rateLimit: {
        enabled: false,
      },
      keyExpiration: {
        defaultExpiresIn: null,
        disableCustomExpiresTime: true,
      },
      permissions: {
        defaultPermissions: {
          documents: ["read", "write"],
        },
      },
    }),
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;

export function assertAuthEnvironment() {
  const missing = [
    !process.env.BETTER_AUTH_SECRET && "BETTER_AUTH_SECRET",
    !process.env.GOOGLE_CLIENT_ID && "GOOGLE_CLIENT_ID",
    !process.env.GOOGLE_CLIENT_SECRET && "GOOGLE_CLIENT_SECRET",
    getAllowedGoogleEmails().size === 0 && "ALLOWED_GOOGLE_EMAILS",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required authentication environment: ${missing.join(", ")}`);
  }
}
