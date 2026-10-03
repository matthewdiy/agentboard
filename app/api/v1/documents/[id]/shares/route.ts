import { jsonError } from "@/lib/http";
import {
  ShareInputError,
  type ShareExpiryInput,
  createDocumentShare,
  getDocumentSummary,
  listDocumentShares,
  normalizeShareExpiry,
  normalizeShareName,
} from "@/lib/documents/service";
import {
  requestAuthErrorResponse,
  requireDocumentAccess,
} from "@/lib/request-auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireDocumentAccess(request, "documents:read");
    const { id } = await context.params;

    // Listing is document-scoped, so an unknown document is a 404 rather than
    // an empty list that implies the document exists.
    const document = await getDocumentSummary(id);
    if (!document) return jsonError("Document not found.", 404);

    return Response.json({ shares: await listDocumentShares(id) });
  } catch (error) {
    const authResponse = requestAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError("Unable to list share links.", 500);
  }
}

type ShareRequestBody = ShareExpiryInput & { name?: unknown };

/**
 * The name is optional and the expiry is required, so a body that is not an
 * object is rejected here rather than producing a misleading expiry error.
 */
function readShareInput(body: unknown): {
  name: string | null;
  expiresAt: Date | null;
} {
  if (typeof body !== "object" || body === null) {
    throw new ShareInputError(
      "A share link expiry or neverExpires flag is required.",
    );
  }

  const { name, expiresInSeconds, expiresAt, neverExpires } =
    body as ShareRequestBody;

  return {
    name: normalizeShareName(name),
    expiresAt: normalizeShareExpiry({
      expiresInSeconds,
      expiresAt,
      neverExpires,
    }),
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    await requireDocumentAccess(request, "documents:write");
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("The request body must be valid JSON.", 422);
    }

    const created = await createDocumentShare(id, readShareInput(body));
    if (!created) return jsonError("Document not found.", 404);

    // This is the only response that ever carries the raw token.
    return Response.json(created, { status: 201 });
  } catch (error) {
    const authResponse = requestAuthErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof ShareInputError) {
      return jsonError(error.message, 422);
    }
    return jsonError("Unable to create a share link.", 500);
  }
}
