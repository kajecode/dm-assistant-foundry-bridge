/**
 * DOM-level tests for the bridge connection chip.
 *
 * Two render targets are covered:
 *   1. **#players-active .players-list present** — chip mounts inside it
 *      as a list item (the common Foundry case). Survives the panel
 *      collapsing because it's part of the same DOM subtree.
 *   2. **No players list** — chip falls back to a fixed-position
 *      pill on document.body (tests + exotic Foundry overrides).
 *
 * Visual side-effects asserted: the colored dot, the label text,
 * the version tag, and the tooltip body. The chip's job is to
 * convey state to the operator at a glance.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mountStatusIndicator, setStatus, _resetForTests } from "../src/ui/statusIndicator.js";

const EL_ID = "dm-assistant-bridge-status";

function buildPlayersPanel(opts: { withInnerList?: boolean } = {}): HTMLElement {
  const aside = document.createElement("aside");
  aside.id = "players";
  if (opts.withInnerList ?? true) {
    // Foundry v13's real DOM shape: <aside id="players"> contains
    // <div id="players-active"> with <ol class="players-list">.
    const activeDiv = document.createElement("div");
    activeDiv.id = "players-active";
    const ol = document.createElement("ol");
    ol.className = "players-list";
    activeDiv.appendChild(ol);
    aside.appendChild(activeDiv);
  }
  document.body.appendChild(aside);
  return aside;
}

describe("statusIndicator — mount target selection", () => {
  beforeEach(() => {
    _resetForTests();
    document.body.innerHTML = "";
  });

  it("mounts as a list item <div> inside #players-active .players-list", () => {
    // Realistic v13 shape: panel has the players-active div with
    // players-list ol. Our chip should land inside the list.
    const panel = buildPlayersPanel({ withInnerList: true });
    mountStatusIndicator();
    const el = document.getElementById(EL_ID);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe("DIV");
    const playersList = panel.querySelector("#players-active .players-list");
    expect(el?.parentElement).toBe(playersList);
    // Last child of the list — sits after the player items.
    expect(playersList?.lastElementChild).toBe(el);
    // No fixed positioning — flows with the panel and collapses with it.
    expect(el?.style.position).not.toBe("fixed");
  });

  it("falls back to body pill when #players exists but lacks the active-list inner structure", () => {
    // The selector targets `#players-active .players-list` — when
    // the panel is bare (no inner list), mount falls through to the
    // body pill. Captures the contract the smoke screenshot confirmed
    // in v0.1.0 + ratified in #16.
    buildPlayersPanel({ withInnerList: false });
    mountStatusIndicator();
    const el = document.getElementById(EL_ID);
    expect(el?.tagName).toBe("DIV");
    expect(el?.parentElement).toBe(document.body);
  });

  it("falls back to a fixed-position pill on body when #players is absent", () => {
    mountStatusIndicator();
    const el = document.getElementById(EL_ID);
    expect(el).not.toBeNull();
    expect(el?.parentElement).toBe(document.body);
    expect(el?.style.position).toBe("fixed");
  });

  it("re-mounting after the panel re-renders keeps a single chip", () => {
    // Simulate Foundry's renderPlayerList: panel is destroyed +
    // rebuilt, our chip would go with it. Subsequent mount must
    // produce exactly one chip inside the new panel.
    buildPlayersPanel();
    mountStatusIndicator();
    // Panel re-render — wipe and rebuild.
    document.body.innerHTML = "";
    buildPlayersPanel();
    mountStatusIndicator();
    expect(document.querySelectorAll(`#${EL_ID}`).length).toBe(1);
  });

  it("re-mounting upgrades the chip when the players list appears mid-session", () => {
    // First mount: no players list → fallback pill on body.
    mountStatusIndicator();
    expect(document.getElementById(EL_ID)?.parentElement).toBe(document.body);
    // Players list appears (e.g. Foundry finishes loading) and we re-mount.
    const panel = buildPlayersPanel({ withInnerList: true });
    mountStatusIndicator();
    const after = document.getElementById(EL_ID);
    expect(after?.tagName).toBe("DIV");
    const playersList = panel.querySelector("#players-active .players-list");
    expect(after?.parentElement).toBe(playersList);
    expect(document.querySelectorAll(`#${EL_ID}`).length).toBe(1);
  });
});

describe("statusIndicator — visual state", () => {
  beforeEach(() => {
    _resetForTests();
    document.body.innerHTML = "";
    buildPlayersPanel({ withInnerList: true });   // most tests use v13 shape
  });

  function dot(): HTMLElement {
    return document.querySelector(`#${EL_ID} .dab-status-dot`) as HTMLElement;
  }
  function label(): HTMLElement {
    return document.querySelector(`#${EL_ID} .dab-status-label`) as HTMLElement;
  }

  it("renders the module's display name on initial mount", () => {
    mountStatusIndicator();
    expect(label().textContent).toBe("DM Assistant Bridge");
  });

  it("setStatus('connected') turns the dot green and appends the bridge module version", () => {
    mountStatusIndicator();
    setStatus({
      state:    "connected",
      versions: { bridge: "0.2.0", dmAssistant: "0.23.0", apiContract: "0.1.0" },
    });
    expect(dot().style.background).toBe("#2f7a3f");
    // Chip label uses the BRIDGE module version (matches what the DM
    // installed). Other two versions are in the tooltip only.
    expect(label().textContent).toBe("DM Assistant Bridge v0.2.0");
    const title = document.getElementById(EL_ID)!.title;
    expect(title).toContain("connected");
    expect(title).toContain("Bridge module: v0.2.0");
    expect(title).toContain("dm-assistant: v0.23.0");
    expect(title).toContain("API contract: v0.1.0");
  });

  it("setStatus('connected') with only the bridge version renders the chip but a minimal tooltip", () => {
    // Defensive — versions object can be partial if dm-assistant's
    // /foundry/health response is missing a field; the chip still
    // works with whatever it does have.
    mountStatusIndicator();
    setStatus({ state: "connected", versions: { bridge: "0.2.0" } });
    expect(label().textContent).toBe("DM Assistant Bridge v0.2.0");
    const title = document.getElementById(EL_ID)!.title;
    expect(title).toContain("Bridge module: v0.2.0");
    expect(title).not.toContain("dm-assistant:");
    expect(title).not.toContain("API contract:");
  });

  it("setStatus('outdated') turns the dot warning-yellow and shows all versions in the tooltip", () => {
    mountStatusIndicator();
    setStatus({
      state:    "outdated",
      versions: { bridge: "0.2.0", dmAssistant: "0.20.0", apiContract: "0.0.5" },
      detail:   "upgrade me",
    });
    expect(dot().style.background).toBe("#b58800");
    // The bridge-version tag is suppressed for non-connected states
    // so the chip doesn't appear to confirm a stale-but-working
    // connection. Tooltip still surfaces all three versions so the
    // DM can diagnose which side is out of date.
    expect(label().textContent).toBe("DM Assistant Bridge");
    const title = document.getElementById(EL_ID)!.title;
    expect(title).toContain("outdated");
    expect(title).toContain("Bridge module: v0.2.0");
    expect(title).toContain("API contract: v0.0.5");
    expect(title).toContain("upgrade me");
  });

  it("setStatus('unreachable') turns the dot red and surfaces detail in the tooltip", () => {
    mountStatusIndicator();
    setStatus({ state: "unreachable", detail: "ECONNREFUSED" });
    expect(dot().style.background).toBe("#a33");
    expect(label().textContent).toBe("DM Assistant Bridge");
    expect(document.getElementById(EL_ID)!.title).toContain("unreachable");
    expect(document.getElementById(EL_ID)!.title).toContain("ECONNREFUSED");
  });

  it("setStatus('probing') turns the dot blue", () => {
    mountStatusIndicator();
    setStatus({ state: "probing" });
    expect(dot().style.background).toBe("#3a6ea5");
    expect(document.getElementById(EL_ID)!.title).toContain("probing");
  });

  it("setStatus called before mount stashes the payload; mount auto-applies it", () => {
    // An early probe that resolves before the `ready` hook fires must
    // not be lost — `mountStatusIndicator` replays the latest payload.
    setStatus({ state: "connected", versions: { bridge: "0.2.0" } });
    expect(document.getElementById(EL_ID)).toBeNull();
    mountStatusIndicator();
    expect(label().textContent).toBe("DM Assistant Bridge v0.2.0");
    expect(dot().style.background).toBe("#2f7a3f");
  });
});
