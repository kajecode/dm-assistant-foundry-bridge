/**
 * Unit tests for the HTTP client + semver comparator.
 *
 * No Foundry harness needed — these test pure functions. The
 * settings-registration / hook plumbing is integration-level and
 * lives behind a Foundry dev-world smoke test, not in this file.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ApiError, compareSemver, fetchHealth } from "../src/api/client.js";

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
  });

  it("compares major before minor before patch", () => {
    expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
    expect(compareSemver("0.2.0", "0.1.99")).toBe(1);
    expect(compareSemver("0.1.2", "0.1.1")).toBe(1);
  });

  it("returns -1 when the first is lower", () => {
    expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
    expect(compareSemver("0.0.0", "0.1.0")).toBe(-1);
  });

  it("treats missing trailing components as zero", () => {
    // The contract pins X.Y.Z so this is defensive — but if someone
    // ever ships "1.2" by mistake, we don't want a NaN comparison.
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
  });
});

describe("fetchHealth", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hits /foundry/health?role=dm and returns the parsed body", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status:               "ok",
          api_contract_version: "0.1.0",
          dm_assistant_version: "0.21.0",
          deprecations:         [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await fetchHealth({ baseUrl: "http://example/" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://example/foundry/health?role=dm",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
    expect(result.api_contract_version).toBe("0.1.0");
  });

  it("strips trailing slashes from the base URL", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "ok", api_contract_version: "0.1.0", dm_assistant_version: "x", deprecations: [] }),
        { status: 200 },
      ),
    );
    await fetchHealth({ baseUrl: "http://example///" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://example/foundry/health?role=dm",
      expect.anything(),
    );
  });

  it("sends X-API-Key when apiKey is non-empty", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "ok", api_contract_version: "0.1.0", dm_assistant_version: "x", deprecations: [] }),
        { status: 200 },
      ),
    );
    await fetchHealth({ baseUrl: "http://x", apiKey: "secret" });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-API-Key": "secret" }),
      }),
    );
  });

  it("does NOT send X-API-Key when apiKey is empty", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "ok", api_contract_version: "0.1.0", dm_assistant_version: "x", deprecations: [] }),
        { status: 200 },
      ),
    );
    await fetchHealth({ baseUrl: "http://x", apiKey: "" });
    const args = fetchSpy.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(args.headers["X-API-Key"]).toBeUndefined();
  });

  it("throws ApiError with status on non-2xx response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    await expect(fetchHealth({ baseUrl: "http://x" })).rejects.toMatchObject({
      name:   "ApiError",
      status: 503,
    });
  });

  it("throws ApiError when the response is missing api_contract_version", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    await expect(fetchHealth({ baseUrl: "http://x" })).rejects.toThrow(ApiError);
  });

  it("throws ApiError when baseUrl is empty", async () => {
    await expect(fetchHealth({ baseUrl: "   " })).rejects.toThrow(/empty/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("wraps network errors as ApiError", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(fetchHealth({ baseUrl: "http://x" })).rejects.toMatchObject({
      name:    "ApiError",
      message: expect.stringContaining("Failed to fetch"),
    });
  });
});
