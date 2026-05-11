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
 * Subset of Foundry's ActorData we populate in v1. Stat-block fields
 * are conspicuously absent — `system: {}` for now. Tests assert this
 * boundary so S9 has a clear delta.
 */
export interface ActorImportData {
  name:         string;
  type:         "npc";
  img:          string | null;          // resolved post-upload by the orchestrator
  system: {
    details: {
      biography: {
        value:  string;
        public: string;
      };
    };
  };
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
    system: {
      details: {
        biography: {
          value:  biography,
          public: biography,
        },
      },
    },
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
