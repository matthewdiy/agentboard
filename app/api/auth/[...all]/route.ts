import { toNextJsHandler } from "better-auth/next-js";

import { assertAuthEnvironment, auth } from "@/lib/auth";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);

async function guarded(
  handler: (request: Request) => Promise<Response>,
  request: Request,
) {
  try {
    assertAuthEnvironment();
    return await handler(request);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Authentication is not configured." },
      { status: 500 },
    );
  }
}

export const GET = (request: Request) => guarded(handlers.GET, request);
export const POST = (request: Request) => guarded(handlers.POST, request);
export const PATCH = (request: Request) => guarded(handlers.PATCH, request);
export const PUT = (request: Request) => guarded(handlers.PUT, request);
export const DELETE = (request: Request) => guarded(handlers.DELETE, request);
