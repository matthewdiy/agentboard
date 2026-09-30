import { eq } from "drizzle-orm";

import { db } from "@/db";
import { documentAssets } from "@/db/schema";
import { getAssetStore } from "@/lib/blob-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const [asset] = await db
    .select()
    .from(documentAssets)
    .where(eq(documentAssets.id, id))
    .limit(1);

  if (!asset) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const bytes = await getAssetStore().get(asset.blobKey, {
      type: "arrayBuffer",
    });

    return new Response(bytes, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": asset.mimeType,
        "Content-Length": String(asset.sizeBytes),
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch {
    return new Response("Asset unavailable", { status: 404 });
  }
}
