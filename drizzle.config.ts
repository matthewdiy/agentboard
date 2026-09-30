import { config } from "dotenv";
import {
  getConnectionString,
  MissingDatabaseConnectionError,
} from "@netlify/database";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config({ path: ".env" });

function getDatabaseUrl() {
  try {
    return getConnectionString();
  } catch (error) {
    if (error instanceof MissingDatabaseConnectionError) return undefined;
    throw error;
  }
}

const databaseUrl = getDatabaseUrl();

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./netlify/database/migrations",
  dialect: "postgresql",
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
