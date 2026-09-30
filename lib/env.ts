export function getAppUrl() {
  return (
    process.env.APP_URL ??
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function getAllowedGoogleEmails() {
  return new Set(
    (process.env.ALLOWED_GOOGLE_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowedGoogleEmail(email: unknown) {
  if (typeof email !== "string") return false;

  const allowedEmails = getAllowedGoogleEmails();
  return allowedEmails.size > 0 && allowedEmails.has(email.toLowerCase());
}

export const uploadLimits = {
  maxRequestBytes: 5 * 1024 * 1024,
  maxDocumentBytes: 4 * 1024 * 1024,
  maxAssetBytes: 4 * 1024 * 1024,
  maxAssetCount: 50,
};
