/**
 * Translates a `/foundry/npc/{slug}` payload into the Foundry
 * document-data objects needed to create or overwrite an NPC actor
 * + its companion GM-only journal.
 *
 * Pure data — no Foundry runtime calls. Tests cover the full output
 * for representative payloads (with image / without / no front-matter).
 *
 * Field map is the common-fields section of dm-assistant's
 * `docs/foundry-templates/actor.md` (filled in by S5). Stat-block
 * fields (system.attributes.hp etc.) are NOT populated here — they
 * land in S9 when the structured-stat-block translator ships.
 */

import type { FoundryNpcResponse } from "../../api/types.js";
import { buildBiographyHtml }      from "./buildBiography.js";
import { buildDmJournalPages,
         type JournalPageData }    from "./buildJournalPages.js";
import { buildDnD5eSystemFields,
         type DnD5eSystemFields }  from "../dnd5e/statsBlock.js";
import type { StatsFromPayload }   from "../dnd5e/types.js";
import { log }                     from "../../lib/log.js";

export const MODULE_ID = "dm-assistant-bridge";

/**
 * The drift-tracking flag set stamped on every imported document.
 * Identical shape on actors AND companion journals so a future
 * cleanup pass can find both via the same key.
 */
export interface BridgeFlags {
  slug:                  string;
  campaign_id:           string;
  source_path:           string;       // mirrors response.audit.source_path
  modified_at:           string;       // mirrors response.audit.modified_at
  api_contract_version?: string;       // pinned at import time
  kind:                  "npc-actor" | "npc-dm-notes";
}

/**
 * Subset of Foundry's ActorData we populate. Biography is always
 * present. dnd5e structured fields (`attributes`, `abilities`,
 * `details.{cr,alignment,type}`, `traits`, `details.languages`) are
 * present when the payload includes a validated `stats:` front-matter
 * block (#10 / S9). Untyped extras carry through verbatim so future
 * fields don't require a contract bump.
 */
export interface ActorImportData {
  name:         string;
  type:         "npc";
  img:          string | null;          // resolved post-upload by the orchestrator
  system: SystemFields;
  prototypeToken: {
    name:        string;
    texture: {
      src:       string | null;          // resolved post-upload by the orchestrator
    };
    disposition: number;                 // 0 = neutral (sensible NPC default)
    actorLink:   false;
    displayName: 0;
    displayBars: 0;
    bar1:        { attribute: "attributes.hp" };
  };
  ownership:    { default: 0 };           // GM-default; no player visibility
  flags: {
    [MODULE_ID]: BridgeFlags;
  };
}

/**
 * Foundry's `actor.system` is a polyglot shape per game system —
 * dnd5e in v1, pf2e later (S12). The biography fields are universal
 * (every system surfaces them under `details.biography`); everything
 * else is per-ruleset and added by the appropriate translator.
 *
 * Modelled as `details.biography` always-present plus an extensible
 * structure so dnd5e's `attributes` / `abilities` / `traits` / extra
 * `details.*` slots can land alongside without a wider type rewrite.
 */
export type SystemFields = {
  details: {
    biography: { value: string; public: string };
  } & Record<string, unknown>;
} & Record<string, unknown>;

export interface JournalImportData {
  name:       string;
  pages:      JournalPageData[];
  ownership:  { default: 0 };
  flags: {
    [MODULE_ID]: BridgeFlags;
  };
}

export interface ImportBundle {
  actor:        ActorImportData;
  journal:      JournalImportData | null;     // null when there are no dm_sections
  campaignId:   string;
  slug:         string;
  contractVersion?: string;
}

export interface BuildOptions {
  campaignId:        string;
  contractVersion?:  string;            // typically threaded from /foundry/health
}

/**
 * Merge per-ruleset structured fields into the actor's system block.
 * Returns the merged SystemFields. v1 only handles `ruleset: "dnd5e"`;
 * unknown rulesets log a warning + return the biography-only block.
 */
function buildSystemFields(
  payload:    FoundryNpcResponse,
  biography:  string,
): SystemFields {
  const baseSystem: SystemFields = {
    details: { biography: { value: biography, public: biography } },
  };

  const rawStats = payload.front_matter.stats as StatsFromPayload | undefined;
  if (!rawStats || typeof rawStats !== "object") {
    return baseSystem;
  }
  if (rawStats.ruleset !== "dnd5e") {
    log.warn(
      `stats.ruleset="${rawStats.ruleset}" unsupported in v1 — skipping structured fields. ` +
      `Biography still populates.`,
    );
    return baseSystem;
  }

  let dnd5e: DnD5eSystemFields;
  try {
    dnd5e = buildDnD5eSystemFields(rawStats);
  } catch (e) {
    log.warn("dnd5e stat-block translation failed; biography-only import", e);
    return baseSystem;
  }

  // Merge: dnd5e structured fields plus the biography under details.
  // details.* is the only sub-object we shallow-merge — every other
  // top-level key from dnd5e (attributes / abilities / traits) lands
  // directly on the system root.
  return {
    ...dnd5e,
    details: {
      ...dnd5e.details,
      biography: baseSystem.details.biography,
    },
  } as SystemFields;
}


export function buildImportBundle(
  payload: FoundryNpcResponse,
  opts:    BuildOptions,
): ImportBundle {
  const biography = buildBiographyHtml(payload);

  const actorFlags: BridgeFlags = {
    slug:                  payload.slug,
    campaign_id:           opts.campaignId,
    source_path:           payload.audit.source_path,
    modified_at:           payload.audit.modified_at,
    api_contract_version:  opts.contractVersion,
    kind:                  "npc-actor",
  };

  const actor: ActorImportData = {
    name: payload.display_name || payload.name || payload.slug,
    type: "npc",
    img:  null,    // orchestrator overwrites after FilePicker upload
    system: buildSystemFields(payload, biography),
    prototypeToken: {
      name:        payload.display_name || payload.name || payload.slug,
      texture:     { src: null },
      disposition: 0,
      actorLink:   false,
      displayName: 0,
      displayBars: 0,
      bar1:        { attribute: "attributes.hp" },
    },
    ownership: { default: 0 },
    flags: {
      [MODULE_ID]: actorFlags,
    },
  };

  let journal: JournalImportData | null = null;
  if (payload.dm_sections.length > 0) {
    const journalFlags: BridgeFlags = { ...actorFlags, kind: "npc-dm-notes" };
    journal = {
      name:      `${actor.name} — DM Notes`,
      pages:     buildDmJournalPages(payload),
      ownership: { default: 0 },
      flags: {
        [MODULE_ID]: journalFlags,
      },
    };
  }

  return {
    actor,
    journal,
    campaignId:      opts.campaignId,
    slug:            payload.slug,
    contractVersion: opts.contractVersion,
  };
}
