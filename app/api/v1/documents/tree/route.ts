import {
  DocumentListInputError,
  getDocumentTree,
} from "@/lib/documents/service";
import { jsonError } from "@/lib/http";
import {
  requestAuthErrorResponse,
  requireDocumentAccess,
} from "@/lib/request-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireDocumentAccess(request, "documents:read");
    const searchParams = new URL(request.url).searchParams;
    const rawLimit = searchParams.get("limit");
    const tree = await getDocumentTree(
      searchParams.get("parent") ?? "/",
      {
        limit: rawLimit ? Number(rawLimit) : undefined,
        cursor: searchParams.get("cursor") ?? undefined,
      },
    );
    return Response.json(tree);
  } catch (error) {
    const authResponse = requestAuthErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof DocumentListInputError) {
      return jsonError(error.message, 422);
    }
    return jsonError("Unable to list the document tree.", 500);
  }
}
