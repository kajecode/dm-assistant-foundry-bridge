/**
 * Orchestrator for actor import (NPCs + Creatures alike).
 *
 *   1. Fetch payload from `/foundry/actor/{kind}/{slug}` (contract 0.2.0+)
 *   2. Build the actor + companion-journal data (pure — see
 *      `translators/common/buildActorData`)
 *   3. Download portrait + thumb if present, upload via FilePicker,
 *      thread the resulting paths back into the actor data
 *   4. Create or update the actor (drift policy: dm-assistant wins;
 *      identity is `flags.dm-assistant-bridge.slug` + `kind`)
 *   5. Create / update / delete the companion journal so it matches
 *      the payload's `dm_sections`
 *   6. Surface a Foundry toast with the outcome
 *
 * Errors propagate; the caller (picker dialog handler) catches +
 * surfaces via `ui.notifications.error`. No swallowed exceptions.
 *
 * CC integration — v1 gap. dm-assistant-bridge does not attempt to
 * convert imported actors into Campaign Codex sheets in v1. CC's
 * documented API (`convertJournalToCCSheet`) is journal-side; no
 * stable actor-side path exists. Tracked separately in #13.
 *
 * History: this module was `importNpc.ts` before the unified
 * `/foundry/actor/{kind}/{slug}` endpoint (dm-assistant contract
 * 0.2.0, bridge#19). Renamed + parameterized by `kind` so the same
 * orchestrator covers NPCs and Creatures without duplicating logic.
 */

import type { ActorKind }                        from "../api/types.js";
import { fetchActor, fetchImageBytes, type ClientOptions } from "../api/client.js";
import { buildImportBundle }                     from "../translators/common/buildActorData.js";
import {
  createOrUpdateActor,
  createOrUpdateJournal,
  deleteJournalIfExists,
  withImagePaths,
  type PersistResult,
} from "../foundry/documents.js";
import { uploadToFoundry } from "../foundry/upload.js";
import { log } from "../lib/log.js";

export interface ImportActorOptions extends ClientOptions {
  campaignId:       string;
  slug:             string;
  kind:             ActorKind;
  dataPrefix:       string;          // Foundry Data/ root for uploads
  contractVersion?: string;
}

export interface ImportActorResult {
  slug:          string;
  kind:          ActorKind;
  actor:         PersistResult;
  journal:       PersistResult | "skipped" | "deleted";
  uploadedImage: boolean;
}

/**
 * Unified importer. Works for both `kind="npc"` and `kind="creature"`;
 * the only kind-aware bits are the fetch URL (`fetchActor`), the
 * upload subfolder, and the document-identity flag — same orchestrator
 * covers both with no branching.
 */
export async function importActor(opts: ImportActorOptions): Promise<ImportActorResult> {
  log.info("importing", opts.kind, opts.slug);

  const payload = await fetchActor({
    baseUrl:    opts.baseUrl,
    apiKey:     opts.apiKey,
    timeoutMs:  opts.timeoutMs,
    campaignId: opts.campaignId,
    slug:       opts.slug,
    kind:       opts.kind,
  });
  const bundle  = buildImportBundle(payload, {
    campaignId:      opts.campaignId,
    contractVersion: opts.contractVersion,
  });

  let portraitPath: string | null = null;
  let thumbPath:    string | null = null;
  if (payload.portrait_url) {
    const blob = await fetchImageBytes({ ...opts, path: payload.portrait_url });
    portraitPath = await uploadToFoundry({
      dataPrefix: opts.dataPrefix,
      campaignId: opts.campaignId,
      kind:       opts.kind,           // "npc" or "creature" subfolder
      filename:   `${opts.slug}.png`,
      blob,
    });
  }
  if (payload.thumb_url) {
    const blob = await fetchImageBytes({ ...opts, path: payload.thumb_url });
    thumbPath = await uploadToFoundry({
      dataPrefix: opts.dataPrefix,
      campaignId: opts.campaignId,
      kind:       opts.kind,
      filename:   `${opts.slug}.thumb.png`,
      blob,
    });
  }

  const actorWithImages = withImagePaths(bundle.actor, portraitPath, thumbPath);
  const actorResult     = await createOrUpdateActor(actorWithImages);

  let journalResult: PersistResult | "skipped" | "deleted";
  if (bundle.journal) {
    journalResult = await createOrUpdateJournal(bundle.journal);
  } else {
    // Payload has no dm_sections — drop any previously-imported
    // companion journal so re-import is consistent with source.
    // Journal lookup is by `slug + campaign + kind` so creature
    // and NPC journals with the same slug don't collide.
    const deleted = await deleteJournalIfExists(opts.slug, opts.campaignId, opts.kind);
    journalResult = deleted ? "deleted" : "skipped";
  }

  return {
    slug:          opts.slug,
    kind:          opts.kind,
    actor:         actorResult,
    journal:       journalResult,
    uploadedImage: portraitPath !== null,
  };
}

// ─── Back-compat shims ──────────────────────────────────────────────────────

export type ImportNpcOptions = Omit<ImportActorOptions, "kind">;
export type ImportNpcResult  = Omit<ImportActorResult,  "kind">;

/** Back-compat shim — pre-0.2.0 console macros / external callers
 *  keep working without code changes. Internal callers should use
 *  `importActor({ kind: "npc", ... })` directly. */
export function importNpc(opts: ImportNpcOptions): Promise<ImportActorResult> {
  return importActor({ ...opts, kind: "npc" });
}
