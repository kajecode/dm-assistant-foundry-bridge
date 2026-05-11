/**
 * DOM-level tests for the bottom-right status pill. Runs under
 * happy-dom (configured in vite.config.ts → test.environment).
 *
 * Asserts on the visible side-effects (text content, background
 * colour, tooltip) since the indicator's job is purely to convey
 * state to the operator.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mountStatusIndicator, setStatus, _resetForTests } from "../src/ui/statusIndicator.js";

const EL_ID = "dm-assistant-bridge-status";

describe("statusIndicator", () => {
  beforeEach(() => {
    _resetForTests();
    document.body.innerHTML = "";
  });

  it("mounts a fixed pill at bottom-right with the unknown state", () => {
    mountStatusIndicator();
    const el = document.getElementById(EL_ID) as HTMLDivElement | null;
    expect(el).not.toBeNull();
    expect(el!.style.position).toBe("fixed");
    expect(el!.textContent).toContain("?");
  });

  it("is idempotent — calling mount twice keeps a single element", () => {
    mountStatusIndicator();
    mountStatusIndicator();
    expect(document.querySelectorAll(`#${EL_ID}`).length).toBe(1);
  });

  it("setStatus('connected') flips text + colour + version tag", () => {
    mountStatusIndicator();
    setStatus({ state: "connected", version: "0.1.0", detail: "all good" });
    const el = document.getElementById(EL_ID) as HTMLDivElement;
    expect(el.textContent).toContain("✓ connected");
    expect(el.textContent).toContain("v0.1.0");
    expect(el.title).toBe("all good");
    // Green-ish background. happy-dom doesn't normalise CSS colour
    // strings, so we assert the literal we set in STATE_TO_BG.
    expect(el.style.background).toBe("#2f7a3f");
  });

  it("setStatus('outdated') uses the warning colour", () => {
    mountStatusIndicator();
    setStatus({ state: "outdated", version: "0.0.5", detail: "upgrade me" });
    const el = document.getElementById(EL_ID) as HTMLDivElement;
    expect(el.textContent).toContain("⚠ outdated");
    expect(el.style.background).toBe("#b58800");
  });

  it("setStatus('unreachable') uses the error colour", () => {
    mountStatusIndicator();
    setStatus({ state: "unreachable", detail: "ECONNREFUSED" });
    const el = document.getElementById(EL_ID) as HTMLDivElement;
    expect(el.textContent).toContain("✗ unreachable");
    expect(el.style.background).toBe("#a33");
    expect(el.title).toBe("ECONNREFUSED");
  });

  it("setStatus called before mount stashes the payload; mount auto-applies it", () => {
    // An early probe that resolves before the `ready` hook fires must
    // not be lost — `mountStatusIndicator` replays the latest payload.
    setStatus({ state: "connected", version: "0.1.0" });
    expect(document.getElementById(EL_ID)).toBeNull();
    mountStatusIndicator();
    const el = document.getElementById(EL_ID) as HTMLDivElement;
    expect(el.textContent).toContain("✓ connected");
    expect(el.textContent).toContain("v0.1.0");
  });
});
