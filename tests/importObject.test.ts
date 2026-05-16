/**
 * Tests for the standalone Object importer (#504) — `importObject`,
 * `persistObjectWorldItem`, `createOrUpdateObjectItem`.
 *
 * Stubs `fetch` (for `/foundry/object/{slug}`) + the Foundry
 * `game.settings` / `game.folders` / `game.items` / `Folder.create`
 * / `Item.create` globals so the flow runs without a Foundry world.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importObject, persistObjectWorldItem } from "../src/import/importObject.js";
import { MODULE_ID } from "../src/settings/keys.js";

function objectPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug:           "thorncall-blade",
    kind:           "object",
    name:           "Thorncall Blade",
    display_name:   "Thorncall Blade",
    item_type:      "weapon",
    description_md: "# Thorncall Blade\n\nA black-iron longsword that hums.",
    image_url:      null,
    thumb_url:      null,
    front_matter:   {},
    audit: { source_path: "data/c/documents/dm/object_thorncall-blade.md", modified_at: "x" },
    ...over,
  };
}

let itemsCreated:  Record<string, unknown>[];
let itemsUpdated:  Array<{ id: string; data: Record<string, unknown> }>;
let worldItems:    Array<{ id: string; uuid: string; flags: Record<string, Record<string, unknown>>;
                           getFlag: (s: string, k: string) => unknown;
                           update: (d: Record<string, unknown>) => Promise<unknown>; }>;
let foldersReg:    Array<{ id: string; name: string; type: string }>;

function installGlobals(): ReturnType<typeof vi.fn> {
  itemsCreated = [];
  itemsUpdated = [];
  worldItems   = [];
  foldersReg   = [];

  const fetchSpy = vi.fn(async () =>
    new Response(JSON.stringify(objectPayload()), {
      status: 200, headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchSpy);

  vi.stubGlobal("game", {
    settings: { get: (_m: string, _k: string) => "DM Assistant" },
    folders:  { find: (p: (f: { id: string; name: string; type: string }) => boolean) => foldersReg.find(p) },
    items:    { find: (p: (d: typeof worldItems[number]) => boolean) => worldItems.find(p) },
  });
  vi.stubGlobal("Folder", {
    create: async (data: { name: string; type: string }) => {
      const f = { id: `folder-${foldersReg.length + 1}`, name: data.name, type: data.type };
      foldersReg.push(f);
      return f;
    },
  });
  vi.stubGlobal("Item", {
    create: async (data: Record<string, unknown>) => {
      itemsCreated.push(data);
      const flags = data.flags as Record<string, Record<string, unknown>>;
      const fm    = flags[MODULE_ID]!;
      const doc = {
        id:   `item-${itemsCreated.length}`,
        uuid: `Item.item-${itemsCreated.length}`,
        flags,
        getFlag: (s: string, k: string) =>
          s === MODULE_ID ? fm[k] : undefined,
        update: async (d: Record<string, unknown>) => {
          itemsUpdated.push({ id: doc.id, data: d });
          return doc;
        },
      };
      worldItems.push(doc);
      return doc;
    },
  });
  return fetchSpy;
}

const OPTS = { baseUrl: "https://dm.example/api", campaignId: "c", slug: "thorncall-blade" };

describe("importObject (#504)", () => {
  beforeEach(() => installGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("fetches /foundry/object/{slug} and creates a world Item", async () => {
    const spy = installGlobals();
    const r = await importObject(OPTS);

    expect(String(spy.mock.calls[0]![0])).toBe(
      "https://dm.example/api/foundry/object/thorncall-blade?campaign_id=c&role=dm",
    );
    expect(r).toEqual({ slug: "thorncall-blade", item: "created" });
    expect(itemsCreated).toHaveLength(1);

    const created = itemsCreated[0]! as {
      name: string; type: string; folder?: string;
      flags: Record<string, Record<string, unknown>>;
    };
    expect(created.name).toBe("Thorncall Blade");
    expect(created.type).toBe("weapon");
    expect(String(created.folder)).toMatch(/^folder-/);
    const f = created.flags[MODULE_ID]!;
    expect(f.slug).toBe("thorncall-blade");
    expect(f.source).toBe("dm-assistant");
    expect(f.kind).toBe("object-item");
    expect(f.campaign_id).toBe("c");
    expect(f.object_slug).toBe("thorncall-blade");
    expect(f.resolved_from).toBe("dm-assistant:object/thorncall-blade");
  });

  it("updates in place on re-import (idempotent, drift policy)", async () => {
    installGlobals();
    await importObject(OPTS);                       // create
    expect(itemsCreated).toHaveLength(1);

    const r2 = await importObject(OPTS);            // re-import → same identity
    expect(r2.item).toBe("updated");
    expect(itemsCreated).toHaveLength(1);           // NOT duplicated
    expect(itemsUpdated).toHaveLength(1);
  });

  it("coerces an unknown item_type to loot", async () => {
    installGlobals();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(objectPayload({ item_type: "doohickey" })), { status: 200 }),
    ));
    await importObject(OPTS);
    expect((itemsCreated[0]! as { type: string }).type).toBe("loot");
  });

  it("builds an absolute, /api-deduped image URL when image_url present", async () => {
    installGlobals();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(objectPayload({
        image_url: "/api/object-generate/image/thorncall-blade?campaign_id=c",
      })), { status: 200 }),
    ));
    await importObject(OPTS);
    expect((itemsCreated[0]! as { img?: string }).img).toBe(
      "https://dm.example/api/object-generate/image/thorncall-blade?campaign_id=c",
    );
  });

  it("img is undefined when the object has no image", async () => {
    installGlobals();
    await importObject(OPTS);
    expect((itemsCreated[0]! as { img?: string }).img).toBeUndefined();
  });

  it("persistObjectWorldItem is the shared seam (no fetch)", async () => {
    installGlobals();
    const r = await persistObjectWorldItem(
      objectPayload() as never, "https://dm.example/api", "c",
    );
    expect(r).toBe("created");
    expect((itemsCreated[0]! as { flags: Record<string, Record<string, unknown>> })
      .flags[MODULE_ID]!.kind).toBe("object-item");
  });

  it("propagates a fetch error (picker surfaces it)", async () => {
    installGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(importObject(OPTS)).rejects.toMatchObject({ kind: "http", status: 404 });
    expect(itemsCreated).toHaveLength(0);
  });
});
