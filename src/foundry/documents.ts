/**
 * Foundry Actor + JournalEntry create-or-update helpers.
 *
 * Drift policy: dm-assistant wins. On re-import, find the existing
 * doc by `flags.dm-assistant-bridge.slug` and update; if no match,
 * create. No merge UI, no conflict prompt — invariant #2 in
 * CLAUDE.md.
 *
 * Two helpers, one per document type, so the orchestrator can do
 * them in sequence and keep the failure modes distinct.
 */

import type { ActorImportData, FlagKind, JournalImportData } from "../translators/common/buildActorData.js";
import { MODULE_ID, flagKindFor } from "../translators/common/buildActorData.js";
import type { DnD5eItemData } from "../translators/dnd5e/items.js";
import { ITEM_SOURCE_MARKER } from "../translators/dnd5e/items.js";
import type { ActorKind } from "../api/types.js";
import { log } from "../lib/log.js";

interface FoundryDocLike {
  id:        string;
  uuid:      string;
  getFlag:   (scope: string, key: string) => unknown;
  update:    (data: Record<string, unknown>) => Promise<unknown>;
  delete:    () => Promise<unknown>;
}

/** Subset of `Item` document fields the items drift-pass reads. */
interface FoundryItemLike {
  id:      string;
  getFlag: (scope: string, key: string) => unknown;
}

/** Subset of `Actor` document API the items drift-pass uses. The
 *  v13 actor's `items` collection exposes the same Array-like
 *  `.contents` shape as `pages` on JournalEntry. */
interface FoundryActorLike extends FoundryDocLike {
  items: {
    contents?: FoundryItemLike[];
  };
  deleteEmbeddedDocuments: (type: string, ids: string[]) => Promise<unknown>;
  createEmbeddedDocuments: (type: string, data: unknown[]) => Promise<unknown>;
}

interface FoundryEmbeddedPage {
  id: string;
}

interface FoundryJournalLike extends FoundryDocLike {
  // Foundry v13 keeps journal pages as a Collection on the journal
  // document. The Collection exposes Array-like `map()` and a
  // `.contents` getter — we use `.contents` for safety.
  pages: {
    contents?:  FoundryEmbeddedPage[];
    map?:       <T>(fn: (p: FoundryEmbeddedPage) => T) => T[];
    size?:      number;
  };
  deleteEmbeddedDocuments: (type: string, ids: string[]) => Promise<unknown>;
  createEmbeddedDocuments: (type: string, data: unknown[]) => Promise<unknown>;
}

interface FoundryActorClass {
  create:  (data: Record<string, unknown>) => Promise<FoundryActorLike | null>;
}

interface FoundryJournalClass {
  create:  (data: Record<string, unknown>) => Promise<FoundryJournalLike | null>;
}

/** Top-level (world) `Item` document — the standalone Object import
 *  (#504). Distinct from the embedded actor-items handled by
 *  `syncEmbeddedItems`; these live in the Items sidebar tab. Same
 *  doc surface as Actor/Journal (id, uuid, getFlag, update). */
type FoundryWorldItemLike = FoundryDocLike;

interface FoundryItemClass {
  create:  (data: Record<string, unknown>) => Promise<FoundryWorldItemLike | null>;
}

declare const Actor:        FoundryActorClass;
declare const JournalEntry: FoundryJournalClass;
declare const Item:         FoundryItemClass;
declare const game: {
  actors:   { find: (cb: (d: FoundryActorLike) => boolean)       => FoundryActorLike | undefined };
  journal:  { find: (cb: (d: FoundryJournalLike) => boolean)    => FoundryJournalLike | undefined };
  items:    { find: (cb: (d: FoundryWorldItemLike) => boolean)  => FoundryWorldItemLike | undefined };
};

export type PersistResult = "created" | "updated";

/**
 * Resolve a portrait + token-texture path pair into the final actor
 * data. Strings the `img` / `prototypeToken.texture.src` slots that
 * `buildImportBundle` left null.
 */
export function withImagePaths(
  actor:       ActorImportData,
  portrait:    string | null,
  thumb:       string | null,
): ActorImportData {
  return {
    ...actor,
    img: portrait ?? "icons/svg/mystery-man.svg",
    prototypeToken: {
      ...actor.prototypeToken,
      texture: { src: thumb ?? actor.prototypeToken.texture.src ?? "icons/svg/mystery-man.svg" },
    },
  };
}

function matchesSlug(d: FoundryDocLike, slug: string, campaignId: string, kind: FlagKind): boolean {
  const flags = d.getFlag(MODULE_ID, "slug") === slug
             && d.getFlag(MODULE_ID, "campaign_id") === campaignId;
  if (!flags) return false;
  const flagKind = d.getFlag(MODULE_ID, "kind");
  return flagKind === kind;
}

/**
 * Create or update an Actor + sync its embedded `Item` documents
 * (bridge#20). The drift policy for items mirrors journal pages: on
 * re-import we drop the bridge-marked items and re-create from the
 * translated list. User-authored items (no `dm-assistant` source
 * flag) are left untouched.
 *
 * `items` is optional; pass `[]` when the payload had no embedded
 * actions (or pre-#485 dm-assistant). In that case the existing
 * actor still gets any prior bridge-marked items removed — the
 * import becomes a "no items" assertion.
 */
export async function createOrUpdateActor(
  actor: ActorImportData,
  items: DnD5eItemData[] = [],
): Promise<PersistResult> {
  const slug       = actor.flags[MODULE_ID].slug;
  const campaignId = actor.flags[MODULE_ID].campaign_id;
  // Identity discriminant comes from the actor data's own flag, so
  // creature actors don't get matched as NPC actors and vice versa
  // (#19 — drift policy is per-kind).
  const flagKind   = actor.flags[MODULE_ID].kind;
  const existing   = game.actors.find((a) => matchesSlug(a, slug, campaignId, flagKind));
  if (existing) {
    await existing.update(actor as unknown as Record<string, unknown>);
    await syncEmbeddedItems(existing, items, slug);
    log.info("actor updated", flagKind, slug, existing.uuid, `(${items.length} items)`);
    return "updated";
  }
  const created = await Actor.create(actor as unknown as Record<string, unknown>);
  if (created && items.length > 0) {
    await created.createEmbeddedDocuments("Item", items);
  }
  log.info("actor created", flagKind, slug, created?.uuid, `(${items.length} items)`);
  return "created";
}


/**
 * Drop-and-replace sync for the actor's embedded Items.
 *
 *   1. Filter actor.items by `flags.dm-assistant-bridge.source ===
 *      "dm-assistant"` — leaves user-authored items alone.
 *   2. Delete the bridge-marked items via the embedded-document
 *      API (a bare `actor.update({items: [...]})` would either
 *      duplicate or be ignored — Foundry requires explicit
 *      embedded-doc mutations).
 *   3. Create the freshly-translated items.
 *
 * No-op when both the existing bridge-marked set and the new set
 * are empty.
 */
async function syncEmbeddedItems(
  actor: FoundryActorLike,
  items: DnD5eItemData[],
  slug:  string,
): Promise<void> {
  const existing = actor.items.contents ?? [];
  const bridgeMarkedIds = existing
    .filter((it) => it.getFlag(MODULE_ID, "source") === ITEM_SOURCE_MARKER)
    .map((it) => it.id);

  if (bridgeMarkedIds.length > 0) {
    await actor.deleteEmbeddedDocuments("Item", bridgeMarkedIds);
    log.debug("items: deleted", bridgeMarkedIds.length, "bridge-marked items for", slug);
  }
  if (items.length > 0) {
    await actor.createEmbeddedDocuments("Item", items);
    log.debug("items: created", items.length, "items for", slug);
  }
}

export async function createOrUpdateJournal(journal: JournalImportData): Promise<PersistResult> {
  const slug       = journal.flags[MODULE_ID].slug;
  const campaignId = journal.flags[MODULE_ID].campaign_id;
  const flagKind   = journal.flags[MODULE_ID].kind;
  const existing   = game.journal.find((j) => matchesSlug(j, slug, campaignId, flagKind));
  if (existing) {
    // Foundry's `JournalEntry.update({pages: [...]})` does NOT
    // replace the embedded pages collection — it leaves the old
    // pages alone and creates new ones alongside, producing
    // duplicates on re-import. Pages are child documents and need
    // the embedded-document API: delete the old set first, then
    // create the new set. (Caught in S4 smoke when re-importing
    // an updated NPC.)
    //
    // Split the update payload: scalar props (name, ownership,
    // flags) flow through `update()`; the `pages` array routes
    // through the embedded-document path.
    const { pages, ...metadata } = journal;
    await existing.update(metadata as unknown as Record<string, unknown>);

    const oldPageIds = (existing.pages.contents ?? []).map((p) => p.id);
    if (oldPageIds.length > 0) {
      await existing.deleteEmbeddedDocuments("JournalEntryPage", oldPageIds);
    }
    if (pages.length > 0) {
      await existing.createEmbeddedDocuments("JournalEntryPage", pages);
    }
    log.info("journal updated", slug, existing.uuid, `(${pages.length} pages)`);
    return "updated";
  }
  const created = await JournalEntry.create(journal as unknown as Record<string, unknown>);
  log.info("journal created", slug, created?.uuid);
  return "created";
}

/** A standalone world Object Item (#504). The shared
 *  `buildObjectItemData` output, plus the world-document identity
 *  flags (`campaign_id`, `kind`) and a `folder`. */
export type ObjectItemImportData = DnD5eItemData & { folder?: string };

/**
 * Create or update a standalone world `Item` from a registered
 * dm-a object (#504). Drift policy mirrors Actor/Journal: find the
 * existing Item by `flags.dm-assistant-bridge.{slug, campaign_id,
 * kind}` and overwrite, else create. Idempotent across re-imports
 * and across however many NPCs reference the same object — one
 * world doc per (object slug, campaign).
 *
 * Unlike Actors/Journals there are no embedded child documents to
 * sync (the lore lives in `system.description`), so this is a plain
 * update-or-create.
 */
export async function createOrUpdateObjectItem(
  item: ObjectItemImportData,
): Promise<PersistResult> {
  const f          = item.flags[MODULE_ID];
  const slug       = f.slug;
  const campaignId = f.campaign_id ?? "";
  const flagKind   = (f.kind ?? "object-item") as FlagKind;
  const existing   = game.items.find((d) => matchesSlug(d, slug, campaignId, flagKind));
  if (existing) {
    await existing.update(item as unknown as Record<string, unknown>);
    log.info("object item updated", slug, existing.uuid);
    return "updated";
  }
  const created = await Item.create(item as unknown as Record<string, unknown>);
  log.info("object item created", slug, created?.uuid);
  return "created";
}

/**
 * Delete the companion DM-notes journal for a slug if it exists.
 * Used when re-importing a payload whose `dm_sections` is now empty
 * (we had a journal previously but the payload no longer needs one).
 *
 * `entityKind` distinguishes between NPC and Creature journals so a
 * creature with the same slug as an NPC doesn't accidentally drop
 * the NPC's journal. Defaults to "npc" for back-compat with any
 * caller that hasn't been updated for #19's kind plumbing.
 */
export async function deleteJournalIfExists(
  slug:       string,
  campaignId: string,
  entityKind: ActorKind = "npc",
): Promise<boolean> {
  const flagKind = flagKindFor(entityKind, "dm-notes");
  const existing = game.journal.find((j) => matchesSlug(j, slug, campaignId, flagKind));
  if (!existing) return false;
  await existing.delete();
  log.info("orphan journal deleted", flagKind, slug);
  return true;
}
