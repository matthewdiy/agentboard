import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  assertAuthEnvironment: vi.fn(),
  verifyApiKey: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  assertAuthEnvironment: authMocks.assertAuthEnvironment,
  auth: {
    api: {
      verifyApiKey: authMocks.verifyApiKey,
    },
  },
}));

import {
  apiAuthErrorResponse,
  ApiAuthError,
  requireApiToken,
} from "./api-auth";

const validKey = {
  id: "key-id",
  enabled: true,
};

describe("requireApiToken", () => {
  it.each([
    [undefined, "Missing bearer token."],
    ["Basic credentials", "Missing bearer token."],
    ["Bearer", "Missing bearer token."],
    ["Bearer one two", "Missing bearer token."],
  ])("rejects malformed authorization header %s", async (authorization, message) => {
    const request = new Request("https://agentboard.example/api/v1/documents", {
      headers: authorization ? { authorization } : undefined,
    });

    await expect(requireApiToken(request, "documents:read")).rejects.toMatchObject({
      message,
      status: 401,
    });
    expect(authMocks.verifyApiKey).not.toHaveBeenCalled();
  });

  it.each([
    ["documents:read", "read"],
    ["documents:write", "write"],
  ] as const)("passes the required %s permission", async (scope, permission) => {
    authMocks.verifyApiKey.mockResolvedValueOnce({
      valid: true,
      error: null,
      key: validKey,
    });

    const result = await requireApiToken(
      new Request("https://agentboard.example/api/v1/documents", {
        headers: { authorization: "Bearer ab_test-key" },
      }),
      scope,
    );

    expect(result).toEqual(validKey);
    expect(authMocks.verifyApiKey).toHaveBeenCalledWith({
      body: {
        key: "ab_test-key",
        permissions: { documents: [permission] },
      },
    });
  });

  it.each(["KEY_NOT_FOUND", "KEY_DISABLED", "KEY_EXPIRED"])(
    "returns 401 for Better Auth error %s",
    async (code) => {
      authMocks.verifyApiKey.mockResolvedValueOnce({
        valid: false,
        error: { code },
        key: null,
      });
      authMocks.verifyApiKey.mockResolvedValueOnce({
        valid: false,
        error: { code },
        key: null,
      });

      await expect(
        requireApiToken(
          new Request("https://agentboard.example/api/v1/documents", {
            headers: { authorization: "Bearer ab_invalid" },
          }),
          "documents:read",
        ),
      ).rejects.toMatchObject({
        message: "Invalid or deleted bearer token.",
        status: 401,
      });
    },
  );

  it("returns 403 when the key is valid but lacks the required permission", async () => {
    authMocks.verifyApiKey.mockResolvedValueOnce({
      valid: false,
      error: { code: "KEY_NOT_FOUND" },
      key: null,
    });
    authMocks.verifyApiKey.mockResolvedValueOnce({
      valid: true,
      error: null,
      key: validKey,
    });

    await expect(
      requireApiToken(
        new Request("https://agentboard.example/api/v1/documents", {
          headers: { authorization: "Bearer ab_read-only" },
        }),
        "documents:write",
      ),
    ).rejects.toMatchObject({
      message: "Token does not have the required scope.",
      status: 403,
    });
  });
});

describe("apiAuthErrorResponse", () => {
  it("adds the Bearer challenge to 401 responses", async () => {
    const response = apiAuthErrorResponse(new ApiAuthError("No key.", 401));

    expect(response?.status).toBe(401);
    expect(response?.headers.get("WWW-Authenticate")).toBe('Bearer realm="agentboard"');
    await expect(response?.json()).resolves.toEqual({ error: "No key." });
  });
});
