type ErrorPayload = { error?: string };

/**
 * Fetch JSON and turn a non-2xx response into an Error carrying the API's
 * message. Abort errors still propagate so callers can ignore them.
 */
export async function apiRequest<T>(
  input: string,
  init?: RequestInit,
  fallback = "The request failed.",
): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload;
}
