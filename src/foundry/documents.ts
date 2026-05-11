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

import type { ActorImportData, JournalImportData } from "../translators/common/buildActorData.js";
import { MODULE_ID } from "../translators/common/buildActorData.js";
import { log } from "../lib/log.js";

interface FoundryDocLike {
  id:        string;
  uuid:      string;
  getFlag:   (scope: string, key: string) => unknown;
  update:    (data: Record<string, unknown>) => Promise<unknown>;
  delete:    () => Promise<unknown>;
}

interface FoundryActorClass {
  create:  (data: Record<string, unknown>) => Promise<FoundryDocLike | null>;
}

interface FoundryJournalClass {
  create:  (data: Record<string, unknown>) => Promise<FoundryDocLike | null>;
}

declare const Actor:        FoundryActorClass;
declare const JournalEntry: FoundryJournalClass;
declare const game: {
  actors:   { find: (cb: (d: FoundryDocLike) => boolean) => FoundryDocLike | undefined };
  journal:  { find: (cb: (d: FoundryDocLike) => boolean) => FoundryDocLike | undefined };
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

function matchesSlug(d: FoundryDocLike, slug: string, campaignId: string, kind: string): boolean {
  const flags = d.getFlag(MODULE_ID, "slug") === slug
             && d.getFlag(MODULE_ID, "campaign_id") === campaignId;
  if (!flags) return false;
  const flagKind = d.getFlag(MODULE_ID, "kind");
  return flagKind === kind;
}

export async function createOrUpdateActor(actor: ActorImportData): Promise<PersistResult> {
  const slug       = actor.flags[MODULE_ID].slug;
  const campaignId = actor.flags[MODULE_ID].campaign_id;
  const existing   = game.actors.find((a) => matchesSlug(a, slug, campaignId, "npc-actor"));
  if (existing) {
    await existing.update(actor as unknown as Record<string, unknown>);
    log.info("actor updated", slug, existing.uuid);
    return "updated";
  }
  const created = await Actor.create(actor as unknown as Record<string, unknown>);
  log.info("actor created", slug, created?.uuid);
  return "created";
}

export async function createOrUpdateJournal(journal: JournalImportData): Promise<PersistResult> {
  const slug       = journal.flags[MODULE_ID].slug;
  const campaignId = journal.flags[MODULE_ID].campaign_id;
  const existing   = game.journal.find((j) => matchesSlug(j, slug, campaignId, "npc-dm-notes"));
  if (existing) {
    await existing.update(journal as unknown as Record<string, unknown>);
    log.info("journal updated", slug, existing.uuid);
    return "updated";
  }
  const created = await JournalEntry.create(journal as unknown as Record<string, unknown>);
  log.info("journal created", slug, created?.uuid);
  return "created";
}

/**
 * Delete the companion DM-notes journal for a slug if it exists.
 * Used when re-importing a payload whose `dm_sections` is now empty
 * (we had a journal previously but the payload no longer needs one).
 */
export async function deleteJournalIfExists(slug: string, campaignId: string): Promise<boolean> {
  const existing = game.journal.find((j) => matchesSlug(j, slug, campaignId, "npc-dm-notes"));
  if (!existing) return false;
  await existing.delete();
  log.info("orphan journal deleted", slug);
  return true;
}
