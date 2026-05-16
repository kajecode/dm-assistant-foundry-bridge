/**
 * Unified orchestrator for Shop + Location import (#25 / #26 —
 * bridge v0.4.0).
 *
 * Same lifecycle as `importActor` but for journal-shaped entities:
 *
 *   1. Fetch the payload from `/foundry/shop/{slug}` or
 *      `/foundry/location/{slug}` (per `opts.kind`)
 *   2. Build the JournalEntry import data (pure — see
 *      `translators/common/buildJournalData`)
 *   3. Download the hero image bytes (`establishment_image_url`
 *      for shops, `map_image_url` for locations), upload via
 *      FilePicker, thread the resulting path back in
 *   4. Resolve the per-kind Foundry folder
 *      (`<prefix> — Shops` / `— Locations`)
 *   5. Create or update the JournalEntry (drift policy:
 *      dm-assistant wins, identity via
 *      `flags.dm-assistant-bridge.{slug, campaign_id, kind}`)
 *   6. Surface a Foundry toast with the outcome
 *
 * Errors propagate; the picker dialog's callback catches +
 * surfaces via `ui.notifications.error`. No swallowed exceptions.
 */

import type {
  FoundryJournalResponse,
  JournalKind,
} from "../api/types.js";
import {
  fetchFaction,
  fetchImageBytes,
  fetchLocation,
  fetchShop,
  type ClientOptions,
} from "../api/client.js";
import { buildJournalBundle, withJournalImage } from "../translators/common/buildJournalData.js";
import { createOrUpdateJournal, type PersistResult } from "../foundry/documents.js";
import { resolveJournalFolderId } from "../foundry/folders.js";
import { uploadToFoundry } from "../foundry/upload.js";
import { log } from "../lib/log.js";

export interface ImportJournalOptions extends ClientOptions {
  campaignId:       string;
  slug:             string;
  kind:             JournalKind;
  dataPrefix:       string;          // Foundry Data/ root for uploads
  contractVersion?: string;
}

export interface ImportJournalResult {
  slug:          string;
  kind:          JournalKind;
  journal:       PersistResult;
  uploadedImage: boolean;
}

export async function importJournal(opts: ImportJournalOptions): Promise<ImportJournalResult> {
  log.info("importing", opts.kind, opts.slug);

  // Per-kind fetch — all routes return the same union shape
  // (FoundryJournalResponse = shop | location | faction), resolved
  // via `payload.kind` downstream.
  const fetchArgs = {
    baseUrl:    opts.baseUrl,
    apiKey:     opts.apiKey,
    timeoutMs:  opts.timeoutMs,
    campaignId: opts.campaignId,
    slug:       opts.slug,
  };
  const payload: FoundryJournalResponse =
    opts.kind === "shop"
      ? await fetchShop(fetchArgs)
      : opts.kind === "faction"
        ? await fetchFaction(fetchArgs)
        : await fetchLocation(fetchArgs);

  const bundle = buildJournalBundle(payload, {
    campaignId:      opts.campaignId,
    contractVersion: opts.contractVersion,
  });

  // Hero image — per-kind field on the payload. Shops use
  // `establishment_image_url`, locations `map_image_url`, factions
  // the neutral `image_url` (a sigil/banner). Same upload pipeline;
  // only the source field differs.
  const imageUrl =
    payload.kind === "shop"     ? payload.establishment_image_url :
    payload.kind === "faction"  ? payload.image_url :
                                  payload.map_image_url;

  let imgPath: string | null = null;
  if (imageUrl) {
    const blob = await fetchImageBytes({ ...opts, path: imageUrl });
    imgPath = await uploadToFoundry({
      dataPrefix: opts.dataPrefix,
      campaignId: opts.campaignId,
      kind:       opts.kind,           // "shop" / "location" subfolder
      filename:   `${opts.slug}.png`,
      blob,
    });
  }

  // Resolve folder before persist. Idempotent — find-or-create
  // returns the same id on subsequent imports.
  const folderId = await resolveJournalFolderId(opts.kind);

  const journalData = {
    ...withJournalImage(bundle, imgPath),
    folder: folderId,
  };
  const journalResult = await createOrUpdateJournal(journalData);

  return {
    slug:          opts.slug,
    kind:          opts.kind,
    journal:       journalResult,
    uploadedImage: imgPath !== null,
  };
}
