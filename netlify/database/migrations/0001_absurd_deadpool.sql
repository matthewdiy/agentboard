CREATE TABLE "document_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_shares_view_count_nonnegative" CHECK ("document_shares"."view_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_node_id_document_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."document_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_shares_token_hash_unique" ON "document_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "document_shares_node_created_idx" ON "document_shares" USING btree ("node_id","created_at" DESC NULLS LAST);