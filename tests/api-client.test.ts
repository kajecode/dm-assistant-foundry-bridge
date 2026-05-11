/**
 * Unit tests for the HTTP client + semver comparator.
 *
 * No Foundry harness needed — these test pure functions. The
 * settings-registration / hook plumbing is integration-level and
 * lives behind a Foundry dev-world smoke test, not in this file.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  compareSemver,
  fetchHealth,
  fetchImageBytes,
  fetchNpc,
  listNpcs,
} from "../src/api/client.js";

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

  it("throws ApiError with kind=http and status on non-2xx response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    await expect(fetchHealth({ baseUrl: "http://x" })).rejects.toMatchObject({
      name:   "ApiError",
      kind:   "http",
      status: 503,
    });
  });

  it("throws ApiError with kind=shape when the response is missing api_contract_version", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    await expect(fetchHealth({ baseUrl: "http://x" })).rejects.toMatchObject({
      name: "ApiError",
      kind: "shape",
    });
  });

  it("throws ApiError with kind=config when baseUrl is empty", async () => {
    await expect(fetchHealth({ baseUrl: "   " })).rejects.toMatchObject({
      name: "ApiError",
      kind: "config",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("wraps TypeError (CORS / unreachable / mixed-content) as kind=network", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(fetchHealth({ baseUrl: "http://x" })).rejects.toMatchObject({
      name:    "ApiError",
      kind:    "network",
      message: expect.stringContaining("Failed to fetch"),
    });
  });
});

describe("fetchNpc", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hits /foundry/npc/{slug} with campaign_id + role=dm", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          slug:         "aldric-harwick",
          kind:         "npc",
          name:         "Aldric",
          display_name: "Aldric",
          portrait_url: null,
          thumb_url:    null,
          front_matter: {},
          sections:     [],
          dm_sections:  [],
          audit:        { source_path: "p", modified_at: "t" },
        }),
        { status: 200 },
      ),
    );
    const r = await fetchNpc({
      baseUrl:    "http://api/",
      campaignId: "c",
      slug:       "aldric-harwick",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://api/foundry/npc/aldric-harwick?campaign_id=c&role=dm",
      expect.anything(),
    );
    expect(r.slug).toBe("aldric-harwick");
  });

  it("rejects with kind=config when campaignId is empty", async () => {
    await expect(
      fetchNpc({ baseUrl: "http://x", campaignId: "", slug: "s" }),
    ).rejects.toMatchObject({ kind: "config" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects with kind=config when slug is empty", async () => {
    await expect(
      fetchNpc({ baseUrl: "http://x", campaignId: "c", slug: "" }),
    ).rejects.toMatchObject({ kind: "config" });
  });

  it("URL-encodes slug and campaignId to defend against odd characters", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          slug: "s", kind: "npc", name: "", display_name: "", portrait_url: null,
          thumb_url: null, front_matter: {}, sections: [], dm_sections: [],
          audit: { source_path: "", modified_at: "" },
        }),
        { status: 200 },
      ),
    );
    await fetchNpc({ baseUrl: "http://x", campaignId: "a b", slug: "x/y" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://x/foundry/npc/x%2Fy?campaign_id=a%20b&role=dm",
      expect.anything(),
    );
  });
});

describe("listNpcs", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hits /npc-generate/saved and returns the saved array", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          saved: [
            { slug: "a", name: "A", region: "", modified_at: "t", has_image: false, thumb_url: "" },
            { slug: "b", name: "B", region: "X", modified_at: "t", has_image: true,  thumb_url: "/t" },
          ],
        }),
        { status: 200 },
      ),
    );
    const out = await listNpcs({ baseUrl: "http://api", campaignId: "c" });
    expect(out).toHaveLength(2);
    expect(out[0]!.slug).toBe("a");
    expect(out[1]!.region).toBe("X");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://api/npc-generate/saved?campaign_id=c&role=dm",
      expect.anything(),
    );
  });

  it("throws kind=shape when the response is missing `saved` array", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    await expect(
      listNpcs({ baseUrl: "http://x", campaignId: "c" }),
    ).rejects.toMatchObject({ kind: "shape" });
  });
});

describe("fetchImageBytes", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the body as a Blob on 200", async () => {
    const bytes = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    fetchSpy.mockResolvedValueOnce(new Response(bytes, { status: 200 }));
    const blob = await fetchImageBytes({
      baseUrl: "http://x",
      path:    "/api/npc-generate/image/aldric",
    });
    expect(blob).toBeInstanceOf(Blob);
  });

  it("strips a duplicate /api prefix when baseUrl already ends in /api", async () => {
    // dm-assistant's image URLs come back as `/api/npc-generate/...`
    // but the bridge's baseUrl is typically `https://x/api`. Naive
    // concat would produce `https://x/api/api/...` — wrong. The
    // client strips one /api in that case.
    fetchSpy.mockResolvedValueOnce(new Response(new Blob(), { status: 200 }));
    await fetchImageBytes({
      baseUrl: "https://x/api",
      path:    "/api/npc-generate/image/aldric",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x/api/npc-generate/image/aldric",
      expect.anything(),
    );
  });

  it("does NOT strip /api when the base URL has no /api suffix", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(new Blob(), { status: 200 }));
    await fetchImageBytes({
      baseUrl: "https://x",
      path:    "/api/npc-generate/image/aldric",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://x/api/npc-generate/image/aldric",
      expect.anything(),
    );
  });

  it("throws kind=http with status on non-2xx", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(
      fetchImageBytes({ baseUrl: "http://x", path: "/p" }),
    ).rejects.toMatchObject({ kind: "http", status: 404 });
  });
});
