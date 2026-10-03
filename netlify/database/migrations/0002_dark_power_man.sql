ALTER TABLE "document_shares" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document_shares" ADD COLUMN "name" text;