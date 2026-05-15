/**
 * Tests for the actor-update path's embedded-Items sync
 * (`createOrUpdateActor` in `src/foundry/documents.ts`).
 *
 * Verifies the drop-and-replace behaviour:
 *   1. Existing bridge-marked items get deleted on re-import.
 *   2. User-authored items (without the `dm-assistant` source flag)
 *      are left untouched.
 *   3. The freshly translated items are created via
 *      `createEmbeddedDocuments("Item", items)`.
 *
 * Foundry globals (Actor, JournalEntry, game) are stubbed via
 * `vi.stubGlobal`; the actor-doc shape exposes the minimal slice
 * the sync helper reads (`items.contents`, `getFlag`,
 * `deleteEmbeddedDocuments`, `createEmbeddedDocuments`,
 * `update`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOrUpdateActor } from "../src/foundry/documents.js";
import { MODULE_ID }            from "../src/translators/common/buildActorData.js";
import {
  ITEM_SOURCE_MARKER,
  type DnD5eItemData,
}                                from "../src/translators/dnd5e/items.js";
import type { ActorImportData }  from "../src/translators/common/buildActorData.js";


interface FakeItem {
  id:      string;
  flags:   Record<string, Record<string, unknown>>;
}

interface FakeActor {
  id:      string;
  uuid:    string;
  flags:   Record<string, Record<string, unknown>>;
  items:   { contents: FakeItem[] };
  // Calls captured for assertions.
  _calls: {
    update:   Array<Record<string, unknown>>;
    delete:   Array<{ type: string; ids: string[] }>;
    create:   Array<{ type: string; data: unknown[] }>;
  };
}


let fakeActors: FakeActor[];


function makeFakeActor(opts: {
  id?:        string;
  slug:       string;
  campaignId: string;
  kind?:      string;
  items?:     FakeItem[];
}): FakeActor {
  const calls: FakeActor["_calls"] = { update: [], delete: [], create: [] };
  const actor: FakeActor = {
    id:   opts.id ?? `actor-${Math.random().toString(36).slice(2, 8)}`,
    uuid: `Actor.${opts.id ?? "x"}`,
    flags: {
      [MODULE_ID]: {
        slug:        opts.slug,
        campaign_id: opts.campaignId,
        kind:        opts.kind ?? "npc-actor",
      },
    },
    items: { contents: opts.items ?? [] },
    _calls: calls,
  };
  // Methods need the actor in scope; assign after construction.
  Object.assign(actor, {
    getFlag: (scope: string, key: string) => actor.flags[scope]?.[key],
    update:  async (data: Record<string, unknown>) => {
      calls.update.push(data);
      return actor;
    },
    delete:  async () => actor,
    deleteEmbeddedDocuments: async (type: string, ids: string[]) => {
      calls.delete.push({ type, ids });
      // Mutate the contents collection so subsequent reads reflect deletion.
      actor.items.contents = actor.items.contents.filter((it) => !ids.includes(it.id));
      return [];
    },
    createEmbeddedDocuments: async (type: string, data: unknown[]) => {
      calls.create.push({ type, data });
      return [];
    },
  });
  return actor;
}


function makeFakeItem(opts: {
  id:     string;
  source: string;          // ITEM_SOURCE_MARKER or "user-created" etc.
}): FakeItem {
  const item: FakeItem = {
    id: opts.id,
    flags: {
      [MODULE_ID]: { source: opts.source },
    },
  };
  Object.assign(item, {
    getFlag: (scope: string, key: string) => item.flags[scope]?.[key],
  });
  return item;
}


function makeActorImportData(slug: string, campaignId: string): ActorImportData {
  return {
    name: "Test",
    type: "npc",
    img:  null,
    system: { details: { biography: { value: "", public: "" } } },
    prototypeToken: {
      name: "Test",
      texture: { src: null },
      disposition: 0,
      actorLink:   false,
      displayName: 0,
      displayBars: 0,
      bar1:        { attribute: "attributes.hp" },
    },
    ownership: { default: 0 },
    flags: {
      [MODULE_ID]: {
        slug,
        campaign_id: campaignId,
        source_path: "x.md",
        modified_at: "2026-05-14",
        kind:        "npc-actor",
      },
    },
  };
}


function makeItem(name: string): DnD5eItemData {
  return {
    name,
    type:  "feat",
    system: { description: { value: "", chat: "", unidentified: "" } },
    flags: {
      [MODULE_ID]: {
        slug:   name.toLowerCase().replace(/\s/g, "-"),
        source: ITEM_SOURCE_MARKER,
      },
    },
  };
}


describe("createOrUpdateActor — embedded items sync", () => {
  beforeEach(() => {
    fakeActors = [];
    vi.stubGlobal("Actor", {
      create: vi.fn(async (data: Record<string, unknown>) => {
        const flags = (data.flags as { [k: string]: { slug: string; campaign_id: string; kind: string } })[MODULE_ID]!;
        const created = makeFakeActor({
          id:         `created-${flags.slug}`,
          slug:       flags.slug,
          campaignId: flags.campaign_id,
          kind:       flags.kind,
        });
        fakeActors.push(created);
        return created;
      }),
    });
    vi.stubGlobal("JournalEntry", { create: vi.fn() });
    vi.stubGlobal("game", {
      actors: {
        find: (pred: (a: FakeActor) => boolean) => fakeActors.find(pred),
      },
      journal: { find: () => undefined },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a new actor + items when no existing actor matches", async () => {
    const result = await createOrUpdateActor(
      makeActorImportData("aldric", "c"),
      [makeItem("Slam"), makeItem("Pack Tactics")],
    );
    expect(result).toBe("created");
    expect(fakeActors).toHaveLength(1);
    const calls = fakeActors[0]!._calls.create;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe("Item");
    expect((calls[0]!.data as DnD5eItemData[]).map((i) => i.name)).toEqual(["Slam", "Pack Tactics"]);
  });

  it("creates a new actor with no item creation call when items list is empty", async () => {
    const result = await createOrUpdateActor(makeActorImportData("aldric", "c"), []);
    expect(result).toBe("created");
    expect(fakeActors[0]!._calls.create).toEqual([]);
  });

  it("re-imports: deletes bridge-marked items + creates the new set", async () => {
    const existing = makeFakeActor({
      slug: "aldric", campaignId: "c",
      items: [
        makeFakeItem({ id: "i-1", source: ITEM_SOURCE_MARKER }),
        makeFakeItem({ id: "i-2", source: ITEM_SOURCE_MARKER }),
      ],
    });
    fakeActors.push(existing);

    const result = await createOrUpdateActor(
      makeActorImportData("aldric", "c"),
      [makeItem("Fresh Slam")],
    );
    expect(result).toBe("updated");
    expect(existing._calls.delete).toHaveLength(1);
    expect(existing._calls.delete[0]).toEqual({ type: "Item", ids: ["i-1", "i-2"] });
    expect(existing._calls.create).toHaveLength(1);
    expect((existing._calls.create[0]!.data as DnD5eItemData[]).map((i) => i.name)).toEqual(["Fresh Slam"]);
  });

  it("re-imports: leaves user-authored items untouched", async () => {
    const existing = makeFakeActor({
      slug: "aldric", campaignId: "c",
      items: [
        makeFakeItem({ id: "i-bridge",    source: ITEM_SOURCE_MARKER }),
        makeFakeItem({ id: "i-user-1",    source: "user-created" }),
        makeFakeItem({ id: "i-user-bare", source: "" }),
      ],
    });
    fakeActors.push(existing);

    await createOrUpdateActor(
      makeActorImportData("aldric", "c"),
      [makeItem("Replacement")],
    );
    expect(existing._calls.delete[0]?.ids).toEqual(["i-bridge"]);
    // i-user-1 and i-user-bare survive.
    expect(existing._calls.delete[0]?.ids).not.toContain("i-user-1");
    expect(existing._calls.delete[0]?.ids).not.toContain("i-user-bare");
  });

  it("re-imports: empty new-item list still deletes stale bridge-marked items", async () => {
    const existing = makeFakeActor({
      slug: "aldric", campaignId: "c",
      items: [makeFakeItem({ id: "i-stale", source: ITEM_SOURCE_MARKER })],
    });
    fakeActors.push(existing);

    await createOrUpdateActor(makeActorImportData("aldric", "c"), []);
    expect(existing._calls.delete[0]?.ids).toEqual(["i-stale"]);
    expect(existing._calls.create).toEqual([]);
  });

  it("re-imports: no-op when neither old nor new items exist", async () => {
    const existing = makeFakeActor({ slug: "aldric", campaignId: "c", items: [] });
    fakeActors.push(existing);
    await createOrUpdateActor(makeActorImportData("aldric", "c"), []);
    expect(existing._calls.delete).toEqual([]);
    expect(existing._calls.create).toEqual([]);
  });
});
