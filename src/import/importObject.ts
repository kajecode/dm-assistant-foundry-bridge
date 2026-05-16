/**
 * Standalone Object importer (#504).
 *
 * Imports a registered dm-a Objects-Library object as a first-class
 * **world `Item`** document (the Items sidebar tab), not embedded on
 * an Actor. This is the path the smoke finding "objects don't show in
 * Items" asked for; the same object also still embeds on any NPC that
 * wields it (the v0.7.0 resolver path) — that's additive, not
 * either/or.
 *
 * Lifecycle (mirrors `importJournal`):
 *
 *   1. Fetch `/foundry/object/{slug}` (the v0.30.0 / contract-0.5.0
 *      endpoint).
 *   2. Build the Item data via the SHARED builder
 *      (`translators/dnd5e/objectItem.ts`) so it is byte-identical to
 *      the embedded-resolution path.
 *   3. Add the world-document identity flags (`campaign_id`, `kind:
 *      "object-item"`) + resolve the `<prefix> — Items` folder.
 *   4. Create-or-update the world Item (drift policy: dm-assistant
 *      wins; idempotent on `{slug, campaign_id, kind}`).
 *
 * v2a is narrative-only: no FilePicker image upload — the object's
 * `img` is the absolute dm-a image URL the shared builder baked in
 * (same as the resolver path). Documented as a known limit.
 *
 * Errors propagate; the picker callback catches + surfaces them.
 */

import {
  fetchObject,
  type ClientOptions,
} from "../api/client.js";
import type { FoundryObjectResponse } from "../api/types.js";
import { buildObjectItemData } from "../translators/dnd5e/objectItem.js";
import {
  createOrUpdateObjectItem,
  type ObjectItemImportData,
  type PersistResult,
} from "../foundry/documents.js";
import { resolveItemsFolderId } from "../foundry/folders.js";
import { MODULE_ID } from "../settings/keys.js";
import { log } from "../lib/log.js";

export interface ImportObjectOptions extends ClientOptions {
  campaignId: string;
  slug:       string;
}

export interface ImportObjectResult {
  slug: string;
  item: PersistResult;
}

/**
 * Persist an already-fetched object payload as the world Item.
 * Shared by the standalone importer AND the actions-resolution
 * post-pass (an NPC wields a registered object → the embedded item
 * is created by the resolver; this also refreshes the browsable
 * world copy). Idempotent: one world doc per (object slug,
 * campaign), updated in place on re-import.
 */
export async function persistObjectWorldItem(
  payload:    FoundryObjectResponse,
  baseUrl:    string,
  campaignId: string,
): Promise<PersistResult> {
  // Shared builder — identical Item data to the embedded-resolution
  // path. Standalone identity: slug + display name come from the
  // object itself (there's no wielding-NPC stub here).
  const base = buildObjectItemData(payload, baseUrl, {
    slug:       payload.slug,
    originName: payload.name,
  });

  // Resolve the world Items folder (idempotent find-or-create) and
  // stamp the world-document identity flags so re-imports update in
  // place rather than duplicating.
  const folder = await resolveItemsFolderId();
  const item: ObjectItemImportData = {
    ...base,
    folder,
    flags: {
      [MODULE_ID]: {
        ...base.flags[MODULE_ID],
        campaign_id: campaignId,
        kind:        "object-item",
      },
    } as ObjectItemImportData["flags"],
  };

  return createOrUpdateObjectItem(item);
}

export async function importObject(opts: ImportObjectOptions): Promise<ImportObjectResult> {
  log.info("importing object", opts.slug);

  const payload = await fetchObject({
    baseUrl:    opts.baseUrl,
    apiKey:     opts.apiKey,
    timeoutMs:  opts.timeoutMs,
    campaignId: opts.campaignId,
    slug:       opts.slug,
  });

  const result = await persistObjectWorldItem(payload, opts.baseUrl, opts.campaignId);
  return { slug: opts.slug, item: result };
}
