import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  type AnyPgColumn,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const documentFormat = pgEnum("document_format", ["markdown", "html"]);
export const documentNodeKind = pgEnum("document_node_kind", [
  "folder",
  "document",
]);

const maxPathLength = 500;
const maxPathDepth = 64;

/**
 * The document tree is stored as a hybrid model: `path` is the materialized
 * path (globally unique, used for ordering and subtree prefix queries) and
 * `parentId` is the adjacency list (used for direct-child reads and referential
 * integrity). Folders and documents share one table so a path collision between
 * the two is impossible.
 *
 * Document-only payload columns are NULL for folder rows; the kind_payload
 * check keeps that invariant true in the database rather than in application
 * code. Document bodies live in `document_contents` so tree and list queries
 * never read them.
 */
export const documentNodes = pgTable(
  "document_nodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: documentNodeKind("kind").notNull(),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => documentNodes.id,
      { onDelete: "cascade" },
    ),
    path: text("path").notNull(),
    // Number of path segments. Derived, so it can never drift from `path`.
    depth: integer("depth").generatedAlwaysAs(
      sql`length(path) - length(replace(path, '/', ''))`,
    ),
    title: text("title"),
    sourceFormat: documentFormat("source_format"),
    sourceFilename: text("source_filename"),
    contentHash: text("content_hash"),
    sourceBytes: integer("source_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("document_nodes_path_unique").on(table.path),
    index("document_nodes_parent_id_path_idx").on(table.parentId, table.path),
    // List and stats queries only ever page over documents, never folders.
    index("document_nodes_document_list_idx")
      .on(table.updatedAt.desc(), table.id.desc())
      .where(sql`${table.kind} = 'document'`),
    check(
      "document_nodes_path_format",
      sql`${table.path} like '/%' and ${table.path} <> '/' and right(${table.path}, 1) <> '/' and position('//' in ${table.path}) = 0 and length(${table.path}) <= ${sql.raw(String(maxPathLength))}`,
    ),
    check(
      "document_nodes_depth_range",
      sql`${table.depth} between 1 and ${sql.raw(String(maxPathDepth))}`,
    ),
    check(
      "document_nodes_kind_payload",
      sql`(${table.kind} = 'folder' and ${table.title} is null and ${table.sourceFormat} is null and ${table.sourceFilename} is null and ${table.contentHash} is null and ${table.sourceBytes} is null) or (${table.kind} = 'document' and ${table.title} is not null and ${table.sourceFormat} is not null and ${table.sourceFilename} is not null and ${table.contentHash} is not null and ${table.sourceBytes} is not null)`,
    ),
    check(
      "document_nodes_source_bytes_nonnegative",
      sql`${table.sourceBytes} is null or ${table.sourceBytes} >= 0`,
    ),
  ],
);

export const documentContents = pgTable("document_contents", {
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => documentNodes.id, { onDelete: "cascade" }),
  sourceContent: text("source_content").notNull(),
  sanitizedHtml: text("sanitized_html").notNull(),
});

export const documentAssets = pgTable(
  "document_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => documentNodes.id, { onDelete: "cascade" }),
    sourcePath: text("source_path").notNull(),
    blobKey: text("blob_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // The leading node_id also serves asset lookups by node.
    uniqueIndex("document_assets_node_source_path_unique").on(
      table.nodeId,
      table.sourcePath,
    ),
    check("document_assets_size_bytes_nonnegative", sql`${table.sizeBytes} >= 0`),
  ],
);

/**
 * Public share links. A link is a bearer credential, so only the SHA-256 hash of
 * the token is stored: a leaked database row cannot be replayed as a URL. The
 * raw token exists once, in the create response, and is never readable again.
 *
 * No token prefix or suffix is stored, because a hash cannot reveal one and the
 * dashboard identifies a link by its creation time, expiry, and status instead.
 */
export const documentShares = pgTable(
  "document_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => documentNodes.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Revocation is an explicit event, so there is no updated_at column.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    viewCount: integer("view_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // The only lookup path for a public request.
    uniqueIndex("document_shares_token_hash_unique").on(table.tokenHash),
    index("document_shares_node_created_idx").on(
      table.nodeId,
      table.createdAt.desc(),
    ),
    check("document_shares_view_count_nonnegative", sql`${table.viewCount} >= 0`),
  ],
);

export type DocumentNode = typeof documentNodes.$inferSelect;
export type DocumentContent = typeof documentContents.$inferSelect;
export type DocumentAsset = typeof documentAssets.$inferSelect;
export type DocumentShare = typeof documentShares.$inferSelect;
