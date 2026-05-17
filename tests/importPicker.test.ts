/**
 * Targets the picker's DOM-extraction helpers — the bits that broke
 * in S4 smoke. `pickedSlug` + `wireFilter` accept whatever Foundry
 * hands them (HTMLElement under ApplicationV2, jQuery-wrapped element
 * under the v1 Dialog used today). Both forms must work.
 *
 * The dialog plumbing itself (Dialog construction, ui.notifications,
 * etc.) is not unit-testable without a Foundry harness — manual
 * smoke gates that.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { _internalForTests } from "../src/ui/importPicker.js";

const { unwrapHtml, pickedSlug, pickedActor, buildBody, KINDS } = _internalForTests;

function buildPickerDom(): HTMLElement {
  // Mirrors the bridge#19 picker DOM: the unified radio group
  // `name="dab-actor-pick"` carries values of the form
  // `<kind>:<slug>` so a single group covers both NPCs and Creatures.
  const root = document.createElement("div");
  root.innerHTML = `
    <input type="search" class="dab-actor-filter" />
    <ol class="dab-actor-list" data-kind="npc">
      <li class="dab-actor-row" data-kind="npc" data-slug="alpha">
        <label><input type="radio" name="dab-actor-pick" value="npc:alpha" /><span class="dab-actor-name">Alpha</span></label>
      </li>
      <li class="dab-actor-row" data-kind="npc" data-slug="bravo">
        <label><input type="radio" name="dab-actor-pick" value="npc:bravo" /><span class="dab-actor-name">Bravo</span></label>
      </li>
    </ol>
    <ol class="dab-actor-list" data-kind="creature">
      <li class="dab-actor-row" data-kind="creature" data-slug="ash-wraith">
        <label><input type="radio" name="dab-actor-pick" value="creature:ash-wraith" /><span class="dab-actor-name">Ash-Wraith</span></label>
      </li>
    </ol>
  `;
  document.body.appendChild(root);
  return root;
}

/**
 * Build a minimal jQuery-like object: `{0: HTMLElement}`. This is what
 * Foundry v1 Dialogs pass into render/callback handlers. The picker
 * unwraps via `html[0]` to get the real DOM.
 */
function asJQueryWrapper(el: HTMLElement): unknown {
  return { 0: el, length: 1 };
}

describe("importPicker — DOM unwrapping", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("unwrapHtml returns the element verbatim when given a raw HTMLElement", () => {
    const el = buildPickerDom();
    expect(unwrapHtml(el)).toBe(el);
  });

  it("unwrapHtml extracts the underlying element from a jQuery-style wrapper", () => {
    const el = buildPickerDom();
    const wrapper = asJQueryWrapper(el);
    expect(unwrapHtml(wrapper)).toBe(el);
  });

  it("unwrapHtml returns null for null / undefined / non-DOM values", () => {
    expect(unwrapHtml(null)).toBeNull();
    expect(unwrapHtml(undefined)).toBeNull();
    expect(unwrapHtml("string")).toBeNull();
    expect(unwrapHtml(42)).toBeNull();
    expect(unwrapHtml({})).toBeNull();
  });
});

describe("importPicker — pickedSlug (back-compat shim)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns null when no row is checked", () => {
    const el = buildPickerDom();
    expect(pickedSlug(el)).toBeNull();
  });

  it("returns the checked row's slug when the input is a raw HTMLElement", () => {
    const el = buildPickerDom();
    const radio = el.querySelector<HTMLInputElement>('input[value="npc:bravo"]');
    radio!.checked = true;
    expect(pickedSlug(el)).toBe("bravo");
  });

  it("returns the checked row's slug when the input is a jQuery-style wrapper", () => {
    // This is the case that broke v0.1.0 smoke: Foundry v1 Dialogs
    // pass `{0: HTMLElement}` and a naive `html.querySelector` call
    // returned undefined → "select an NPC first" warning.
    const el = buildPickerDom();
    const radio = el.querySelector<HTMLInputElement>('input[value="npc:alpha"]');
    radio!.checked = true;
    expect(pickedSlug(asJQueryWrapper(el))).toBe("alpha");
  });
});

describe("importPicker — pickedActor (scoped, #505)", () => {
  // The full kind set, mirroring the production scopes' union.
  const ALL = ["npc", "creature", "shop", "location", "object"] as const;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns null when no row is checked", () => {
    const el = buildPickerDom();
    expect(pickedActor(el, ALL)).toBeNull();
  });

  it("returns {kind, slug} for an NPC selection", () => {
    const el = buildPickerDom();
    el.querySelector<HTMLInputElement>('input[value="npc:bravo"]')!.checked = true;
    expect(pickedActor(el, ALL)).toEqual({ kind: "npc", slug: "bravo" });
  });

  it("returns {kind, slug} for a Creature selection", () => {
    const el = buildPickerDom();
    el.querySelector<HTMLInputElement>('input[value="creature:ash-wraith"]')!.checked = true;
    expect(pickedActor(el, ALL)).toEqual({ kind: "creature", slug: "ash-wraith" });
  });

  it("rejects a pick outside the active scope", () => {
    // #505: a stale/out-of-scope radio value (e.g. a creature row in
    // a Journal-scoped picker) must not dispatch. Here the DOM has an
    // npc row checked but the scope is Journal-only.
    const el = buildPickerDom();
    el.querySelector<HTMLInputElement>('input[value="npc:bravo"]')!.checked = true;
    expect(pickedActor(el, ["shop", "location"])).toBeNull();
  });

  it("accepts an object pick when object is in scope", () => {
    const el = buildPickerDom();
    const objRow = document.createElement("input");
    objRow.type    = "radio";
    objRow.name    = "dab-actor-pick";
    objRow.value   = "object:thorncall-blade";
    objRow.checked = true;
    el.appendChild(objRow);
    expect(pickedActor(el, ["object"])).toEqual({ kind: "object", slug: "thorncall-blade" });
  });

  it("rejects malformed radio values (kind not known)", () => {
    const el = buildPickerDom();
    const malformed = document.createElement("input");
    malformed.type    = "radio";
    malformed.name    = "dab-actor-pick";
    malformed.value   = "pc:wizard";
    malformed.checked = true;
    el.appendChild(malformed);
    expect(pickedActor(el, ALL)).toBeNull();
  });
});

describe("importPicker — scoped body (#505)", () => {
  it("renders only the scoped kinds' toggles + lists", () => {
    const rows = new Map<string, Array<{ slug: string; name: string; modified_at: string }>>([
      ["object", [{ slug: "thorncall-blade", name: "Thorncall Blade", modified_at: "t" }]],
    ]);
    const html = buildBody(["object"] as never, rows as never);
    expect(html).toContain('value="object"');
    expect(html).toContain("Thorncall Blade");
    // No Actor/Journal kinds leak into an Items-scoped picker.
    expect(html).not.toContain('value="npc"');
    expect(html).not.toContain('value="shop"');
    expect(html).not.toContain('value="location"');
    expect(html).not.toContain('value="creature"');
  });

  it("first scoped kind is the default-checked toggle + active list", () => {
    const html = buildBody(
      ["shop", "location"] as never,
      new Map() as never,
    );
    // First toggle (shop) checked; container active-kind = shop.
    expect(html).toMatch(/value="shop"[^>]*checked/);
    expect(html).not.toMatch(/value="location"[^>]*checked/);
    expect(html).toContain('data-active-kind="shop"');
  });

  it("KINDS covers every PickerKind with a label + empty message", () => {
    for (const k of ["npc", "creature", "shop", "location", "object", "faction", "lore"] as const) {
      expect(KINDS[k].label).toBeTruthy();
      expect(KINDS[k].empty).toContain("dm-assistant");
    }
  });

  it("Journal scope includes faction (#506) + lore (#507) alongside shop + location", () => {
    const html = buildBody(
      ["shop", "location", "faction", "lore"] as never,
      new Map() as never,
    );
    expect(html).toContain('value="shop"');
    expect(html).toContain('value="location"');
    expect(html).toContain('value="faction"');
    expect(html).toContain('value="lore"');
    // First scoped kind (shop) is the default-checked toggle.
    expect(html).toMatch(/value="shop"[^>]*checked/);
    expect(html).not.toMatch(/value="lore"[^>]*checked/);
  });
});
