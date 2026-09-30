import { assertAuthEnvironment, auth } from "@/lib/auth";

export async function requireDashboardSession(request: Request) {
  assertAuthEnvironment();
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    throw new DashboardAuthError();
  }

  return session;
}

export class DashboardAuthError extends Error {
  constructor() {
    super("You must be signed in to use this dashboard.");
    this.name = "DashboardAuthError";
  }
}

export function dashboardAuthErrorResponse(error: unknown) {
  if (!(error instanceof DashboardAuthError)) return null;
  return Response.json({ error: error.message }, { status: 401 });
}
