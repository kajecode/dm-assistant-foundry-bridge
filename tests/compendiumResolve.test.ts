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
      },
    },
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
    // Native Foundry provenance set.
    expect((r.flags as Record<string, { sourceId?: string }>).core.sourceId)
      .toBe("Compendium.dnd5e.items.Item.ls");
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
