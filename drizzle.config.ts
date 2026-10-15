import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
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
    if (error instanceof MissingDatabaseConnectionError) {
      if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
      const statePath = resolve(process.cwd(), ".netlify/state.json");
      if (existsSync(statePath)) {
        try {
          const state = JSON.parse(readFileSync(statePath, "utf8"));
          if (state.dbConnectionString) {
            return state.dbConnectionString as string;
          }
        } catch {
          // ignore corrupted or unreadable state file
        }
      }
      return undefined;
    }
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
