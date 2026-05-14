/**
 * Tests for `src/translators/dnd5e/items.ts` (bridge#20).
 *
 * Pure-data translator tests. Pin per-item-type translation (weapon
 * with damage + attack, feat passive trait, recharge, uses), the
 * naming convention (suffix `(${actor.name})` for weapon + feat),
 * and the source-flag stamping that drives drop-and-replace on
 * re-import.
 */

import { describe, expect, it } from "vitest";
import {
  buildDnD5eItems,
  ITEM_SOURCE_MARKER,
}                                  from "../src/translators/dnd5e/items.js";
import { MODULE_ID }               from "../src/translators/common/buildActorData.js";
import type {
  ActionItemFromPayload,
  ActionsFromPayload,
}                                  from "../src/translators/dnd5e/types.js";


// ── Shared fixtures ─────────────────────────────────────────────────────────


const _SLAM: ActionItemFromPayload = {
  name:        "Slam",
  type:        "weapon",
  description: "Melee Weapon Attack: +9 to hit, reach 10 ft.",
  damage:      { formula: "3d6+6", types: ["bludgeoning"] },
  attack:      { to_hit: 9, range: { value: 10, units: "ft" }, properties: [] },
  activation:  { type: "action", cost: 1 },
};

const _PACK_TACTICS: ActionItemFromPayload = {
  name:        "Pack Tactics",
  type:        "feat",
  description: "Advantage on attack rolls against a creature if at least one ally is within 5 ft.",
};

const _FIRE_BREATH: ActionItemFromPayload = {
  name:        "Fire Breath",
  type:        "weapon",
  description: "30-foot cone, DC 17 Dex save.",
  damage:      { formula: "16d6", types: ["fire"] },
  activation:  { type: "action", cost: 1 },
  recharge:    "5-6",
  uses:        { max: "1", per: "day" },
};


function _payloadWith(items: ActionItemFromPayload[]): ActionsFromPayload {
  return { ruleset: "dnd5e", items };
}


// ── Happy path ─────────────────────────────────────────────────────────────


describe("buildDnD5eItems — happy path", () => {
  it("produces one Item per input action", () => {
    const out = buildDnD5eItems(
      _payloadWith([_SLAM, _PACK_TACTICS, _FIRE_BREATH]),
      { actorName: "Giant" },
    );
    expect(out).toHaveLength(3);
    expect(out.map((i) => i.name)).toEqual([
      "Slam (Giant)",            // weapon → decorated
      "Pack Tactics (Giant)",    // feat → decorated
      "Fire Breath (Giant)",     // weapon → decorated
    ]);
  });

  it("returns empty array for ruleset != dnd5e", () => {
    const out = buildDnD5eItems(
      { ruleset: "pf2e", items: [_SLAM] },
      { actorName: "Anything" },
    );
    expect(out).toEqual([]);
  });

  it("returns empty array for empty items list", () => {
    const out = buildDnD5eItems(_payloadWith([]), { actorName: "X" });
    expect(out).toEqual([]);
  });
});


// ── Naming convention ─────────────────────────────────────────────────────


describe("naming convention", () => {
  it("decorates weapon + feat names with actor name", () => {
    const out = buildDnD5eItems(
      _payloadWith([
        { name: "Bite",          type: "weapon" },
        { name: "Keen Senses",   type: "feat" },
      ]),
      { actorName: "Wolf" },
    );
    expect(out[0]!.name).toBe("Bite (Wolf)");
    expect(out[1]!.name).toBe("Keen Senses (Wolf)");
  });

  it("leaves non-weapon / non-feat names bare", () => {
    const out = buildDnD5eItems(
      _payloadWith([
        { name: "Potion of Healing", type: "consumable" },
        { name: "Thieves' Tools",     type: "tool" },
        { name: "Backpack",           type: "equipment" },
        { name: "Coin Purse",         type: "loot" },
        { name: "Magic Missile",      type: "spell" },
      ]),
      { actorName: "Aldric" },
    );
    expect(out.map((i) => i.name)).toEqual([
      "Potion of Healing",
      "Thieves' Tools",
      "Backpack",
      "Coin Purse",
      "Magic Missile",
    ]);
  });

  it("leaves names bare when actorName is empty", () => {
    const out = buildDnD5eItems(_payloadWith([_SLAM]), { actorName: "" });
    expect(out[0]!.name).toBe("Slam");
  });
});


// ── Source flag (drift identity) ───────────────────────────────────────────


describe("source flag stamping", () => {
  it("stamps the dm-assistant source marker on every item", () => {
    const out = buildDnD5eItems(
      _payloadWith([_SLAM, _PACK_TACTICS]),
      { actorName: "Test" },
    );
    for (const item of out) {
      expect(item.flags[MODULE_ID].source).toBe(ITEM_SOURCE_MARKER);
      expect(item.flags[MODULE_ID].source).toBe("dm-assistant");
    }
  });

  it("slugifies the item name into the bridge-flag slug", () => {
    const out = buildDnD5eItems(
      _payloadWith([
        { name: "Magic Missile",    type: "spell" },
        { name: "Potion of Healing", type: "consumable" },
      ]),
      { actorName: "Wizard" },
    );
    expect(out[0]!.flags[MODULE_ID].slug).toBe("magic-missile");
    expect(out[1]!.flags[MODULE_ID].slug).toBe("potion-of-healing");
  });
});


// ── Weapon translation ─────────────────────────────────────────────────────


describe("weapon translation", () => {
  it("populates damage.parts with formula + primary damage type", () => {
    const out = buildDnD5eItems(_payloadWith([_SLAM]), { actorName: "Giant" });
    const dmg = out[0]!.system.damage as { parts: Array<[string, string]> };
    expect(dmg.parts).toEqual([["3d6+6", "bludgeoning"]]);
  });

  it("populates attack.bonus from to_hit + flat=true so the bonus overrides ability mods", () => {
    const out = buildDnD5eItems(_payloadWith([_SLAM]), { actorName: "Giant" });
    const atk = out[0]!.system.attack as { bonus: number; flat: boolean };
    expect(atk.bonus).toBe(9);
    expect(atk.flat).toBe(true);
  });

  it("uses melee actionType for short-range weapons", () => {
    const out = buildDnD5eItems(_payloadWith([_SLAM]), { actorName: "Giant" });
    expect(out[0]!.system.actionType).toBe("mwak");
  });

  it("synthesises an activities entry so the attack actually rolls", () => {
    const out = buildDnD5eItems(_payloadWith([_SLAM]), { actorName: "Giant" });
    const activities = out[0]!.system.activities as Record<string, { type: string; attack: { type: { value: string } } }>;
    const keys = Object.keys(activities);
    expect(keys.length).toBe(1);
    const activity = activities[keys[0]!]!;
    expect(activity.type).toBe("attack");
    expect(activity.attack.type.value).toBe("melee");
  });

  it("uses ranged classification when range > 5ft", () => {
    const out = buildDnD5eItems(
      _payloadWith([{
        name: "Longbow", type: "weapon",
        damage: { formula: "1d8", types: ["piercing"] },
        attack: { to_hit: 5, range: { value: 150, long: 600, units: "ft" } },
      }]),
      { actorName: "Ranger" },
    );
    const activities = out[0]!.system.activities as Record<string, { attack: { type: { value: string } } }>;
    const activity   = Object.values(activities)[0]!;
    expect(activity.attack.type.value).toBe("ranged");
  });

  it("defaults range to 5ft melee when attack is absent", () => {
    const out = buildDnD5eItems(
      _payloadWith([{ name: "Unarmed", type: "weapon", damage: { formula: "1d4", types: ["bludgeoning"] } }]),
      { actorName: "Monk" },
    );
    const range = out[0]!.system.range as { value: number; units: string };
    expect(range.value).toBe(5);
    expect(range.units).toBe("ft");
  });
});


// ── Activation / uses / recharge ─────────────────────────────────────────


describe("activation + uses + recharge", () => {
  it("emits activation block when type is non-empty", () => {
    const out = buildDnD5eItems(_payloadWith([_SLAM]), { actorName: "X" });
    const act = out[0]!.system.activation as { type: string; cost: number };
    expect(act.type).toBe("action");
    expect(act.cost).toBe(1);
  });

  it("omits activation block when type is empty (passive trait)", () => {
    const out = buildDnD5eItems(_payloadWith([_PACK_TACTICS]), { actorName: "X" });
    expect(out[0]!.system.activation).toBeUndefined();
  });

  it("emits uses block when max or per is set", () => {
    const out = buildDnD5eItems(_payloadWith([_FIRE_BREATH]), { actorName: "Dragon" });
    const uses = out[0]!.system.uses as { value: number; max: string; per: string };
    expect(uses.max).toBe("1");
    expect(uses.per).toBe("day");
    expect(uses.value).toBe(1);   // parsed int from max
  });

  it("omits uses block when both max and per are empty", () => {
    const out = buildDnD5eItems(_payloadWith([_SLAM]), { actorName: "X" });
    expect(out[0]!.system.uses).toBeUndefined();
  });

  it("parses recharge range form (5-6) into { value, charged: true }", () => {
    const out = buildDnD5eItems(_payloadWith([_FIRE_BREATH]), { actorName: "Dragon" });
    expect(out[0]!.system.recharge).toEqual({ value: 5, charged: true });
  });

  it("parses recharge single-die form (6) into { value, charged: true }", () => {
    const out = buildDnD5eItems(
      _payloadWith([{ ..._FIRE_BREATH, recharge: "6" }]),
      { actorName: "Dragon" },
    );
    expect(out[0]!.system.recharge).toEqual({ value: 6, charged: true });
  });

  it("omits recharge block when recharge is empty", () => {
    const out = buildDnD5eItems(_payloadWith([_SLAM]), { actorName: "X" });
    expect(out[0]!.system.recharge).toBeUndefined();
  });
});


// ── Description rendering ──────────────────────────────────────────────────


describe("description rendering", () => {
  it("renders markdown to HTML in system.description.value", () => {
    const out = buildDnD5eItems(
      _payloadWith([{
        name: "Roar", type: "feat",
        description: "**Each creature** within 30 ft. must save.",
      }]),
      { actorName: "Lion" },
    );
    const desc = out[0]!.system.description as { value: string };
    expect(desc.value).toContain("<strong>Each creature</strong>");
  });

  it("emits empty description block when input description is empty", () => {
    const out = buildDnD5eItems(
      _payloadWith([{ name: "X", type: "feat" }]),
      { actorName: "Y" },
    );
    const desc = out[0]!.system.description as { value: string };
    expect(desc.value).toBe("");
  });
});


// ── Forward-compat fields (ignored, not crash) ───────────────────────────


describe("forward-compat fields", () => {
  it("ignores object_slug and compendium_source without crashing", () => {
    const out = buildDnD5eItems(
      _payloadWith([{
        name: "Longsword", type: "weapon",
        damage: { formula: "1d8", types: ["slashing"] },
        object_slug:       "longsword-of-burning",
        compendium_source: "dnd5e.items.Longsword",
      }]),
      { actorName: "Knight" },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Longsword (Knight)");
    // Reserved fields don't leak into the Item system block.
    expect((out[0]!.system as Record<string, unknown>).object_slug).toBeUndefined();
    expect((out[0]!.system as Record<string, unknown>).compendium_source).toBeUndefined();
  });
});
