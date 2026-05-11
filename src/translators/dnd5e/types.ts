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
