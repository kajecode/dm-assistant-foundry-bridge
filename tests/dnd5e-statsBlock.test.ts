/**
 * Pure-data tests for the dnd5e stat-block translator (#10).
 *
 * Mirrors the upstream Python schema tests in
 * `dm-assistant/tests/test_stats_block.py` — same Solyrian Keeper
 * fixture, same minimum-block fixture. Pins the dotted-path mapping
 * against drift so the bridge and dm-assistant don't diverge silently.
 */

import { describe, expect, it } from "vitest";
import {
  buildDnD5eSystemFields,
  normaliseCr,
  splitLanguages,
} from "../src/translators/dnd5e/statsBlock.js";
import type { StatsFromPayload } from "../src/translators/dnd5e/types.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────


function fullStats(): StatsFromPayload {
  return {
    ruleset:    "dnd5e",
    ac:         17,
    ac_source:  "natural",
    hp:         102,
    hp_formula: "12d10+48",
    cr:         "5",
    size:       "lg",
    alignment:  "unaligned",
    type:       { value: "construct", subtype: "" },
    speed:      { walk: 30, units: "ft" },
    abilities:  { str: 22, dex: 8, con: 18, int: 10, wis: 12, cha: 8 },
    senses:     { darkvision: 60, units: "ft" },
    languages:               [],
    languages_custom:        "Solyrian",
    damage_immunities:       ["poison", "psychic"],
    condition_immunities:    ["charmed", "exhaustion", "frightened", "paralyzed", "poisoned"],
  };
}

function minimumStats(): StatsFromPayload {
  return {
    ruleset:   "dnd5e",
    ac:        12,
    hp:        22,
    cr:        "1/4",
    size:      "med",
    type:      { value: "humanoid" },
    abilities: { str: 14, dex: 10, con: 13, int: 11, wis: 10, cha: 12 },
  };
}

// ─── normaliseCr — fractional + integer round-trip ─────────────────────────


describe("normaliseCr", () => {
  it("converts dnd5e fractional CRs to decimal numbers", () => {
    expect(normaliseCr("1/8")).toBe(0.125);
    expect(normaliseCr("1/4")).toBe(0.25);
    expect(normaliseCr("1/2")).toBe(0.5);
  });

  it("parses numeric strings to numbers", () => {
    expect(normaliseCr("0")).toBe(0);
    expect(normaliseCr("1")).toBe(1);
    expect(normaliseCr("5")).toBe(5);
    expect(normaliseCr("17")).toBe(17);
  });

  it("passes integer + float inputs through unchanged", () => {
    expect(normaliseCr(5)).toBe(5);
    expect(normaliseCr(0.5)).toBe(0.5);
  });

  it("falls through to the trimmed string for unrecognised formats", () => {
    // Better to emit something the GM can fix than to default to zero.
    expect(normaliseCr("UNKNOWN")).toBe("UNKNOWN");
  });
});

// ─── splitLanguages — standard / custom routing ────────────────────────────


describe("splitLanguages", () => {
  it("routes standard dnd5e languages to .value (lowercased)", () => {
    const out = splitLanguages(["Common", "Dwarvish", "Goblin"], "");
    expect(out.value).toEqual(["common", "dwarvish", "goblin"]);
    expect(out.custom).toBe("");
  });

  it("routes invented languages to .custom with original casing preserved", () => {
    const out = splitLanguages(["Solyrian", "Common"], "");
    expect(out.value).toEqual(["common"]);
    expect(out.custom).toBe("Solyrian");
  });

  it("appends languages_custom verbatim to the .custom string", () => {
    const out = splitLanguages([], "Solyrian, Old Imperial");
    expect(out.value).toEqual([]);
    expect(out.custom).toBe("Solyrian, Old Imperial");
  });

  it("combines invented array entries with the custom append", () => {
    const out = splitLanguages(["Common", "Solyrian"], "Whispertongue");
    expect(out.value).toEqual(["common"]);
    expect(out.custom).toBe("Solyrian, Whispertongue");
  });

  it("recognises 'thieves' cant' with either curly-quote or straight-apostrophe", () => {
    const out = splitLanguages(["Thieves Cant"], "");
    expect(out.value).toEqual(["thieves cant"]);
  });

  it("drops empty entries silently — generator output may have padding", () => {
    const out = splitLanguages(["Common", "  ", ""], "");
    expect(out.value).toEqual(["common"]);
    expect(out.custom).toBe("");
  });
});

// ─── buildDnD5eSystemFields — full happy path ──────────────────────────────


describe("buildDnD5eSystemFields — full payload", () => {
  const s = buildDnD5eSystemFields(fullStats());

  it("maps AC into the v5.x {flat, calc} shape (NOT .value)", () => {
    expect(s.attributes.ac.flat).toBe(17);
    expect(s.attributes.ac.calc).toBe("natural");
  });

  it("maps HP to value + max + formula in lockstep", () => {
    expect(s.attributes.hp.value)   .toBe(102);
    expect(s.attributes.hp.max)     .toBe(102);
    expect(s.attributes.hp.formula) .toBe("12d10+48");
  });

  it("normalises the textual CR to a number", () => {
    expect(s.details.cr).toBe(5);
  });

  it("copies size verbatim (already in dnd5e code form)", () => {
    expect(s.traits.size).toBe("lg");
  });

  it("populates the creature type with empty swarm / custom slots", () => {
    expect(s.details.type.value).toBe("construct");
    expect(s.details.type.subtype).toBe("");
    expect(s.details.type.swarm).toBe("");
    expect(s.details.type.custom).toBe("");
  });

  it("ability scores map to {value} sub-objects", () => {
    expect(s.abilities.str.value).toBe(22);
    expect(s.abilities.dex.value).toBe(8);
    expect(s.abilities.con.value).toBe(18);
    expect(s.abilities.int.value).toBe(10);
    expect(s.abilities.wis.value).toBe(12);
    expect(s.abilities.cha.value).toBe(8);
  });

  it("senses land under .ranges with the units alongside", () => {
    expect(s.attributes.senses.ranges.darkvision)  .toBe(60);
    expect(s.attributes.senses.ranges.blindsight)  .toBe(0);
    expect(s.attributes.senses.ranges.tremorsense) .toBe(0);
    expect(s.attributes.senses.ranges.truesight)   .toBe(0);
    expect(s.attributes.senses.units)              .toBe("ft");
  });

  it("Solyrian goes to languages.custom — it's not in dnd5e's standard vocab", () => {
    expect(s.traits.languages.value).toEqual([]);
    expect(s.traits.languages.custom).toBe("Solyrian");
  });

  it("damage routing — immunities populate, untouched lists default to empty", () => {
    expect(s.traits.di.value).toEqual(["poison", "psychic"]);
    expect(s.traits.dr.value).toEqual([]);
    expect(s.traits.dv.value).toEqual([]);
  });

  it("condition immunities array round-trips verbatim", () => {
    expect(s.traits.ci.value).toEqual([
      "charmed", "exhaustion", "frightened", "paralyzed", "poisoned",
    ]);
  });
});

// ─── buildDnD5eSystemFields — minimum payload ──────────────────────────────


describe("buildDnD5eSystemFields — minimum payload (defaults apply)", () => {
  const s = buildDnD5eSystemFields(minimumStats());

  it("AC source defaults to 'flat' when omitted", () => {
    expect(s.attributes.ac.calc).toBe("flat");
  });

  it("HP formula defaults to empty string when omitted", () => {
    expect(s.attributes.hp.formula).toBe("");
  });

  it("alignment defaults to 'unaligned' when omitted", () => {
    expect(s.details.alignment).toBe("unaligned");
  });

  it("fractional CR converts to decimal", () => {
    expect(s.details.cr).toBe(0.25);
  });

  it("speed defaults: walk 30, all others 0, units ft", () => {
    expect(s.attributes.movement.walk).toBe(30);
    expect(s.attributes.movement.fly).toBe(0);
    expect(s.attributes.movement.swim).toBe(0);
    expect(s.attributes.movement.climb).toBe(0);
    expect(s.attributes.movement.burrow).toBe(0);
    expect(s.attributes.movement.units).toBe("ft");
  });

  it("senses default to 0 + ft when omitted", () => {
    expect(s.attributes.senses.ranges.darkvision).toBe(0);
    expect(s.attributes.senses.units).toBe("ft");
  });

  it("languages default to empty when both array + custom omitted", () => {
    expect(s.traits.languages.value).toEqual([]);
    expect(s.traits.languages.custom).toBe("");
  });

  it("damage routing arrays default to empty", () => {
    expect(s.traits.di.value).toEqual([]);
    expect(s.traits.dr.value).toEqual([]);
    expect(s.traits.dv.value).toEqual([]);
    expect(s.traits.ci.value).toEqual([]);
  });
});

// ─── buildDnD5eSystemFields — ruleset guard ─────────────────────────────────


describe("buildDnD5eSystemFields — ruleset guard", () => {
  it("throws when called with a non-dnd5e ruleset", () => {
    const bad = { ...fullStats(), ruleset: "pf2e" };
    expect(() => buildDnD5eSystemFields(bad)).toThrow(/pf2e/);
  });
});
