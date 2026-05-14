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
  fetchActor,
  fetchHealth,
  listCampaigns,
  fetchImageBytes,
  fetchNpc,
  listCreatures,
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

describe("fetchActor", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hits /foundry/actor/{kind}/{slug} with kind=creature", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          slug:         "ash-wraith",
          kind:         "creature",
          name:         "Ash-Wraith",
          display_name: "Ash-Wraith",
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
    const r = await fetchActor({
      baseUrl:    "http://api/",
      campaignId: "c",
      slug:       "ash-wraith",
      kind:       "creature",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://api/foundry/actor/creature/ash-wraith?campaign_id=c&role=dm",
      expect.anything(),
    );
    expect(r.slug).toBe("ash-wraith");
    expect(r.kind).toBe("creature");
  });

  it("hits /foundry/actor/{kind}/{slug} with kind=npc", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          slug: "aldric", kind: "npc", name: "Aldric", display_name: "Aldric",
          portrait_url: null, thumb_url: null, front_matter: {},
          sections: [], dm_sections: [],
          audit: { source_path: "p", modified_at: "t" },
        }),
        { status: 200 },
      ),
    );
    await fetchActor({ baseUrl: "http://api", campaignId: "c", slug: "aldric", kind: "npc" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://api/foundry/actor/npc/aldric?campaign_id=c&role=dm",
      expect.anything(),
    );
  });

  it("rejects with kind=config when the actor kind is empty", async () => {
    await expect(
      fetchActor({ baseUrl: "http://x", campaignId: "c", slug: "s", kind: "" as unknown as "npc" }),
    ).rejects.toMatchObject({ kind: "config" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("URL-encodes slug and campaignId", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          slug: "s", kind: "creature", name: "", display_name: "",
          portrait_url: null, thumb_url: null, front_matter: {},
          sections: [], dm_sections: [],
          audit: { source_path: "", modified_at: "" },
        }),
        { status: 200 },
      ),
    );
    await fetchActor({ baseUrl: "http://x", campaignId: "a b", slug: "x/y", kind: "creature" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://x/foundry/actor/creature/x%2Fy?campaign_id=a%20b&role=dm",
      expect.anything(),
    );
  });
});

describe("listCreatures", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hits /creature-generate/saved with campaign_id + role=dm", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          saved: [
            { slug: "ash-wraith", filename: "creature_ash-wraith.md", name: "Ash-Wraith", modified_at: "t1", has_image: true,  thumb_url: "/api/creature-generate/image/ash-wraith/thumb" },
            { slug: "fae-stalker", filename: "creature_fae-stalker.md", name: "Fae Stalker", modified_at: "t2", has_image: false, thumb_url: "" },
          ],
        }),
        { status: 200 },
      ),
    );
    const r = await listCreatures({ baseUrl: "http://api/", campaignId: "c" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://api/creature-generate/saved?campaign_id=c&role=dm",
      expect.anything(),
    );
    expect(r).toHaveLength(2);
    expect(r[0]?.slug).toBe("ash-wraith");
    expect(r[1]?.has_image).toBe(false);
  });

  it("throws on shape mismatch (missing saved array)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    await expect(
      listCreatures({ baseUrl: "http://x", campaignId: "c" }),
    ).rejects.toMatchObject({ kind: "shape" });
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

  it("delegates to /foundry/actor/npc/{slug} (contract 0.2.0 unified route)", async () => {
    // fetchNpc is a back-compat shim that calls fetchActor with
    // kind="npc". The wire URL is the new unified one — the
    // deprecated /foundry/npc/{slug} shim on dm-assistant still
    // works but the bridge stops calling it post-bridge#19.
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
      "http://api/foundry/actor/npc/aldric-harwick?campaign_id=c&role=dm",
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
      "http://x/foundry/actor/npc/x%2Fy?campaign_id=a%20b&role=dm",
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

describe("listCampaigns", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hits /campaigns and returns the campaigns array", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          campaigns: [
            { id: "a", name: "Alpha", game_system: "D&D 5e", chroma_ready: true  },
            { id: "b", name: "Beta",  game_system: "",       chroma_ready: false },
          ],
        }),
        { status: 200 },
      ),
    );
    const out = await listCampaigns({ baseUrl: "http://api" });
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("a");
    expect(out[1]!.chroma_ready).toBe(false);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://api/campaigns?role=dm",
      expect.anything(),
    );
  });

  it("does NOT send X-API-Key — /campaigns is not API-key gated", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ campaigns: [] }), { status: 200 }),
    );
    await listCampaigns({ baseUrl: "http://x", apiKey: "secret-key" });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    // No headers object → no X-API-Key. Sending the key is harmless
    // but we want to keep /campaigns probable from an unconfigured
    // bridge (apiKey can be empty during initial setup).
    expect(init.headers).toBeUndefined();
  });

  it("throws kind=shape when response missing campaigns array", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    await expect(
      listCampaigns({ baseUrl: "http://x" }),
    ).rejects.toMatchObject({ kind: "shape" });
  });

  it("throws kind=http on non-2xx response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(
      listCampaigns({ baseUrl: "http://x" }),
    ).rejects.toMatchObject({ kind: "http", status: 500 });
  });

  it("throws kind=config when baseUrl is empty", async () => {
    await expect(
      listCampaigns({ baseUrl: "" }),
    ).rejects.toMatchObject({ kind: "config" });
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
