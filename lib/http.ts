export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function jsonNotFound(message = "Not found") {
  return jsonError(message, 404);
}
