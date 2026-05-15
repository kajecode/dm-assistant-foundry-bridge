/**
 * Tests for the compendium-source resolution post-pass (#32).
 *
 * Stubs Foundry's `game.packs` / `game.items` / `game.settings` /
 * `Item.create` / `Folder.create` / `fromUuid` globals so the
 * resolver can be exercised without a Foundry world.
 *
 * Covers:
 *   - opt-in: empty setting → stubs pass through untouched
 *   - exact (normalised) name match → compendium data swapped in
 *   - no match → stub preserved
 *   - explicit compendium_source precedence (via fromUuid)
 *   - object_slug resolution (#502 v2a): dm-a object payload wins
 *     over name-search; type coercion; image URL; fetch-fail
 *     fallback; no-ctx skip; no library copy
 *   - bridge drift flag preserved on the resolved item
 *   - non-bridge compendium type (e.g. "class") rejected → stub kept
 *   - Items-folder library copy is idempotent + non-fatal
 *   - name normalisation (case / whitespace / quotes)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveItemsAgainstCompendiums,
  normaliseName,
} from "../src/foundry/compendiumResolve.js";
import { MODULE_ID } from "../src/settings/keys.js";
import {
  ITEM_SOURCE_MARKER,
  type DnD5eItemData,
} from "../src/translators/dnd5e/items.js";


// ── Fixtures ────────────────────────────────────────────────────────────────

function stub(name: string, opts: Partial<{
  type: DnD5eItemData["type"];
  compendiumSource: string | null;
  objectSlug: string | null;
}> = {}): DnD5eItemData {
  return {
    name: `${name} (Elowen Tristane)`,        // display name is decorated
    type: opts.type ?? "weapon",
    system: { description: { value: "stub", chat: "", unidentified: "" } },
    flags: {
      [MODULE_ID]: {
        slug:              name.toLowerCase().replace(/\s+/g, "-"),
        source:            ITEM_SOURCE_MARKER,
        origin_name:       name,                // resolver matches on THIS
        compendium_source: opts.compendiumSource ?? null,
        object_slug:       opts.objectSlug ?? null,
      },
    },
  };
}

const OBJ_CTX = { baseUrl: "https://dm.example/api", campaignId: "c" };

/** Stub global `fetch` so the resolver's `fetchObject` call resolves
 *  to a dm-a `/foundry/object/{slug}` payload (or an error). */
function stubObjectFetch(
  payload: Record<string, unknown> | null,
  status = 200,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () =>
    payload === null
      ? new Response("not found", { status: status === 200 ? 404 : status })
      : new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

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

interface FakeCompDoc {
  uuid: string;
  obj:  Record<string, unknown>;
}

function fakeDoc(uuid: string, name: string, type: string, system: Record<string, unknown>): FakeCompDoc {
  return {
    uuid,
    obj: {
      _id: "abc123", name, type, system,
      img: "icons/svg/sword.svg",
      effects: [{ name: "On Hit" }],
      _stats: { coreVersion: "13" },
      flags: { dnd5e: { migrated: true } },
    },
  };
}

let itemsCreated: Record<string, unknown>[];
let itemsDir:     Array<{ getFlag: (s: string, k: string) => unknown }>;
let foldersReg:   Array<{ id: string; name: string; type: string }>;

function makePack(id: string, docs: FakeCompDoc[]) {
  const rows = docs.map((d) => ({
    _id:  d.obj._id as string,
    name: d.obj.name as string,
    type: d.obj.type as string,
  }));
  return {
    metadata:     { id },
    documentName: "Item",
    // Foundry's pack.index is a Collection — iterable + has .find().
    // Mirror that with a plain array carrying a `find` that delegates
    // to Array.prototype.find on the *raw* array (not the augmented
    // object, which would recurse).
    index: Object.assign([...rows], {
      find: (p: (e: { _id: string; name: string; type: string }) => boolean) =>
        rows.find(p),
    }),
    getDocument: async (docId: string) => {
      const d = docs.find((x) => x.obj._id === docId);
      return d ? { uuid: d.uuid, toObject: () => structuredClone(d.obj) } : null;
    },
  };
}

let packs: ReturnType<typeof makePack>[];
let uuidMap: Map<string, FakeCompDoc>;

function installGlobals(settingValue: string): void {
  itemsCreated = [];
  itemsDir     = [];
  foldersReg   = [];

  vi.stubGlobal("game", {
    settings: {
      get: (_m: string, key: string) =>
        key === "itemCompendiums" ? settingValue : "DM Assistant",
    },
    packs: Object.assign([...packs], {
      get: (id: string) => packs.find((p) => p.metadata.id === id),
    }),
    items: { find: (p: (d: { getFlag: (s: string, k: string) => unknown }) => boolean) => itemsDir.find(p) },
    folders: { find: (p: (f: { id: string; name: string; type: string }) => boolean) => foldersReg.find(p) },
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
      // Mirror into the directory so idempotency can be exercised.
      const flags = data.flags as Record<string, Record<string, unknown>>;
      const rf = flags[MODULE_ID]?.resolved_from as string | undefined;
      itemsDir.push({
        getFlag: (s: string, k: string) =>
          s === MODULE_ID && k === "resolved_from" ? rf : undefined,
      });
      return {};
    },
  });
  vi.stubGlobal("fromUuid", async (uuid: string) => {
    const d = uuidMap.get(uuid);
    return d ? { uuid: d.uuid, toObject: () => structuredClone(d.obj) } : null;
  });
}


// ── Tests ───────────────────────────────────────────────────────────────────

describe("resolveItemsAgainstCompendiums", () => {
  beforeEach(() => {
    packs   = [];
    uuidMap = new Map();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns stubs untouched when the setting is empty (feature off)", async () => {
    packs = [makePack("dnd5e.items", [
      fakeDoc("Compendium.dnd5e.items.Item.x", "Longsword", "weapon", { magic: true }),
    ])];
    installGlobals("");                       // off
    const stubs = [stub("Longsword")];
    const out   = await resolveItemsAgainstCompendiums(stubs);
    expect(out).toEqual(stubs);
    expect(itemsCreated).toHaveLength(0);
  });

  it("swaps a stub for compendium data on an exact name match", async () => {
    packs = [makePack("dnd5e.items", [
      fakeDoc("Compendium.dnd5e.items.Item.ls", "Longsword", "weapon", { fullMechanics: true }),
    ])];
    installGlobals("auto");
    const out = await resolveItemsAgainstCompendiums([stub("Longsword")]);
    expect(out).toHaveLength(1);
    const r = out[0]!;
    // Catalogue name (NOT the decorated "(Elowen Tristane)" form).
    expect(r.name).toBe("Longsword");
    expect(r.system).toEqual({ fullMechanics: true });
    // Bridge drift flag preserved so drop-and-replace still works.
    expect(r.flags[MODULE_ID].source).toBe(ITEM_SOURCE_MARKER);
    expect(r.flags[MODULE_ID].resolved_from).toBe("Compendium.dnd5e.items.Item.ls");
    // Native Foundry v12+ provenance via _stats.compendiumSource —
    // NOT the deprecated flags.core.sourceId (removed in v14).
    expect((r as unknown as { _stats?: { compendiumSource?: string } })._stats?.compendiumSource)
      .toBe("Compendium.dnd5e.items.Item.ls");
    expect((r.flags as Record<string, { sourceId?: string }>).core)
      .toBeUndefined();
  });

  it("strips a deprecated core.sourceId the compendium item carried", async () => {
    // DDB Importer packs stamp the legacy flags.core.sourceId. We
    // must drop it on resolution (deprecated v12, removed v14,
    // console-spams v13) and use _stats.compendiumSource instead.
    const d = fakeDoc("Compendium.world.ddb.Item.fb", "Fireball", "spell", { level: 3 });
    (d.obj.flags as Record<string, unknown>).core = {
      sourceId: "Compendium.world.ddb.Item.legacy-ref",
      otherCoreFlag: true,
    };
    packs = [makePack("world.ddb", [d])];
    installGlobals("auto");
    const out = await resolveItemsAgainstCompendiums([stub("Fireball", { type: "spell" })]);
    const r = out[0]!;
    const core = (r.flags as Record<string, Record<string, unknown> | undefined>).core;
    // Deprecated sourceId gone; sibling core flags preserved.
    expect(core?.sourceId).toBeUndefined();
    expect(core?.otherCoreFlag).toBe(true);
    // Provenance moved to the non-deprecated slot.
    expect((r as unknown as { _stats?: { compendiumSource?: string } })._stats?.compendiumSource)
      .toBe(d.uuid);
  });

  it("keeps the stub when no compendium matches", async () => {
    packs = [makePack("dnd5e.items", [
      fakeDoc("Compendium.dnd5e.items.Item.x", "Greataxe", "weapon", {}),
    ])];
    installGlobals("auto");
    const stubs = [stub("Moonbeam", { type: "spell" })];
    const out   = await resolveItemsAgainstCompendiums(stubs);
    expect(out[0]).toEqual(stubs[0]);
  });

  it("prefers explicit compendium_source over name search", async () => {
    const d = fakeDoc("Compendium.dnd5e.spells.Item.fb", "Fireball", "spell", { level: 3 });
    uuidMap.set(d.uuid, d);
    // A name-search pack that would mis-match on a different doc.
    packs = [makePack("world.homebrew", [
      fakeDoc("Compendium.world.homebrew.Item.wrong", "Fireball", "spell", { level: 99 }),
    ])];
    installGlobals("world.homebrew");
    const out = await resolveItemsAgainstCompendiums([
      stub("Fireball", { type: "spell", compendiumSource: d.uuid }),
    ]);
    // Resolved via the explicit source (level 3), not the homebrew (level 99).
    expect(out[0]!.system).toEqual({ level: 3 });
    expect(out[0]!.flags[MODULE_ID].resolved_from).toBe(d.uuid);
  });

  it("falls back to name search when compendium_source doesn't resolve", async () => {
    packs = [makePack("dnd5e.spells", [
      fakeDoc("Compendium.dnd5e.spells.Item.fb", "Fireball", "spell", { level: 3 }),
    ])];
    installGlobals("auto");
    const out = await resolveItemsAgainstCompendiums([
      stub("Fireball", { type: "spell", compendiumSource: "Compendium.bad.uuid.Item.nope" }),
    ]);
    expect(out[0]!.system).toEqual({ level: 3 });
  });

  it("rejects a compendium doc whose type isn't a bridge item type", async () => {
    packs = [makePack("dnd5e.classes", [
      fakeDoc("Compendium.dnd5e.classes.Item.fighter", "Fighter", "class", { hd: 10 }),
    ])];
    installGlobals("auto");
    const stubs = [stub("Fighter", { type: "loot" })];   // LLM mis-tagged a class name
    const out   = await resolveItemsAgainstCompendiums(stubs);
    expect(out[0]).toEqual(stubs[0]);                     // stub kept
    expect(itemsCreated).toHaveLength(0);
  });

  it("copies the resolved item into the Items library folder (idempotent)", async () => {
    packs = [makePack("dnd5e.items", [
      fakeDoc("Compendium.dnd5e.items.Item.hp", "Healing Potion", "consumable", { uses: 1 }),
    ])];
    installGlobals("auto");
    // Two actors both reference Healing Potion.
    await resolveItemsAgainstCompendiums([stub("Healing Potion", { type: "consumable" })]);
    await resolveItemsAgainstCompendiums([stub("Healing Potion", { type: "consumable" })]);
    // Library copy made once, not twice (idempotent on resolved_from).
    expect(itemsCreated).toHaveLength(1);
    expect(itemsCreated[0]!.folder).toMatch(/^folder-/);
  });

  it("never throws — a resolution error degrades to the stub", async () => {
    const throwingPack = makePack("dnd5e.items", []);
    throwingPack.getDocument = async () => { throw new Error("compendium boom"); };
    throwingPack.index = Object.assign(
      [{ _id: "x", name: "Longsword", type: "weapon" }],
      { find: (p: (e: { _id: string; name: string; type: string }) => boolean) =>
          [{ _id: "x", name: "Longsword", type: "weapon" }].find(p) },
    );
    packs = [throwingPack];
    installGlobals("auto");
    const stubs = [stub("Longsword")];
    const out   = await resolveItemsAgainstCompendiums(stubs);
    expect(out[0]).toEqual(stubs[0]);
  });

  it("warns + skips a configured pack id that doesn't exist", async () => {
    packs = [];
    installGlobals("dnd5e.items, typo.pack");
    const stubs = [stub("Longsword")];
    const out   = await resolveItemsAgainstCompendiums(stubs);
    expect(out[0]).toEqual(stubs[0]);          // nothing resolved, no crash
  });
});


describe("object_slug resolution (#502 v2a)", () => {
  beforeEach(() => {
    packs   = [];
    uuidMap = new Map();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("resolves an object_slug item to the dm-a object payload", async () => {
    installGlobals("");                       // compendium feature off
    stubObjectFetch(objectPayload());
    const out = await resolveItemsAgainstCompendiums(
      [stub("Thorncall Blade", { objectSlug: "thorncall-blade" })],
      OBJ_CTX,
    );
    const item = out[0]!;
    expect(item.name).toBe("Thorncall Blade");          // authored name, NOT decorated
    expect(item.type).toBe("weapon");
    expect(item.system).toHaveProperty("description");
    expect((item.system.description as { value: string }).value)
      .toContain("black-iron longsword");               // markdown rendered
    expect(item.flags[MODULE_ID].source).toBe(ITEM_SOURCE_MARKER);  // drift flag kept
    expect(item.flags[MODULE_ID].object_slug).toBe("thorncall-blade");
    expect(item.flags[MODULE_ID].resolved_from).toBe("dm-assistant:object/thorncall-blade");
  });

  it("hits the documented /foundry/object/{slug} URL with role=dm", async () => {
    installGlobals("");
    const spy = stubObjectFetch(objectPayload());
    await resolveItemsAgainstCompendiums(
      [stub("Thorncall Blade", { objectSlug: "thorncall-blade" })],
      OBJ_CTX,
    );
    const url = String(spy.mock.calls[0]![0]);
    expect(url).toBe(
      "https://dm.example/api/foundry/object/thorncall-blade?campaign_id=c&role=dm",
    );
  });

  it("object_slug wins over compendium name-search", async () => {
    packs = [makePack("world.homebrew", [
      fakeDoc("Compendium.world.homebrew.Item.x", "Thorncall Blade", "weapon", { wrong: true }),
    ])];
    installGlobals("auto");
    stubObjectFetch(objectPayload());
    const out = await resolveItemsAgainstCompendiums(
      [stub("Thorncall Blade", { type: "weapon", objectSlug: "thorncall-blade" })],
      OBJ_CTX,
    );
    // Object payload won — NOT the homebrew compendium doc.
    expect(out[0]!.system).not.toEqual({ wrong: true });
    expect(out[0]!.flags[MODULE_ID].resolved_from).toBe("dm-assistant:object/thorncall-blade");
  });

  it("coerces an unknown item_type to loot", async () => {
    installGlobals("");
    stubObjectFetch(objectPayload({ item_type: "wand-of-nonsense" }));
    const out = await resolveItemsAgainstCompendiums(
      [stub("Thorncall Blade", { objectSlug: "thorncall-blade" })],
      OBJ_CTX,
    );
    expect(out[0]!.type).toBe("loot");
  });

  it("builds an absolute image URL (de-duped /api) when image_url present", async () => {
    installGlobals("");
    stubObjectFetch(objectPayload({
      image_url: "/api/object-generate/image/thorncall-blade?campaign_id=c",
    }));
    const out = await resolveItemsAgainstCompendiums(
      [stub("Thorncall Blade", { objectSlug: "thorncall-blade" })],
      OBJ_CTX,
    );
    // base ends in /api AND path starts /api/ → de-duped, not doubled.
    expect(out[0]!.img).toBe(
      "https://dm.example/api/object-generate/image/thorncall-blade?campaign_id=c",
    );
  });

  it("falls back to the compendium path when the object fetch fails", async () => {
    packs = [makePack("dnd5e.items", [
      fakeDoc("Compendium.dnd5e.items.Item.ls", "Thorncall Blade", "weapon", { fromComp: true }),
    ])];
    installGlobals("auto");
    stubObjectFetch(null, 404);               // object endpoint 404s
    const out = await resolveItemsAgainstCompendiums(
      [stub("Thorncall Blade", { type: "weapon", objectSlug: "thorncall-blade" })],
      OBJ_CTX,
    );
    expect(out[0]!.system).toEqual({ fromComp: true });   // fell through to #32
  });

  it("degrades to the stub when object fetch fails and no compendium match", async () => {
    installGlobals("");
    stubObjectFetch(null, 500);
    const stubs = [stub("Thorncall Blade", { objectSlug: "thorncall-blade" })];
    const out   = await resolveItemsAgainstCompendiums(stubs, OBJ_CTX);
    expect(out[0]).toEqual(stubs[0]);
  });

  it("skips object resolution entirely when no ctx is passed", async () => {
    installGlobals("");
    const spy = stubObjectFetch(objectPayload());
    const stubs = [stub("Thorncall Blade", { objectSlug: "thorncall-blade" })];
    const out   = await resolveItemsAgainstCompendiums(stubs);   // no ctx
    expect(spy).not.toHaveBeenCalled();
    expect(out[0]).toEqual(stubs[0]);
  });

  it("does not make a library-folder copy for object-resolved items", async () => {
    installGlobals("");
    stubObjectFetch(objectPayload());
    await resolveItemsAgainstCompendiums(
      [stub("Thorncall Blade", { objectSlug: "thorncall-blade" })],
      OBJ_CTX,
    );
    expect(itemsCreated).toHaveLength(0);   // compendium-only behaviour
  });
});


describe("normaliseName", () => {
  it("lowercases, trims, collapses whitespace, strips wrapping quotes", () => {
    expect(normaliseName("  Healing   Potion ")).toBe("healing potion");
    expect(normaliseName('"Longsword"')).toBe("longsword");
    expect(normaliseName("Fire Bolt")).toBe("fire bolt");
  });

  it("does NOT strip suffixes — exact match only (no Dagger→Dagger +1)", () => {
    expect(normaliseName("Dagger +1")).toBe("dagger +1");
    expect(normaliseName("Dagger +1")).not.toBe(normaliseName("Dagger"));
  });
});
