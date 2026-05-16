/**
 * D&D 5e (`dnd5e` v5.x) embedded-Items translator (bridge#20 ←
 * dm-assistant#485 / API contract 0.4.0).
 *
 * Consumes the structured `actions:` payload field
 * (`payload.front_matter.actions.items[]`) and produces an array of
 * Foundry `Item` document-data objects ready for
 * `actor.createEmbeddedDocuments("Item", items)`.
 *
 * Pure data — no Foundry runtime. The orchestrator threads the
 * actor's name through to the translator so weapon / feat items can
 * be decorated with `"${item.name} (${actor.name})"` per the
 * naming convention.
 *
 * v1 covers:
 *   - All seven item types (weapon / feat / spell / equipment /
 *     consumable / tool / loot)
 *   - Damage + attack fields for weapons (with minimal `activities`
 *     synthesis so attack rolls work)
 *   - Activation + uses + recharge
 *   - Drift-tracking flag stamped on every item so re-import's
 *     drop-and-replace logic can find them
 *
 * Out of scope (forward-compat):
 *   - `object_slug` Objects Library cross-reference (dm-assistant
 *     #481 v2)
 *   - `compendium_source` resolution (phase 2)
 *   - Full dnd5e v5.x `activities` keyed-dict (only minimal weapon
 *     activity is synthesised)
 */

import { renderMarkdown } from "../../lib/markdown.js";
import { MODULE_ID }      from "../common/buildActorData.js";
import type {
  ActionItemFromPayload,
  ActionItemType,
  ActionsFromPayload,
} from "./types.js";


/** Source marker stamped on every translator-produced Item. The
 *  drop-and-replace re-import filter uses this exact value; do not
 *  rename without updating `dropAndReplaceImportedItems` in
 *  `foundry/documents.ts`. */
export const ITEM_SOURCE_MARKER = "dm-assistant";


/** Foundry `Item` document data shape produced by this translator.
 *  Typed as `unknown` extras so dnd5e's polyglot `system` slot
 *  doesn't require a per-system rewrite when fields evolve. */
export interface DnD5eItemData {
  name:  string;
  type:  ActionItemType;
  img?:  string;
  system: Record<string, unknown>;
  flags: {
    [MODULE_ID]: {
      slug:   string;             // stable across re-imports (item name slugified)
      source: typeof ITEM_SOURCE_MARKER;
      /** Original item name as written by the LLM (pre-decoration).
       *  The compendium resolver (#32) name-searches on this, not
       *  the `(actor)`-suffixed display name. */
      origin_name?: string;
      /** dm-assistant#485 `items[].compendium_source` passthrough
       *  (e.g. `"dnd5e.items.Longsword"`). Null today — populated by
       *  #481 v2. When set, the compendium resolver (#32) prefers it
       *  over a name search. */
      compendium_source?: string | null;
      /** dm-assistant#502 v2a `items[].object_slug` passthrough — the
       *  slug of a registered Objects-Library object whose name
       *  matched this item (dm-a-internal deterministic match). When
       *  set, the resolver fetches `GET /foundry/object/{slug}` and
       *  builds the Item from the DM-authored object, taking
       *  precedence over compendium name-search. Null/absent for SRD
       *  gear (resolved by name-search) and invented items (stub). */
      object_slug?: string | null;
      /** Set by the resolver when this item's data was sourced from
       *  a compendium document (#32 — carries the resolved compendium
       *  UUID) OR from a dm-a Objects-Library object (#502 v2a —
       *  carries `dm-assistant:object/<slug>`, a namespaced provenance
       *  string, NOT a Foundry UUID; never fed to `fromUuid`). Doubles
       *  as the world-Items-folder copy's idempotency key (compendium
       *  path only). Absent on unresolved stubs. */
      resolved_from?: string;
      /** #504 — set ONLY when this is a standalone **world** Object
       *  Item (the `import/importObject.ts` path), so `matchesSlug`
       *  in `foundry/documents.ts` can find-or-update it like an
       *  Actor/Journal. Embedded actor-items don't set these (they're
       *  identified for drop-and-replace by `source` instead). */
      campaign_id?: string;
      kind?:        string;       // FlagKind, e.g. "object-item"
    };
  };
}


// ─── Build entry point ─────────────────────────────────────────────────────


export interface BuildItemsOptions {
  /** Actor's display name. Used to decorate weapon + feat item names
   *  with the suffix `${actor.name}` — matches Foundry's compendium-
   *  import convention for natural attacks. */
  actorName: string;
}


/**
 * Translate a validated `ActionsFromPayload` into an array of
 * dnd5e v5.x embedded `Item` document-data objects.
 *
 * Returns an empty array when:
 *   - `actions.ruleset` isn't `"dnd5e"` (a future PF2e ruleset will
 *     ship its own translator; for now the bridge skips translation
 *     so the import still succeeds biography-only)
 *   - `actions.items` is empty
 */
export function buildDnD5eItems(
  actions: ActionsFromPayload,
  opts:    BuildItemsOptions,
): DnD5eItemData[] {
  if (actions.ruleset !== "dnd5e") return [];
  return actions.items.map((item) => translateItem(item, opts));
}


// ─── Per-item translation ──────────────────────────────────────────────────


function translateItem(
  item: ActionItemFromPayload,
  opts: BuildItemsOptions,
): DnD5eItemData {
  const decoratedName = decorateName(item, opts.actorName);
  const system        = buildSystem(item);

  return {
    name: decoratedName,
    type: item.type,
    system,
    flags: {
      [MODULE_ID]: {
        slug:        slugifyItemName(item.name),
        source:      ITEM_SOURCE_MARKER,
        origin_name: item.name,
        compendium_source: item.compendium_source ?? null,
        object_slug: item.object_slug ?? null,
      },
    },
  };
}


/** Apply the naming convention. Weapons + feats get
 *  `"${item.name} (${actor.name})"`; other types stay bare. Matches
 *  Foundry's compendium-import convention for natural attacks. */
function decorateName(item: ActionItemFromPayload, actorName: string): string {
  const trimmedActor = actorName.trim();
  if (!trimmedActor) return item.name;
  if (item.type === "weapon" || item.type === "feat") {
    return `${item.name} (${trimmedActor})`;
  }
  return item.name;
}


/** Build the dnd5e `Item.system` block for a translated item. Common
 *  fields (description, activation, uses) apply to every type; the
 *  per-type extensions (damage + attack for weapons, etc.) layer on. */
function buildSystem(item: ActionItemFromPayload): Record<string, unknown> {
  const description = item.description ?? "";
  const system: Record<string, unknown> = {
    description: {
      value:    renderMarkdown(description),
      chat:     "",
      unidentified: "",
    },
  };

  // Activation — empty type means passive trait (no activation slot).
  const activationType = item.activation?.type ?? "";
  if (activationType) {
    system.activation = {
      type:      activationType,
      cost:      item.activation?.cost ?? 1,
      condition: "",
    };
  }

  // Uses — `max=""` + `per=""` means unlimited; emit only when set.
  const usesMax = item.uses?.max ?? "";
  const usesPer = item.uses?.per ?? "";
  if (usesMax || usesPer) {
    system.uses = {
      value:    intFromMax(usesMax),
      max:      usesMax,
      per:      usesPer || null,
      recovery: "",
    };
  }

  // Recharge — dnd5e expects an object with `value` (range start) and
  // `charged` (boolean — true means currently usable). We don't know
  // current charge state on first import, so default to charged.
  if (item.recharge) {
    system.recharge = parseRecharge(item.recharge);
  }

  // Per-type extensions. Every dnd5e v5.x item type needs a few
  // type-specific `system` slots or the sheet renders it as a blank
  // / broken row. v0.5.0 only filled weapon; v0.5.1 fills the rest
  // so spell / equipment / consumable / tool / loot items created
  // from the actions sidecar render as proper items (#20 follow-up
  // surfaced in the bridge v0.5.0 smoke).
  switch (item.type) {
    case "weapon":
      Object.assign(system, buildWeaponFields(item));
      break;
    case "spell":
      Object.assign(system, buildSpellFields());
      break;
    case "feat":
      Object.assign(system, buildFeatFields());
      break;
    case "equipment":
      Object.assign(system, buildEquipmentFields());
      break;
    case "consumable":
      Object.assign(system, buildConsumableFields());
      break;
    case "tool":
      Object.assign(system, buildToolFields());
      break;
    case "loot":
      Object.assign(system, buildLootFields());
      break;
  }

  return system;
}


// ─── Per-type system blocks (dnd5e v5.x minimal valid shapes) ─────────────


/** Physical-item common slots shared by equipment / consumable /
 *  tool / loot. Quantities + weight + price default to a single
 *  weightless free item; the GM refines (or #32's compendium-source
 *  resolution replaces the stub with a fully-statted entry). */
function _physicalItemFields(): Record<string, unknown> {
  return {
    quantity:   1,
    weight:     { value: 0, units: "lb" },
    price:      { value: 0, denomination: "gp" },
    rarity:     "",
    identified: true,
  };
}


/** Spell stub. dnd5e v5.x groups the Spells tab by `level`, so a
 *  spell item MUST carry one — we default to 0 (cantrip) because the
 *  actions schema (dm-assistant#485) doesn't yet emit spell level.
 *  The GM corrects level/school, or #32 resolves the spell against
 *  an installed SRD compendium and replaces the stub entirely. */
function buildSpellFields(): Record<string, unknown> {
  return {
    level:  0,
    school: "",
    properties: [],
    materials:  { value: "", consumed: false, cost: 0, supply: 0 },
    preparation: { mode: "prepared", prepared: true },
    target: {
      affects:  { count: "", type: "", choice: false, special: "" },
      template: {
        count: "", contiguous: false, type: "", size: "",
        width: "", height: "", units: "ft", stationary: false,
      },
    },
    range:  { value: "", units: "self" },
  };
}


/** Feat stub. dnd5e v5.x feats need a `type.value` — "monster"
 *  matches what the system migration assigns to NPC-attached feats
 *  (confirmed via the Solyrian/Elowen reference exports). */
function buildFeatFields(): Record<string, unknown> {
  return {
    type:          { value: "monster", subtype: "" },
    properties:    [],
    requirements:  "",
    prerequisites: { items: [], repeatable: false },
  };
}


function buildEquipmentFields(): Record<string, unknown> {
  return {
    ..._physicalItemFields(),
    type:     { value: "", baseItem: "" },
    armor:    { value: null },
    equipped: false,
  };
}


function buildConsumableFields(): Record<string, unknown> {
  return {
    ..._physicalItemFields(),
    type: { value: "", subtype: "" },
  };
}


function buildToolFields(): Record<string, unknown> {
  return {
    ..._physicalItemFields(),
    type:       { value: "", baseItem: "" },
    ability:    "",
    proficient: null,
  };
}


function buildLootFields(): Record<string, unknown> {
  return {
    ..._physicalItemFields(),
    type: { value: "" },
  };
}


/** Synthesise the dnd5e `Item.system` slots for weapon-type entries:
 *  damage parts, attack-roll bonus, range, properties, plus a minimal
 *  `activities` entry so Foundry actually rolls the attack + damage
 *  when the player clicks the item.
 *
 *  Phase-2 will need the full `activities` keyed-dict per dnd5e v5.x
 *  (separate activities for attack / damage / save / etc.). v1 ships
 *  a single attack-shaped activity; that covers natural attacks and
 *  simple weapons. Spells / save-based items get the description
 *  pane only at v1 — the GM can flesh them out post-import. */
function buildWeaponFields(item: ActionItemFromPayload): Record<string, unknown> {
  const damageParts: Array<[string, string]> = [];
  const primaryDamageType = item.damage?.types?.[0] ?? "";
  if (item.damage?.formula) {
    damageParts.push([item.damage.formula, primaryDamageType]);
  }

  const range = item.attack?.range ?? { value: 5, units: "ft" };

  // dnd5e distinguishes melee-with-reach (mwak, e.g. a giant's 10ft
  // slam) from true ranged (rwak, e.g. longbows). Range alone can't
  // separate them — a 10ft Slam isn't a thrown weapon. Heuristic:
  //   1. Explicit "thr" (thrown) or "amm" (ammunition) property → ranged
  //   2. Range >= 30ft (clearly out of reach distance) → ranged
  //   3. Otherwise → melee (covers natural attacks + reach weapons)
  // GM can flip via the item sheet for the few edge cases this misses.
  const rangeValue        = range.value ?? 5;
  const props             = item.attack?.properties ?? [];
  const hasRangedProperty = props.some((p) => /^(thr|amm)/i.test(p));
  const isRanged          = hasRangedProperty || rangeValue >= 30;

  const fields: Record<string, unknown> = {
    damage: {
      parts:    damageParts,
      versatile: "",
    },
    attack: {
      bonus:   item.attack?.to_hit ?? 0,
      flat:    item.attack?.to_hit !== undefined,
    },
    range: {
      value: range.value ?? 5,
      long:  range.long  ?? 0,
      units: range.units ?? "ft",
    },
    properties: arrayFromProps(item.attack?.properties),
    actionType: isRanged ? "rwak" : "mwak",
  };

  // Minimal `activities` synthesis — keyed-dict per dnd5e v5.x. Foundry
  // looks at activities[*].type === "attack" to wire up the attack
  // roll. A single attack activity covers the natural-attack baseline.
  // The activity `_id` must match Foundry's 16-char alphanumeric ID
  // contract (validated by `AttackActivity` in dnd5e v5.x). The whole
  // item is dropped + recreated on re-import via the source flag, so
  // this ID doesn't need to be stable across imports.
  const activityKey  = randomFoundryId();
  fields.activities  = {
    [activityKey]: {
      _id:      activityKey,
      type:     "attack",
      name:     item.name,
      attack: {
        ability: "",                       // GM picks; defaults to Strength for melee
        bonus:   String(item.attack?.to_hit ?? ""),
        type: {
          value:        isRanged ? "ranged" : "melee",
          classification: "weapon",
        },
      },
      damage: {
        parts: damageParts.map(([formula, dtype]) => ({
          number: undefined,
          denomination: undefined,
          types: dtype ? [dtype] : [],
          custom: { enabled: !!formula, formula },
        })),
      },
    },
  };

  return fields;
}


// ─── Helpers ───────────────────────────────────────────────────────────────


/** Slugify the item name for the bridge-flag `slug` field. Used by
 *  diagnostic tooling to identify a specific translated item across
 *  imports; the drop-and-replace flow keys on the `source` flag, not
 *  this slug. */
function slugifyItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}


/** Parse dnd5e recharge dice notation (`"5-6"`, `"6"`) into the
 *  Foundry recharge shape. Unknown formats pass through as the raw
 *  string so a GM can hand-fix in the sheet. */
function parseRecharge(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  // Range form: "5-6" → value 5
  const range = /^(\d+)\s*-\s*\d+$/.exec(trimmed);
  if (range) {
    return { value: Number.parseInt(range[1]!, 10), charged: true };
  }
  // Single-die form: "6"
  const single = /^(\d+)$/.exec(trimmed);
  if (single) {
    return { value: Number.parseInt(single[1]!, 10), charged: true };
  }
  // Unknown — pass through; dnd5e is tolerant.
  return { value: trimmed, charged: true };
}


/** Convert a "max" string to an integer for the `uses.value` slot.
 *  Foundry tracks the current uses as a number; the operator's
 *  prose `max` may be a dnd5e formula (`@prof+1`) which we leave to
 *  the system to resolve. Empty / non-numeric → 0. */
function intFromMax(max: string): number {
  if (!max) return 0;
  const parsed = Number.parseInt(max, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}


/** Convert the schema's `properties: string[]` to the dnd5e v5.x
 *  shape, which uses the same array on `Item.system.properties`.
 *  Empty/undefined → empty array. */
function arrayFromProps(props: string[] | undefined): string[] {
  if (!props) return [];
  return [...props];
}


/** Generate a 16-character alphanumeric ID matching Foundry's
 *  `Document._id` contract (`/^[a-zA-Z0-9]{16}$/`). Used for
 *  synthesised activity keys, which dnd5e v5.x validates against the
 *  same regex via `AttackActivity`. Pure-JS so the translator stays
 *  runtime-free. */
function randomFoundryId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return id;
}
