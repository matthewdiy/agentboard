import {
  getConnectionString,
  MissingDatabaseConnectionError,
} from "@netlify/database";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";

function readDatabaseUrl() {
  try {
    return getConnectionString();
  } catch (error) {
    if (error instanceof MissingDatabaseConnectionError) return undefined;
    throw error;
  }
}

function createUnavailablePool() {
  const missingDatabase = () => {
    throw new MissingDatabaseConnectionError();
  };

  return { connect: missingDatabase, query: missingDatabase } as unknown as Pool;
}

const databaseUrl = readDatabaseUrl();

declare global {
  var agentboardPool: Pool | undefined;
}

const pool =
  globalThis.agentboardPool ??
  (databaseUrl
    ? new Pool({
        connectionString: databaseUrl,
        max: process.env.NODE_ENV === "production" ? 3 : 5,
      })
    : createUnavailablePool());

if (process.env.NODE_ENV !== "production") {
  globalThis.agentboardPool = pool;
}

export const db = drizzle(pool, { schema });
