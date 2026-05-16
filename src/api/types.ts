/**
 * TypeScript mirror of the Pydantic response models in
 * dm-assistant's `api/routers/foundry.py`. These types describe the
 * wire shape; they are NOT the source of truth — the dm-assistant
 * router is.
 *
 * Bump in lockstep with the API contract version. If a field shape
 * looks unclear, defer to `docs/foundry-api-contract.md` in the
 * dm-assistant repo over re-deriving the shape locally.
 */

export interface DeprecatedField {
  field:            string;
  deprecated_in:    string;
  planned_removal:  string;
  replacement:      string;
  notes:            string;
}

export interface FoundryHealthResponse {
  status:                  "ok";
  api_contract_version:    string;
  dm_assistant_version:    string;
  deprecations:            DeprecatedField[];
}

export interface FoundrySection {
  name:    string;
  body_md: string;
}

/** Kinds the unified `/foundry/actor/{kind}/{slug}` endpoint serves
 *  (dm-assistant contract 0.2.0+). Both translate to a Foundry Actor
 *  of type `npc` in dnd5e — monsters share the same Actor type as
 *  NPCs. PC joins later when dm-assistant#248 stabilises. */
export type ActorKind = "npc" | "creature";

/** Item shape from `GET /campaigns?role=dm`. Drives the settings
 *  campaign-picker dropdown (#12). Not a `/foundry/*` route — never
 *  API-key gated. */
export interface CampaignSummary {
  id:           string;
  name:         string;
  game_system:  string;
  chroma_ready: boolean;
}

export interface CampaignListResponse {
  campaigns: CampaignSummary[];
}

export interface SavedNpcSummary {
  slug:        string;
  name:        string;
  region:      string;
  modified_at: string;
  has_image:   boolean;
  thumb_url:   string;
}

export interface SavedNpcListResponse {
  saved: SavedNpcSummary[];
}

/** Item shape from `/creature-generate/saved`. Mirrors the NPC summary
 *  except creatures have no `region` field (creatures aren't tied to
 *  a location in the same way NPCs are). */
export interface SavedCreatureSummary {
  slug:        string;
  name:        string;
  filename:    string;
  modified_at: string;
  has_image:   boolean;
  thumb_url:   string;
}

export interface SavedCreatureListResponse {
  saved: SavedCreatureSummary[];
}

export interface FoundryActorResponse {
  slug:           string;
  kind:           ActorKind;
  name:           string;
  display_name:   string;
  portrait_url:   string | null;
  thumb_url:      string | null;
  front_matter:   Record<string, unknown>;
  sections:       FoundrySection[];
  dm_sections:    FoundrySection[];
  audit: {
    source_path: string;
    modified_at: string;
  };
}

/** Back-compat alias — same shape as `FoundryActorResponse` with
 *  `kind` allowed to widen beyond "npc" (dm-assistant 0.2.0 unified
 *  the endpoint). Callers pinned to this name keep working. */
export type FoundryNpcResponse = FoundryActorResponse;


// ── Foundry v2 endpoints (dm-assistant contract 0.3.0+) ───────────────────


/** Kinds the per-kind journal endpoints serve. Each maps to a
 *  Foundry `JournalEntry` (optionally a Campaign Codex sheet of
 *  the matching CC type). v0.3.0 ships shop + location; faction
 *  lands later. */
export type JournalKind = "shop" | "location" | "faction";

/** Item shape from `/shop-generate/saved` — mirrors the
 *  creature-summary shape; shops aren't tied to a single
 *  region either (a shop has its own region in its front-matter,
 *  but the listing endpoint doesn't surface it). */
export interface SavedShopSummary {
  slug:        string;
  name:        string;
  filename:    string;
  modified_at: string;
  has_image:   boolean;
  thumb_url:   string;
}

export interface SavedShopListResponse {
  saved: SavedShopSummary[];
}

/** Item shape from `/object-generate/saved` (#504). Identical wire
 *  shape to shop/location summaries — slug + name + thumb is all the
 *  picker needs; the object body comes from `/foundry/object/{slug}`. */
export interface SavedObjectSummary {
  slug:        string;
  name:        string;
  filename:    string;
  modified_at: string;
  has_image:   boolean;
  thumb_url:   string;
}

export interface SavedObjectListResponse {
  saved: SavedObjectSummary[];
}

/** Item shape from `/location-generate/saved`. */
export interface SavedLocationSummary {
  slug:        string;
  name:        string;
  filename:    string;
  modified_at: string;
  has_image:   boolean;
  thumb_url:   string;
}

export interface SavedLocationListResponse {
  saved: SavedLocationSummary[];
}

/** Item shape from `/faction-generate/saved` (#506). Same wire shape
 *  as the other saved-* summaries — slug + name + thumb is all the
 *  picker needs; the faction body comes from `/foundry/faction/{slug}`. */
export interface SavedFactionSummary {
  slug:        string;
  name:        string;
  filename:    string;
  modified_at: string;
  has_image:   boolean;
  thumb_url:   string;
}

export interface SavedFactionListResponse {
  saved: SavedFactionSummary[];
}

/** `GET /foundry/shop/{slug}` response. Mirrors `FoundryActorResponse`
 *  with shop-specific bits:
 *   - `kind` is always `"shop"`
 *   - `proprietor_slug`: server-derived NPC slug from the
 *     `## Proprietor: Name & Identity` section, or null
 *   - Image fields renamed `establishment_*_url` (semantically
 *     a storefront, not a face) */
export interface FoundryShopResponse {
  slug:                    string;
  kind:                    "shop";
  name:                    string;
  display_name:            string;
  proprietor_slug:         string | null;
  establishment_image_url: string | null;
  establishment_thumb_url: string | null;
  front_matter:            Record<string, unknown>;
  sections:                FoundrySection[];
  dm_sections:             FoundrySection[];
  audit: {
    source_path: string;
    modified_at: string;
  };
}

/** `GET /foundry/location/{slug}` response. Mirrors the shop shape
 *  with location-specific renames:
 *   - `kind` is always `"location"`
 *   - No `proprietor_slug` (locations don't have a single owner;
 *     related entity slugs live in `front_matter.related_*`)
 *   - Image fields are `map_*_url` (top-down map, not a storefront) */
export interface FoundryLocationResponse {
  slug:           string;
  kind:           "location";
  name:           string;
  display_name:   string;
  map_image_url:  string | null;
  map_thumb_url:  string | null;
  front_matter:   Record<string, unknown>;
  sections:       FoundrySection[];
  dm_sections:    FoundrySection[];
  audit: {
    source_path: string;
    modified_at: string;
  };
}

/** `GET /foundry/faction/{slug}` response (API contract 0.6.0+,
 *  #506 / S10b). Journal-flavoured like shop/location; faction's
 *  headline image is a sigil/banner so it uses the **neutral**
 *  `image_url`/`thumb_url` (not `map_*` nor `establishment_*`). The
 *  bridge turns it into a JournalEntry / Campaign Codex `group`. */
export interface FoundryFactionResponse {
  slug:           string;
  kind:           "faction";
  name:           string;
  display_name:   string;
  image_url:      string | null;
  thumb_url:      string | null;
  front_matter:   Record<string, unknown>;
  sections:       FoundrySection[];
  dm_sections:    FoundrySection[];
  audit: {
    source_path: string;
    modified_at: string;
  };
}

/** Union for code that handles all journal kinds via a single
 *  import flow. */
export type FoundryJournalResponse =
  | FoundryShopResponse
  | FoundryLocationResponse
  | FoundryFactionResponse;

/** `GET /foundry/object/{slug}` response (API contract 0.5.0+,
 *  dm-assistant#502 v2a). The DM-authored Objects-Library object —
 *  the deterministic homebrew half of item resolution. dm-a owns
 *  this data so the `object_slug` link is reliable, unlike Foundry
 *  `compendium_source` UUIDs (which dm-a structurally cannot emit).
 *
 *  **v2a is narrative-only**: `description_md` is prose, there are NO
 *  structured dnd5e mechanics. `item_type` is a best-effort dnd5e
 *  Item type (explicit front-matter wins; else keyword sniff; else
 *  `loot`). v2b (mechanics sidecar) is spec'd in #502, not built. */
export interface FoundryObjectResponse {
  slug:           string;
  kind:           "object";
  name:           string;
  display_name:   string;
  item_type:      string;   // weapon|equipment|consumable|tool|loot
  description_md: string;
  image_url:      string | null;
  thumb_url:      string | null;
  front_matter:   Record<string, unknown>;
  audit: {
    source_path: string;
    modified_at: string;
  };
}
