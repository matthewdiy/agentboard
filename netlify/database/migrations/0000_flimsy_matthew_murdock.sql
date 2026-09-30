CREATE TYPE "public"."document_format" AS ENUM('markdown', 'html');--> statement-breakpoint
CREATE TYPE "public"."document_node_kind" AS ENUM('folder', 'document');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"source_path" text NOT NULL,
	"blob_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_assets_size_bytes_nonnegative" CHECK ("document_assets"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_contents" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"source_content" text NOT NULL,
	"sanitized_html" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "document_node_kind" NOT NULL,
	"parent_id" uuid,
	"path" text NOT NULL,
	"depth" integer GENERATED ALWAYS AS (length(path) - length(replace(path, '/', ''))) STORED,
	"title" text,
	"source_format" "document_format",
	"source_filename" text,
	"content_hash" text,
	"source_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_nodes_path_format" CHECK ("document_nodes"."path" like '/%' and "document_nodes"."path" <> '/' and right("document_nodes"."path", 1) <> '/' and position('//' in "document_nodes"."path") = 0 and length("document_nodes"."path") <= 500),
	CONSTRAINT "document_nodes_depth_range" CHECK ("document_nodes"."depth" between 1 and 64),
	CONSTRAINT "document_nodes_kind_payload" CHECK (("document_nodes"."kind" = 'folder' and "document_nodes"."title" is null and "document_nodes"."source_format" is null and "document_nodes"."source_filename" is null and "document_nodes"."content_hash" is null and "document_nodes"."source_bytes" is null) or ("document_nodes"."kind" = 'document' and "document_nodes"."title" is not null and "document_nodes"."source_format" is not null and "document_nodes"."source_filename" is not null and "document_nodes"."content_hash" is not null and "document_nodes"."source_bytes" is not null)),
	CONSTRAINT "document_nodes_source_bytes_nonnegative" CHECK ("document_nodes"."source_bytes" is null or "document_nodes"."source_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_contents" ADD CONSTRAINT "document_contents_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_nodes" ADD CONSTRAINT "document_nodes_parent_id_document_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "document_assets_node_source_path_unique" ON "document_assets" USING btree ("node_id","source_path");--> statement-breakpoint
CREATE UNIQUE INDEX "document_nodes_path_unique" ON "document_nodes" USING btree ("path");--> statement-breakpoint
CREATE INDEX "document_nodes_parent_id_path_idx" ON "document_nodes" USING btree ("parent_id","path");--> statement-breakpoint
CREATE INDEX "document_nodes_document_list_idx" ON "document_nodes" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "document_nodes"."kind" = 'document';