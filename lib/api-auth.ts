import { auth, assertAuthEnvironment } from "@/lib/auth";

export type ApiScope = "documents:read" | "documents:write";

const permissionsByScope: Record<ApiScope, { documents: ("read" | "write")[] }> = {
  "documents:read": { documents: ["read"] },
  "documents:write": { documents: ["write"] },
};

export async function requireApiToken(
  request: Request,
  requiredScope: ApiScope,
) {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1];

  if (!token) {
    throw new ApiAuthError("Missing bearer token.", 401);
  }

  assertAuthEnvironment();
  const verification = await auth.api.verifyApiKey({
    body: {
      key: token,
      permissions: permissionsByScope[requiredScope],
    },
  });

  if (verification.valid && verification.key) {
    return verification.key;
  }

  // Better Auth intentionally uses the same invalid result for a missing key
  // and an insufficient permission. Verify without the permission constraint
  // only when needed so the public API can retain its 401/403 distinction.
  const validity = await auth.api.verifyApiKey({
    body: { key: token },
  });

  if (!validity.valid || !validity.key) {
    throw new ApiAuthError("Invalid or deleted bearer token.", 401);
  }

  throw new ApiAuthError("Token does not have the required scope.", 403);
}

export class ApiAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

export function apiAuthErrorResponse(error: unknown) {
  if (!(error instanceof ApiAuthError)) return null;

  return Response.json(
    { error: error.message },
    {
      status: error.status,
      headers:
        error.status === 401
          ? { "WWW-Authenticate": 'Bearer realm="agentboard"' }
          : undefined,
    },
  );
}
