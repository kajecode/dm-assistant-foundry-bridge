/**
 * D&D 5e (`dnd5e` v5.x) stat-block translator (S9 — issue #10).
 *
 * Consumes the structured `stats:` front-matter block emitted by
 * dm-assistant (`kajecode/dm-assistant#466`) and produces the
 * corresponding dnd5e actor `system` fields. The dotted-path map
 * is documented in
 * [`docs/foundry-templates/actor.md`](https://github.com/kajecode/dm-assistant/blob/develop/docs/foundry-templates/actor.md).
 *
 * Pure data — no Foundry runtime. The orchestrator merges the
 * result into `ActorImportData.system` alongside the biography
 * fields that the v1 builder already produces.
 *
 * v1 is dnd5e-only. Unknown rulesets are caught by the caller and
 * logged; this module accepts only `ruleset: "dnd5e"`.
 */

import type { StatsFromPayload, StatsAbilities, StatsSpeed, StatsSenses } from "./types.js";

// ─── Output shape (subset of dnd5e 5.x actor `system`) ──────────────────────

export interface DnD5eSystemFields {
  attributes: {
    ac:       { flat: number; calc: string };
    hp:       { value: number; max: number; formula: string };
    movement: { walk: number; fly: number; swim: number; climb: number; burrow: number; units: string };
    senses:   { ranges: { darkvision: number; blindsight: number; tremorsense: number; truesight: number }; units: string };
  };
  abilities: {
    str: { value: number };
    dex: { value: number };
    con: { value: number };
    int: { value: number };
    wis: { value: number };
    cha: { value: number };
  };
  details: {
    cr:        number | string;
    alignment: string;
    type:      { value: string; subtype: string; swarm: string; custom: string };
  };
  traits: {
    size:      string;
    languages: { value: string[]; custom: string };
    di:        { value: string[]; custom: string };
    dr:        { value: string[]; custom: string };
    dv:        { value: string[]; custom: string };
    ci:        { value: string[]; custom: string };
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Convert the textual CR from dm-assistant's schema to dnd5e's
 * numeric form. The real-world Solyrian Keeper export has
 * `"cr": 5` (number), so we prefer numeric output. Fractional CRs
 * (`"1/4"`, `"1/2"`, `"1/8"`) round-trip cleanly because dnd5e
 * also accepts the fractional decimal.
 *
 * Unknown formats pass through verbatim — better to emit something
 * the GM can hand-fix than to default-to-zero silently.
 */
export function normaliseCr(raw: string | number): number | string {
  if (typeof raw === "number") return raw;
  const trimmed = raw.trim();
  if (trimmed === "1/8") return 0.125;
  if (trimmed === "1/4") return 0.25;
  if (trimmed === "1/2") return 0.5;
  const parsed = Number.parseFloat(trimmed);
  if (Number.isFinite(parsed) && /^[\d.]+$/.test(trimmed)) return parsed;
  return trimmed;
}

const _SPEED_DEFAULTS: Required<StatsSpeed> = {
  walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0, units: "ft",
};

const _ABILITY_DEFAULTS: Required<StatsAbilities> = {
  str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
};

const _SENSES_DEFAULTS: Required<StatsSenses> = {
  darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0, units: "ft",
};

function _fillSpeed(s: StatsSpeed | undefined): Required<StatsSpeed> {
  return { ..._SPEED_DEFAULTS, ...(s ?? {}) };
}

function _fillAbilities(a: StatsAbilities): Required<StatsAbilities> {
  return { ..._ABILITY_DEFAULTS, ...a };
}

function _fillSenses(s: StatsSenses | undefined): Required<StatsSenses> {
  return { ..._SENSES_DEFAULTS, ...(s ?? {}) };
}

/**
 * dnd5e's standard-language vocabulary. Lower-cased; the dnd5e
 * config accepts this set directly in `system.traits.languages.value`.
 * Anything outside this list goes to `.custom` so we don't silently
 * drop "Solyrian" / "Thieves' Cant" / etc.
 *
 * Source: dnd5e v5.x CONFIG.DND5E.languages. Pinned here so the
 * bridge doesn't need to introspect Foundry at runtime.
 */
const _DND5E_STANDARD_LANGUAGES: ReadonlySet<string> = new Set([
  // Common races
  "common", "dwarvish", "elvish", "giant", "gnomish", "goblin",
  "halfling", "orc",
  // Exotic
  "abyssal", "celestial", "deep speech", "draconic", "infernal",
  "primordial", "sylvan", "undercommon",
  // Speech-only
  "druidic", "thieves cant", "thieves' cant",
]);

/**
 * Split a free-form language array into the standard / custom buckets
 * dnd5e expects. Standard names are lowercased to match the vocab.
 * Original casing is preserved in `.custom` for invented languages.
 */
export function splitLanguages(
  raw: readonly string[],
  customAppend: string,
): { value: string[]; custom: string } {
  const standard: string[] = [];
  const invented: string[] = [];
  for (const lang of raw) {
    const lower = lang.trim().toLowerCase();
    if (_DND5E_STANDARD_LANGUAGES.has(lower)) {
      standard.push(lower);
    } else if (lang.trim()) {
      invented.push(lang.trim());
    }
  }
  const customParts = [...invented];
  if (customAppend.trim()) customParts.push(customAppend.trim());
  return {
    value:  standard,
    custom: customParts.join(", "),
  };
}

// ─── Main builder ──────────────────────────────────────────────────────────

/**
 * Build the dnd5e-specific `system` fields from a validated stats
 * block. Caller is responsible for confirming `stats.ruleset ===
 * "dnd5e"` first — this function asserts but doesn't recover.
 */
export function buildDnD5eSystemFields(stats: StatsFromPayload): DnD5eSystemFields {
  if (stats.ruleset !== "dnd5e") {
    throw new Error(`buildDnD5eSystemFields called with ruleset="${stats.ruleset}"`);
  }

  const abilities = _fillAbilities(stats.abilities);
  const speed     = _fillSpeed(stats.speed);
  const senses    = _fillSenses(stats.senses);
  const languages = splitLanguages(
    stats.languages ?? [],
    stats.languages_custom ?? "",
  );

  return {
    attributes: {
      ac:       { flat: stats.ac, calc: stats.ac_source ?? "flat" },
      hp:       { value: stats.hp, max: stats.hp, formula: stats.hp_formula ?? "" },
      movement: {
        walk:   speed.walk,
        fly:    speed.fly,
        swim:   speed.swim,
        climb:  speed.climb,
        burrow: speed.burrow,
        units:  speed.units,
      },
      senses:   {
        ranges: {
          darkvision:  senses.darkvision,
          blindsight:  senses.blindsight,
          tremorsense: senses.tremorsense,
          truesight:   senses.truesight,
        },
        units:  senses.units,
      },
    },
    abilities: {
      str: { value: abilities.str },
      dex: { value: abilities.dex },
      con: { value: abilities.con },
      int: { value: abilities.int },
      wis: { value: abilities.wis },
      cha: { value: abilities.cha },
    },
    details: {
      cr:        normaliseCr(stats.cr),
      alignment: stats.alignment ?? "unaligned",
      type: {
        value:   stats.type.value,
        subtype: stats.type.subtype ?? "",
        swarm:   "",
        custom:  "",
      },
    },
    traits: {
      size:      stats.size,
      languages,
      di:        { value: stats.damage_immunities       ?? [], custom: "" },
      dr:        { value: stats.damage_resistances      ?? [], custom: "" },
      dv:        { value: stats.damage_vulnerabilities  ?? [], custom: "" },
      ci:        { value: stats.condition_immunities    ?? [], custom: "" },
    },
  };
}
