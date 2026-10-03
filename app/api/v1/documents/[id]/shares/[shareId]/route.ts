import { jsonError } from "@/lib/http";
import {
  ShareInputError,
  deleteDocumentShare,
  revokeDocumentShare,
} from "@/lib/documents/service";
import {
  requestAuthErrorResponse,
  requireDocumentAccess,
} from "@/lib/request-auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; shareId: string }> };

/**
 * `purge` is the only flag, and it must be literally `true` when present, so a
 * malformed flag can never silently change which action runs. Revoking stays
 * the default: it is idempotent, and it keeps the record of the link.
 */
function wantsPurge(request: Request) {
  const purge = new URL(request.url).searchParams.get("purge");
  if (purge === null) return false;
  if (purge !== "true") {
    throw new ShareInputError("The purge flag must be true when provided.");
  }
  return true;
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await requireDocumentAccess(request, "documents:write");
    const { id, shareId } = await context.params;

    if (!wantsPurge(request)) {
      // Revoking an already revoked link succeeds, so a retried request is safe.
      const result = await revokeDocumentShare(id, shareId);
      if (result === "missing") return jsonError("Share link not found.", 404);

      return Response.json({ revoked: true });
    }

    const result = await deleteDocumentShare(id, shareId);
    if (result === "missing") return jsonError("Share link not found.", 404);
    if (result === "active") {
      return jsonError("Revoke the link before removing it.", 409);
    }

    return Response.json({ deleted: true });
  } catch (error) {
    const authResponse = requestAuthErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof ShareInputError) {
      return jsonError(error.message, 422);
    }
    return jsonError("Unable to update the share link.", 500);
  }
}
