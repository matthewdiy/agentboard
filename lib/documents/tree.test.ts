import { describe, expect, it, vi } from "vitest";

import { DocumentPathConflictError } from "./errors";
import {
  assertPathAvailable,
  ensureFolderChain,
  findFolderId,
  pruneEmptyAncestors,
} from "./tree";
import { callsOf, queryResult, renderSql } from "./test-doubles";
import type { Database, Transaction } from "./types";

function txWith(overrides: Record<string, unknown>) {
  return overrides as unknown as Transaction;
}

describe("findFolderId", () => {
  it("returns the id of a folder at that path", async () => {
    const database = {
      select: vi.fn(() => queryResult([{ id: "folder-a" }])),
    } as unknown as Database;

    await expect(findFolderId(database, "/a")).resolves.toBe("folder-a");
  });

  it("returns null when the path holds no folder", async () => {
    const database = {
      select: vi.fn(() => queryResult([])),
    } as unknown as Database;

    await expect(findFolderId(database, "/a")).resolves.toBeNull();
  });
});

describe("assertPathAvailable", () => {
  it("rejects a path that something already occupies", async () => {
    const tx = txWith({ select: vi.fn(() => queryResult([{ id: "taken" }])) });

    await expect(assertPathAvailable(tx, "/app.md")).rejects.toThrow(
      DocumentPathConflictError,
    );
  });

  it("rejects a path nested under an existing document", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([{ id: "blocking-document" }]));
    const tx = txWith({ select });

    await expect(assertPathAvailable(tx, "/docs/app.md")).rejects.toThrow(
      DocumentPathConflictError,
    );
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("accepts a path whose ancestors are folders", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]));
    const tx = txWith({ select });

    await expect(assertPathAvailable(tx, "/docs/app.md")).resolves.toBeUndefined();
  });

  it("skips the ancestor probe for root-level paths", async () => {
    const select = vi.fn(() => queryResult([]));

    await assertPathAvailable(txWith({ select }), "/app.md");

    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe("ensureFolderChain", () => {
  it("creates each missing ancestor parent-first", async () => {
    const first = queryResult([{ id: "folder-a" }]);
    const second = queryResult([{ id: "folder-a-b" }]);
    const insert = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);

    const parentId = await ensureFolderChain(
      txWith({ insert }),
      "/a/b/c.md",
    );

    expect(parentId).toBe("folder-a-b");
    expect(insert).toHaveBeenCalledTimes(2);
    expect(callsOf(first, "values")[0]?.[0]).toEqual({
      kind: "folder",
      path: "/a",
      parentId: null,
    });
    expect(callsOf(second, "values")[0]?.[0]).toEqual({
      kind: "folder",
      path: "/a/b",
      parentId: "folder-a",
    });
  });

  it("returns null for a root-level document", async () => {
    const insert = vi.fn();

    await expect(
      ensureFolderChain(txWith({ insert }), "/app.md"),
    ).resolves.toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it("fails when an ancestor path is already a document", async () => {
    // The conditional upsert matches no row in that case, so nothing is returned.
    const insert = vi.fn(() => queryResult([]));

    await expect(
      ensureFolderChain(txWith({ insert }), "/docs/app.md"),
    ).rejects.toThrow(DocumentPathConflictError);
  });

  it("guards the conflict update and freezes updated_at", async () => {
    const insertQuery = queryResult([{ id: "folder-a" }]);
    const insert = vi.fn(() => insertQuery);

    await ensureFolderChain(txWith({ insert }), "/a/app.md");

    const conflict = callsOf(insertQuery, "onConflictDoUpdate")[0]?.[0] as {
      set: Record<string, unknown>;
      setWhere: unknown;
    };

    // Only the conflict guard keeps a document from being reused as a folder.
    const guard = renderSql(conflict.setWhere);
    expect(guard.sql).toContain('"document_nodes"."kind"');
    expect(guard.params).toContain("folder");

    // Drizzle applies $onUpdate to conflict updates, so the existing value must
    // be re-assigned or every upload would rewrite every ancestor row.
    expect(Object.keys(conflict.set)).toEqual(["path", "updatedAt"]);
    const frozen = renderSql(conflict.set.updatedAt);
    expect(frozen.sql).toContain('"document_nodes"."updated_at"');
    expect(frozen.params).toHaveLength(0);
  });
});

describe("pruneEmptyAncestors", () => {
  it("deletes empty folders and stops at the first that still has children", async () => {
    const childProbes = [queryResult([]), queryResult([{ id: "sibling" }])];
    const removals = [queryResult([{ parentId: "grandparent" }])];
    const select = vi.fn(() => childProbes.shift()!);
    const remove = vi.fn(() => removals.shift()!);

    await pruneEmptyAncestors(txWith({ select, delete: remove }), "folder-a");

    expect(select).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("keeps a folder that still has children", async () => {
    const select = vi.fn(() => queryResult([{ id: "child" }]));
    const remove = vi.fn(() => queryResult([{ parentId: null }]));

    await pruneEmptyAncestors(txWith({ select, delete: remove }), "folder-a");

    expect(remove).not.toHaveBeenCalled();
  });

  it("does nothing without a starting folder", async () => {
    const select = vi.fn();

    await pruneEmptyAncestors(txWith({ select }), null);

    expect(select).not.toHaveBeenCalled();
  });
});
