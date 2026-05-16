/**
 * Shared dm-a Objects-Library → dnd5e `Item` data builder (#504).
 *
 * Extracted from `foundry/compendiumResolve.ts::buildFromObject` so
 * BOTH consumers produce byte-identical Item data:
 *
 *   1. the actions-resolution post-pass (an NPC wields a registered
 *      object → the embedded actor Item is swapped for this), and
 *   2. the standalone Object importer (`import/importObject.ts`) that
 *      creates the same thing as a world `Item` document.
 *
 * v2a is **narrative-only**: authoritative authored name + DM lore
 * (rendered to HTML) + image; a clean stub `system` (no mechanics —
 * the DM-authored object is identity-authoritative and mechanics are
 * deferred to v2b, mirroring how the v0.5.2 spell stubs work).
 *
 * The bridge drift marker (`source: "dm-assistant"`) is always set so
 * re-import drop-and-replace cleans the item. `resolved_from` carries
 * the namespaced `dm-assistant:object/<slug>` provenance string (NOT
 * a Foundry UUID — never fed to `fromUuid`, never a compendium copy).
 */

import type { FoundryObjectResponse } from "../../api/types.js";
import { joinApiPath } from "../../api/client.js";
import { renderMarkdown } from "../../lib/markdown.js";
import { MODULE_ID } from "../../settings/keys.js";
import {
  ITEM_SOURCE_MARKER,
  type DnD5eItemData,
} from "./items.js";
import type { ActionItemType } from "./types.js";

const _OBJECT_ALLOWED: ReadonlySet<ActionItemType> = new Set<ActionItemType>([
  "weapon", "feat", "spell", "equipment", "consumable", "tool", "loot",
]);

/** Coerce a dm-a `item_type` string to a bridge `ActionItemType`,
 *  defaulting to `loot` for anything unrecognised (matches the
 *  server-side default in `_object_item_type`). */
export function coerceObjectItemType(rawItemType: string | undefined): ActionItemType {
  const t = (rawItemType ?? "").trim().toLowerCase() as ActionItemType;
  return _OBJECT_ALLOWED.has(t) ? t : "loot";
}

export interface ObjectItemIdentity {
  /** Stable item slug for the bridge flag. Resolver path passes the
   *  matched stub's slug; the standalone importer passes the object
   *  slug. */
  slug:       string;
  /** Original LLM/authored item name for the `origin_name` flag
   *  (resolver name-search anchor). Standalone importer passes the
   *  object's display name. */
  originName: string;
  /** Image to fall back to when the object has no `image_url`
   *  (resolver: the stub's existing img; standalone: undefined). */
  fallbackImg?: string;
}

/**
 * Pure transform — no Foundry globals, no I/O. Produces the
 * persist-ready `DnD5eItemData` for a dm-a object payload.
 */
export function buildObjectItemData(
  obj:      FoundryObjectResponse,
  baseUrl:  string,
  identity: ObjectItemIdentity,
): DnD5eItemData {
  const img = obj.image_url
    ? joinApiPath(baseUrl, obj.image_url)
    : identity.fallbackImg;

  return {
    // The authored object's real campaign name is authoritative —
    // NOT the `(actor)`-decorated stub display name (that decoration
    // is for natural attacks / SRD gear, not a named unique object).
    name: obj.name,
    type: coerceObjectItemType(obj.item_type),
    img,
    system: {
      description: {
        value:        renderMarkdown(obj.description_md ?? ""),
        chat:         "",
        unidentified: "",
      },
    },
    flags: {
      [MODULE_ID]: {
        slug:              identity.slug,
        source:            ITEM_SOURCE_MARKER,
        origin_name:       identity.originName,
        compendium_source: null,
        object_slug:       obj.slug,
        resolved_from:     `dm-assistant:object/${obj.slug}`,
      },
    } as DnD5eItemData["flags"],
  };
}
