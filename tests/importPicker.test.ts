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

const { unwrapHtml, pickedSlug, pickedActor } = _internalForTests;

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

describe("importPicker — pickedActor (unified)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns null when no row is checked", () => {
    const el = buildPickerDom();
    expect(pickedActor(el)).toBeNull();
  });

  it("returns {kind, slug} for an NPC selection", () => {
    const el = buildPickerDom();
    el.querySelector<HTMLInputElement>('input[value="npc:bravo"]')!.checked = true;
    expect(pickedActor(el)).toEqual({ kind: "npc", slug: "bravo" });
  });

  it("returns {kind, slug} for a Creature selection", () => {
    const el = buildPickerDom();
    el.querySelector<HTMLInputElement>('input[value="creature:ash-wraith"]')!.checked = true;
    expect(pickedActor(el)).toEqual({ kind: "creature", slug: "ash-wraith" });
  });

  it("rejects malformed radio values (kind not in the closed set)", () => {
    // Defence-in-depth: if a future change accidentally added a
    // `pc:foo` value before the picker grows PC support, pickedActor
    // refuses to invent a kind it doesn't know.
    const el = buildPickerDom();
    const malformed = document.createElement("input");
    malformed.type    = "radio";
    malformed.name    = "dab-actor-pick";
    malformed.value   = "pc:wizard";
    malformed.checked = true;
    el.appendChild(malformed);
    expect(pickedActor(el)).toBeNull();
  });
});
