import { DocumentInputError, parseDocumentUpload } from "@/lib/documents/processing";
import {
  DocumentListInputError,
  DocumentPathConflictError,
  createDocument,
  listDocuments,
} from "@/lib/documents/service";
import { DocumentPathError } from "@/lib/documents/paths";
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
    const result = await listDocuments({
      query: searchParams.get("q") ?? undefined,
      limit: rawLimit ? Number(rawLimit) : undefined,
      cursor: searchParams.get("cursor") ?? undefined,
    });

    return Response.json(result);
  } catch (error) {
    const authResponse = requestAuthErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof DocumentListInputError) {
      return jsonError(error.message, 422);
    }
    return jsonError("Unable to list documents.", 500);
  }
}

export async function POST(request: Request) {
  try {
    await requireDocumentAccess(request, "documents:write");
    const document = await createDocument(
      await parseDocumentUpload(await request.formData()),
    );

    return Response.json({ document }, { status: 201 });
  } catch (error) {
    const authResponse = requestAuthErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof DocumentPathConflictError) {
      return jsonError(error.message, 409);
    }
    if (error instanceof DocumentPathError) {
      return jsonError(error.message, 422);
    }
    if (error instanceof DocumentInputError) {
      return jsonError(error.message, 422);
    }
    return jsonError("Unable to create document.", 500);
  }
}
