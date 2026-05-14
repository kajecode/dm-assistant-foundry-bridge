/**
 * Wire types for the `stats:` front-matter block that the dnd5e
 * translator consumes (kajecode/dm-assistant#466).
 *
 * These mirror the Pydantic models in `dm-assistant/api/core/stats_block.py`
 * — change them together when the upstream contract evolves.
 */

export interface StatsAbilities {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface StatsSpeed {
  walk?:   number;
  fly?:    number;
  swim?:   number;
  climb?:  number;
  burrow?: number;
  units?:  "ft" | "m";
}

export interface StatsSenses {
  darkvision?:  number;
  blindsight?:  number;
  tremorsense?: number;
  truesight?:   number;
  units?:       "ft" | "m";
}

export interface StatsType {
  value:    string;
  subtype?: string;
  swarm?:   string;
  custom?:  string;
}

export interface StatsFromPayload {
  ruleset:                    string;
  ac:                         number;
  ac_source?:                 string;
  hp:                         number;
  hp_formula?:                string;
  cr:                         number | string;
  size:                       string;
  alignment?:                 string;
  type:                       StatsType;
  speed?:                     StatsSpeed;
  abilities:                  StatsAbilities;
  senses?:                    StatsSenses;
  languages?:                 string[];
  languages_custom?:          string;
  damage_immunities?:         string[];
  damage_resistances?:        string[];
  damage_vulnerabilities?:    string[];
  condition_immunities?:      string[];
}


// ─── Actions / Items (bridge#20 ← dm-assistant#485, contract 0.4.0) ────────

/** Item-type vocabulary per `api/core/stats_actions.py::ITEM_TYPES`. */
export type ActionItemType =
  | "weapon" | "feat" | "spell" | "equipment" | "consumable" | "tool" | "loot";

/** Activation cadence per `ACTIVATION_TYPES`. */
export type ActionActivationType =
  | "" | "action" | "bonus" | "reaction" | "minute" | "hour" | "day"
  | "special" | "legendary" | "mythic" | "lair";

/** Uses cadence per `USES_CADENCE`. */
export type ActionUsesCadence = "" | "day" | "sr" | "lr" | "charges";

export interface ActionRange {
  value?: number;
  long?:  number;
  units?: "" | "ft" | "m" | "self" | "touch";
}

export interface ActionAttack {
  to_hit?:     number;
  range?:      ActionRange;
  properties?: string[];
}

export interface ActionDamage {
  formula?: string;
  types?:   string[];
}

export interface ActionActivation {
  type?: ActionActivationType;
  cost?: number;
}

export interface ActionUses {
  max?: string;
  per?: ActionUsesCadence;
}

/** Single item / action entry — mirrors `StatsActionItem`. */
export interface ActionItemFromPayload {
  name:               string;
  type:               ActionItemType;
  description?:       string;
  damage?:            ActionDamage  | null;
  attack?:            ActionAttack  | null;
  activation?:        ActionActivation;
  uses?:              ActionUses;
  recharge?:          string;
  /** Reserved fields — bridge v1 ignores both. Carried in the type
   *  so payload validation surfaces drift; the translator never
   *  reads them. */
  object_slug?:       string | null;
  compendium_source?: string | null;
}

export interface ActionsFromPayload {
  ruleset: string;
  items:   ActionItemFromPayload[];
}
