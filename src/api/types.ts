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

export interface FoundryNpcResponse {
  slug:           string;
  kind:           "npc";
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
