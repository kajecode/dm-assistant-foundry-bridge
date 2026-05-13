/**
 * Unit tests for the kind-aware folder helper (bridge#24).
 *
 * Mocks Foundry's `game.folders` + `Folder` globals via vi.stubGlobal
 * so the find-or-create idempotency can be exercised without
 * actually running inside a Foundry world. Each test starts with a
 * fresh in-memory folder registry to keep assertions isolated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findOrCreateFolder, folderNameFor, resolveActorFolderId, resolveDmNotesFolderId } from "../src/foundry/folders.js";
import { SETTING } from "../src/settings/keys.js";

interface FakeFolder {
  id:   string;
  name: string;
  type: string;
}

let fakeRegistry: FakeFolder[];
let nextId: number;

beforeEach(() => {
  fakeRegistry = [];
  nextId       = 1;

  // game.folders.find: linear scan over the in-memory registry.
  // game.settings.get: returns the folder prefix; tests can override
  // via vi.stubGlobal on a per-test basis.
  vi.stubGlobal("game", {
    folders: {
      find: (pred: (f: FakeFolder) => boolean) =>
        fakeRegistry.find(pred),
    },
    settings: {
      get: (mod: string, key: string) => {
        if (key === SETTING.folderPrefix) return "DM Assistant";
        return "";
      },
    },
  });

  // Folder.create: append to the in-memory registry + assign a
  // monotonically-increasing id mimicking Foundry's randomID().
  vi.stubGlobal("Folder", {
    create: vi.fn(async (data: { name: string; type: string }) => {
      const created = {
        id:   `folder-${nextId++}`,
        name: data.name,
        type: data.type,
      };
      fakeRegistry.push(created);
      return created;
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("folderNameFor", () => {
  it("composes the prefix and the kind-specific label", () => {
    expect(folderNameFor("npc", "actor")).toBe("DM Assistant — NPCs");
    expect(folderNameFor("creature", "actor")).toBe("DM Assistant — Creatures");
    expect(folderNameFor("npc", "dm-notes")).toBe("DM Assistant — NPC DM Notes");
    expect(folderNameFor("creature", "dm-notes")).toBe("DM Assistant — Creature DM Notes");
  });

  it("supports forward-compat journal kinds (shop, location, faction)", () => {
    // Bridge #25 / #26 will consume these; pre-wiring the labels
    // here means the orchestrator code can ship in any order.
    expect(folderNameFor("shop",     "journal")).toBe("DM Assistant — Shops");
    expect(folderNameFor("location", "journal")).toBe("DM Assistant — Locations");
    expect(folderNameFor("faction",  "journal")).toBe("DM Assistant — Factions");
  });

  it("falls back to 'Other' for unknown (kind, role) pairs", () => {
    // Defensive: a future kind that ships before this dict is
    // updated should still land somewhere predictable rather than
    // crash the import.
    expect(folderNameFor("vehicle", "actor")).toBe("DM Assistant — Other");
  });

  it("honors the operator's configured prefix", () => {
    vi.stubGlobal("game", {
      folders:  { find: () => undefined },
      settings: { get: () => "Withering Dawn" },
    });
    expect(folderNameFor("npc", "actor")).toBe("Withering Dawn — NPCs");
  });

  it("falls back to the default prefix when the setting is empty", () => {
    vi.stubGlobal("game", {
      folders:  { find: () => undefined },
      settings: { get: () => "" },
    });
    expect(folderNameFor("npc", "actor")).toBe("DM Assistant — NPCs");
  });
});

describe("findOrCreateFolder", () => {
  it("creates a new folder when none exists", async () => {
    const id = await findOrCreateFolder("Test Folder", "Actor");
    expect(id).toBe("folder-1");
    expect(fakeRegistry).toHaveLength(1);
    expect(fakeRegistry[0]?.name).toBe("Test Folder");
    expect(fakeRegistry[0]?.type).toBe("Actor");
  });

  it("returns the existing folder ID on second call (idempotent)", async () => {
    const first  = await findOrCreateFolder("Test Folder", "Actor");
    const second = await findOrCreateFolder("Test Folder", "Actor");
    expect(first).toBe(second);
    // Critical assertion — the v1 #24 bug was creating duplicates
    // on every import. Only one folder should ever exist for a
    // given (name, type) pair.
    expect(fakeRegistry).toHaveLength(1);
  });

  it("treats Actor and JournalEntry folders with the same name as distinct", async () => {
    // Foundry's folder model is per-document-type; an Actor folder
    // and a JournalEntry folder can both legitimately exist with
    // the name "DM Assistant — NPC DM Notes". The bridge never
    // does this, but the helper must not collapse the two on
    // lookup.
    const actorId   = await findOrCreateFolder("Shared Name", "Actor");
    const journalId = await findOrCreateFolder("Shared Name", "JournalEntry");
    expect(actorId).not.toBe(journalId);
    expect(fakeRegistry).toHaveLength(2);
  });

  it("throws if Folder.create returns null", async () => {
    vi.stubGlobal("Folder", { create: vi.fn(async () => null) });
    await expect(findOrCreateFolder("Bad Folder", "Actor")).rejects.toThrow(/null/);
  });
});

describe("resolveActorFolderId + resolveDmNotesFolderId", () => {
  it("resolves NPC actor folder ID", async () => {
    const id = await resolveActorFolderId("npc");
    expect(fakeRegistry[0]?.name).toBe("DM Assistant — NPCs");
    expect(fakeRegistry[0]?.type).toBe("Actor");
    expect(fakeRegistry[0]?.id).toBe(id);
  });

  it("resolves Creature actor folder ID — distinct from NPC", async () => {
    const npcId      = await resolveActorFolderId("npc");
    const creatureId = await resolveActorFolderId("creature");
    expect(npcId).not.toBe(creatureId);
    expect(fakeRegistry).toHaveLength(2);
    const names = fakeRegistry.map((f) => f.name).sort();
    expect(names).toEqual(["DM Assistant — Creatures", "DM Assistant — NPCs"]);
  });

  it("resolves NPC DM-notes folder ID as a JournalEntry-typed folder", async () => {
    const id = await resolveDmNotesFolderId("npc");
    const folder = fakeRegistry.find((f) => f.id === id);
    expect(folder?.name).toBe("DM Assistant — NPC DM Notes");
    expect(folder?.type).toBe("JournalEntry");
  });

  it("resolveActorFolderId is idempotent across calls", async () => {
    const first  = await resolveActorFolderId("npc");
    const second = await resolveActorFolderId("npc");
    const third  = await resolveActorFolderId("npc");
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(fakeRegistry).toHaveLength(1);
  });
});
