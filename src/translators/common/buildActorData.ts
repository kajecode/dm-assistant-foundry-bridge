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

import type { ActorKind, FoundryActorResponse, FoundryNpcResponse } from "../../api/types.js";
import { buildBiographyHtml }      from "./buildBiography.js";
import { buildDmJournalPages,
         type JournalPageData }    from "./buildJournalPages.js";
import { buildDnD5eSystemFields,
         type DnD5eSystemFields }  from "../dnd5e/statsBlock.js";
import { buildDnD5eItems,
         type DnD5eItemData }      from "../dnd5e/items.js";
import type {
  ActionsFromPayload,
  StatsFromPayload,
}                                  from "../dnd5e/types.js";
import { log }                     from "../../lib/log.js";

export const MODULE_ID = "dm-assistant-bridge";

/**
 * The drift-tracking flag set stamped on every imported document.
 * Identical shape on actors AND companion journals so a future
 * cleanup pass can find both via the same key.
 */
/** Flag-kind discriminant on imported Foundry documents. Combines
 *  the dm-assistant **entity kind** (`npc` / `creature` / `shop` /
 *  `location`) with the **document role**:
 *
 *   - `actor`         — main Foundry Actor for NPC / Creature imports
 *   - `dm-notes`      — companion DM-only JournalEntry alongside an actor
 *   - `journal`       — primary JournalEntry for shop / location imports
 *
 *  Drift identity (`matchesSlug` in `foundry/documents.ts`) uses
 *  this discriminant so an NPC and a Creature with the same slug
 *  don't overwrite each other, and a shop journal doesn't collide
 *  with a location journal of the same slug. */
export type FlagKind =
  | "npc-actor"      | "npc-dm-notes"
  | "creature-actor" | "creature-dm-notes"
  | "shop-journal"
  | "location-journal"
  | "object-item";   // #504 — a registered object imported as a world Item

/** Map a `(entityKind, role)` pair to the flag-kind discriminant.
 *  Only valid pairs:
 *
 *  | entityKind | role           |
 *  |------------|----------------|
 *  | npc        | actor / dm-notes |
 *  | creature   | actor / dm-notes |
 *  | shop       | journal        |
 *  | location   | journal        |
 *
 *  Invalid combinations widen to FlagKind via the type assertion;
 *  the orchestrator never constructs the bad pairs. */
export function flagKindFor(
  entityKind: ActorKind | "shop" | "location",
  role:       "actor" | "dm-notes" | "journal",
): FlagKind {
  return `${entityKind}-${role}` as FlagKind;
}

export interface BridgeFlags {
  slug:                  string;
  campaign_id:           string;
  source_path:           string;       // mirrors response.audit.source_path
  modified_at:           string;       // mirrors response.audit.modified_at
  api_contract_version?: string;       // pinned at import time
  kind:                  FlagKind;
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
  /** Foundry folder ID for kind-aware placement (bridge#24). The
   *  orchestrator resolves this via `foundry/folders.ts` before
   *  persisting. Omitted in unit-test fixtures that don't care
   *  about folder routing; Foundry treats null/undefined as
   *  "place at root", preserving the pre-v0.3.1 behaviour for
   *  callers that haven't been updated. */
  folder?:      string | null;
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
  /** Foundry folder ID for kind-aware placement (bridge#24).
   *  DM-notes journals land in a sibling-of-actors folder (e.g.
   *  "<prefix> — NPC DM Notes") so the actor folders stay focused
   *  on draggable tokens. Same null/undefined fallback semantics
   *  as `ActorImportData.folder`. */
  folder?:    string | null;
  /** Foundry `JournalEntry.img` — hero image shown in the sidebar
   *  and (optionally) embedded into Page 1. Used by shop / location
   *  import (`establishment_image_url` / `map_image_url` →
   *  uploaded via FilePicker → this field). Omitted on NPC /
   *  Creature DM-notes journals (those carry the actor's portrait
   *  on the actor side; the companion journal stays imageless). */
  img?:       string | null;
  flags: {
    [MODULE_ID]: BridgeFlags;
  };
}

export interface ImportBundle {
  actor:        ActorImportData;
  journal:      JournalImportData | null;     // null when there are no dm_sections
  /** Embedded `Item` documents to create on the actor (bridge#20).
   *  Empty array when the payload lacks `front_matter.actions` or
   *  when the ruleset isn't dnd5e. The orchestrator persists these
   *  via `actor.createEmbeddedDocuments("Item", items)` after the
   *  drop-and-replace cleanup pass. */
  items:        DnD5eItemData[];
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
  payload: FoundryActorResponse,
  opts:    BuildOptions,
): ImportBundle {
  const biography = buildBiographyHtml(payload);

  // Entity kind is the payload's `kind` (npc or creature). The flag-
  // kind discriminant combines that with the document role so a
  // creature actor and an NPC actor with the same slug carry
  // distinct identity flags and don't collide on re-import.
  const entityKind: ActorKind = payload.kind;

  const actorFlags: BridgeFlags = {
    slug:                  payload.slug,
    campaign_id:           opts.campaignId,
    source_path:           payload.audit.source_path,
    modified_at:           payload.audit.modified_at,
    api_contract_version:  opts.contractVersion,
    kind:                  flagKindFor(entityKind, "actor"),
  };

  const actor: ActorImportData = {
    // Foundry's dnd5e schema uses Actor type "npc" for both NPCs and
    // monsters/creatures — there's no separate "creature" Actor type
    // (per dnd5e v5.x schema observations). The Foundry-side type
    // stays "npc"; the dm-assistant entity kind is captured in flags.
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
    const journalFlags: BridgeFlags = {
      ...actorFlags,
      kind: flagKindFor(entityKind, "dm-notes"),
    };
    journal = {
      name:      `${actor.name} — DM Notes`,
      pages:     buildDmJournalPages(payload),
      ownership: { default: 0 },
      flags: {
        [MODULE_ID]: journalFlags,
      },
    };
  }

  // Embedded Items — bridge#20 / dm-assistant#485 (contract 0.4.0).
  // Translates `front_matter.actions.items[]` into Foundry Item
  // documents for the actor. Skipped when:
  //   - the payload doesn't include the field (older dm-assistant)
  //   - `actions.ruleset` isn't dnd5e (PF2e ships its own
  //     translator in S12)
  //   - `actions.items` is empty
  // Failures degrade to biography-only without surfacing — same
  // policy as the stats-block translator.
  const items = buildActorItems(payload, actor.name);

  return {
    actor,
    journal,
    items,
    campaignId:      opts.campaignId,
    slug:            payload.slug,
    contractVersion: opts.contractVersion,
  };
}


/** Run the dnd5e items translator against the payload's
 *  `front_matter.actions` field. Returns an empty array on any
 *  error path so the import still proceeds biography-only. */
function buildActorItems(
  payload:   FoundryActorResponse,
  actorName: string,
): DnD5eItemData[] {
  const rawActions = payload.front_matter.actions as ActionsFromPayload | undefined;
  if (!rawActions || typeof rawActions !== "object") return [];
  if (!Array.isArray(rawActions.items) || rawActions.items.length === 0) return [];
  if (rawActions.ruleset !== "dnd5e") {
    log.warn(
      `actions.ruleset="${rawActions.ruleset}" unsupported in v1 — skipping embedded items. ` +
      `Biography + stats still populate.`,
    );
    return [];
  }
  try {
    return buildDnD5eItems(rawActions, { actorName });
  } catch (e) {
    log.warn("dnd5e items translation failed; importing without embedded items", e);
    return [];
  }
}
