/**
 * Orchestrator for the NPC import flow (S4 — `dm-assistant-foundry-bridge#2`).
 *
 *   1. Fetch the payload from `/foundry/npc/{slug}`
 *   2. Build the actor + companion-journal data (pure, see
 *      `translators/common/buildActorData`)
 *   3. Download portrait + thumb if present, upload via FilePicker,
 *      thread the resulting paths back into the actor data
 *   4. Create or update the actor (drift policy: dm-assistant wins)
 *   5. Create / update / delete the companion journal so it matches
 *      the payload's `dm_sections`
 *   6. Surface a Foundry toast with the outcome
 *
 * Errors are propagated; the caller (picker dialog handler) catches
 * + surfaces via `ui.notifications.error`. No swallowed exceptions.
 *
 * CC integration — v1 gap. dm-assistant-bridge does not attempt to
 * convert imported actors into Campaign Codex sheets in v1. CC's
 * documented API (`convertJournalToCCSheet`) is journal-side; no
 * stable actor-side path exists. Future SPIKE will revisit; see
 * the README "Campaign Codex" section + the issue tracker for the
 * v1 gap note.
 */

import { fetchImageBytes, fetchNpc, type ClientOptions } from "../api/client.js";
import { buildImportBundle } from "../translators/common/buildActorData.js";
import {
  createOrUpdateActor,
  createOrUpdateJournal,
  deleteJournalIfExists,
  withImagePaths,
  type PersistResult,
} from "../foundry/documents.js";
import { uploadToFoundry } from "../foundry/upload.js";
import { log } from "../lib/log.js";

export interface ImportNpcOptions extends ClientOptions {
  campaignId:       string;
  slug:             string;
  dataPrefix:       string;          // Foundry Data/ root for uploads
  contractVersion?: string;
}

export interface ImportNpcResult {
  slug:         string;
  actor:        PersistResult;
  journal:      PersistResult | "skipped" | "deleted";
  uploadedImage: boolean;
}

export async function importNpc(opts: ImportNpcOptions): Promise<ImportNpcResult> {
  log.info("importing NPC", opts.slug);

  const payload = await fetchNpc(opts);
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
      kind:       "npc",
      filename:   `${opts.slug}.png`,
      blob,
    });
  }
  if (payload.thumb_url) {
    const blob = await fetchImageBytes({ ...opts, path: payload.thumb_url });
    thumbPath = await uploadToFoundry({
      dataPrefix: opts.dataPrefix,
      campaignId: opts.campaignId,
      kind:       "npc",
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
    // companion journal so re-import is consistent with the source.
    const deleted = await deleteJournalIfExists(opts.slug, opts.campaignId);
    journalResult = deleted ? "deleted" : "skipped";
  }

  return {
    slug:          opts.slug,
    actor:         actorResult,
    journal:       journalResult,
    uploadedImage: portraitPath !== null,
  };
}
