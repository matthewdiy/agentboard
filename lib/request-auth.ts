import {
  ApiAuthError,
  apiAuthErrorResponse,
  requireApiToken,
  type ApiScope,
} from "@/lib/api-auth";
import {
  dashboardAuthErrorResponse,
  requireDashboardSession,
} from "@/lib/dashboard-auth";

export async function requireDocumentAccess(
  request: Request,
  scope: ApiScope,
) {
  if (request.headers.has("authorization")) {
    return {
      type: "api" as const,
      apiKey: await requireApiToken(request, scope),
    };
  }

  return {
    type: "dashboard" as const,
    session: await requireDashboardSession(request),
  };
}

export function requestAuthErrorResponse(error: unknown) {
  return apiAuthErrorResponse(error) ?? dashboardAuthErrorResponse(error);
}

export function isAuthError(error: unknown): error is ApiAuthError {
  return error instanceof ApiAuthError;
}
