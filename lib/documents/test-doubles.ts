import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { vi } from "vitest";

/**
 * Minimal stand-ins for Drizzle's fluent builders. Every method returns the
 * same thenable object, so a query resolves whether the code awaits it directly
 * or after any number of chained calls.
 */
type QueryDouble = Record<string, unknown> & PromiseLike<unknown[]>;

function thenable(rows: unknown[]): QueryDouble {
  const query = {} as QueryDouble;
  const chain = () => query;

  Object.assign(query, {
    from: vi.fn(chain),
    where: vi.fn(chain),
    orderBy: vi.fn(chain),
    limit: vi.fn(chain),
    for: vi.fn(chain),
    leftJoin: vi.fn(chain),
    innerJoin: vi.fn(chain),
    values: vi.fn(chain),
    set: vi.fn(chain),
    onConflictDoUpdate: vi.fn(chain),
    returning: vi.fn(chain),
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  });

  return query;
}

/** A read or write builder that resolves to `rows`. */
export function queryResult(rows: unknown[] = []) {
  return thenable(rows);
}

/** Narrows a query double to its jest-style mock for assertions. */
export function callsOf(query: unknown, method: string) {
  const fn = (query as Record<string, ReturnType<typeof vi.fn>>)[method];
  if (!fn) throw new Error(`The query double has no ${method}() call.`);
  return fn.mock.calls;
}

/**
 * Renders a Drizzle condition so tests can assert on the SQL a query actually
 * filters by, rather than only on its result.
 */
export function renderSql(clause: unknown) {
  return new PgDialect().sqlToQuery(clause as SQL);
}
