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
