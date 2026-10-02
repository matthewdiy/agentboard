import { jsonError } from "@/lib/http";
import { revokeDocumentShare } from "@/lib/documents/service";
import {
  requestAuthErrorResponse,
  requireDocumentAccess,
} from "@/lib/request-auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; shareId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await requireDocumentAccess(request, "documents:write");
    const { id, shareId } = await context.params;

    // Revoking an already revoked link succeeds, so a retried request is safe.
    const result = await revokeDocumentShare(id, shareId);
    if (result === "missing") return jsonError("Share link not found.", 404);

    return Response.json({ revoked: true });
  } catch (error) {
    const authResponse = requestAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError("Unable to revoke the share link.", 500);
  }
}
