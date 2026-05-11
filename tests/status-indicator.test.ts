/**
 * DOM-level tests for the bridge connection chip.
 *
 * Two render targets are covered:
 *   1. **#players panel present** — chip mounts inside it (the
 *      common Foundry case). Survives the panel collapsing because
 *      it's part of the same DOM subtree.
 *   2. **No #players panel** — chip falls back to a fixed-position
 *      pill on document.body (tests + exotic Foundry overrides).
 *
 * Visual side-effects asserted: the colored dot, the label text,
 * the version tag, and the tooltip body. The chip's job is to
 * convey state to the operator at a glance.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mountStatusIndicator, setStatus, _resetForTests } from "../src/ui/statusIndicator.js";

const EL_ID = "dm-assistant-bridge-status";

function buildPlayersPanel(): HTMLElement {
  const el = document.createElement("aside");
  el.id = "players";
  document.body.appendChild(el);
  return el;
}

describe("statusIndicator — mount target selection", () => {
  beforeEach(() => {
    _resetForTests();
    document.body.innerHTML = "";
  });

  it("mounts inside #players panel when present", () => {
    const panel = buildPlayersPanel();
    mountStatusIndicator();
    const el = document.getElementById(EL_ID);
    expect(el).not.toBeNull();
    expect(el?.parentElement).toBe(panel);
    // No fixed positioning when inside the panel — it inherits the
    // panel's flow so it collapses with the rest of the player list.
    expect(el?.style.position).not.toBe("fixed");
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

  it("re-mounting moves the chip when the mount target changes", () => {
    // First mount: no players panel → fallback pill on body.
    mountStatusIndicator();
    const before = document.getElementById(EL_ID);
    expect(before?.parentElement).toBe(document.body);
    // Panel appears (e.g. Foundry finishes loading) and we re-mount.
    const panel = buildPlayersPanel();
    mountStatusIndicator();
    const after = document.getElementById(EL_ID);
    expect(after?.parentElement).toBe(panel);
    expect(document.querySelectorAll(`#${EL_ID}`).length).toBe(1);
  });
});

describe("statusIndicator — visual state", () => {
  beforeEach(() => {
    _resetForTests();
    document.body.innerHTML = "";
    buildPlayersPanel();   // most tests run with the panel present
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

  it("setStatus('connected') turns the dot green and appends the version tag", () => {
    mountStatusIndicator();
    setStatus({ state: "connected", version: "0.1.0", detail: "all good" });
    expect(dot().style.background).toBe("#2f7a3f");
    expect(label().textContent).toBe("DM Assistant Bridge (v0.1.0)");
    expect(document.getElementById(EL_ID)!.title).toContain("connected");
    expect(document.getElementById(EL_ID)!.title).toContain("all good");
  });

  it("setStatus('outdated') turns the dot warning-yellow", () => {
    mountStatusIndicator();
    setStatus({ state: "outdated", version: "0.0.5", detail: "upgrade me" });
    expect(dot().style.background).toBe("#b58800");
    // The version tag is suppressed for non-connected states so the
    // chip doesn't appear to confirm a stale-but-working connection.
    expect(label().textContent).toBe("DM Assistant Bridge");
    expect(document.getElementById(EL_ID)!.title).toContain("outdated");
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
    setStatus({ state: "connected", version: "0.1.0" });
    expect(document.getElementById(EL_ID)).toBeNull();
    mountStatusIndicator();
    expect(label().textContent).toBe("DM Assistant Bridge (v0.1.0)");
    expect(dot().style.background).toBe("#2f7a3f");
  });
});
