import { DocumentInputError, parseDocumentUpload } from "@/lib/documents/processing";
import {
  type DocumentChanges,
  DocumentPathConflictError,
  deleteDocument,
  getDocument,
  replaceDocument,
  updateDocument,
} from "@/lib/documents/service";
import { DocumentPathError } from "@/lib/documents/paths";
import { jsonError } from "@/lib/http";
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
    const document = await getDocument(id);
    if (!document) return jsonError("Document not found.", 404);
    return Response.json({ document });
  } catch (error) {
    const authResponse = requestAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError("Unable to read document.", 500);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    await requireDocumentAccess(request, "documents:write");
    const { id } = await context.params;
    const document = await replaceDocument(
      id,
      await parseDocumentUpload(await request.formData()),
    );
    if (!document) return jsonError("Document not found.", 404);
    return Response.json({ document });
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
    return jsonError("Unable to replace document.", 500);
  }
}

function readChanges(body: unknown): DocumentChanges {
  if (typeof body !== "object" || body === null) {
    throw new DocumentInputError("A document path or title is required.");
  }

  const { path, title } = body as { path?: unknown; title?: unknown };
  if (path === undefined && title === undefined) {
    throw new DocumentInputError("A document path or title is required.");
  }
  if (path !== undefined && typeof path !== "string") {
    throw new DocumentInputError("The document path must be a string.");
  }
  if (title !== undefined && typeof title !== "string") {
    throw new DocumentInputError("The document title must be a string.");
  }

  return { path, title };
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireDocumentAccess(request, "documents:write");
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("The request body must be valid JSON.", 422);
    }

    const document = await updateDocument(id, readChanges(body));
    if (!document) return jsonError("Document not found.", 404);
    return Response.json({ document });
  } catch (error) {
    const authResponse = requestAuthErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof DocumentPathConflictError) {
      return jsonError(error.message, 409);
    }
    if (error instanceof DocumentPathError || error instanceof DocumentInputError) {
      return jsonError(error.message, 422);
    }
    return jsonError("Unable to update document.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await requireDocumentAccess(request, "documents:write");
    const { id } = await context.params;
    const deleted = await deleteDocument(id);
    if (!deleted) return jsonError("Document not found.", 404);
    return Response.json({ deleted: true });
  } catch (error) {
    const authResponse = requestAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError("Unable to delete document.", 500);
  }
}
