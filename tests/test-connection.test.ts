/**
 * DOM tests for the Test Connection button attached to the settings
 * panel. The hook handler accepts a `probe` callback, so we can
 * exercise success / failure / pending states without a real fetch.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { attachTestConnectionButton, type ProbeFn } from "../src/ui/testConnection.js";

function buildSettingsPanel(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <form>
      <div class="form-group">
        <label>Base URL</label>
        <input name="dm-assistant-bridge.baseUrl" value="http://x" />
      </div>
    </form>
  `;
  document.body.appendChild(root);
  return root;
}

describe("attachTestConnectionButton", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("attaches the button next to the baseUrl input", () => {
    const root = buildSettingsPanel();
    const probe: ProbeFn = vi.fn(async () => ({ ok: true as const, contractVersion: "0.1.0", serverVersion: "0.21.0" }));
    attachTestConnectionButton(root, probe);
    const btn = root.querySelector(".dm-assistant-bridge-test-btn");
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe("Test Connection");
  });

  it("is idempotent — re-attaching on the same DOM doesn't duplicate", () => {
    const root = buildSettingsPanel();
    const probe: ProbeFn = vi.fn(async () => ({ ok: true as const, contractVersion: "0.1.0", serverVersion: "x" }));
    attachTestConnectionButton(root, probe);
    attachTestConnectionButton(root, probe);
    expect(root.querySelectorAll(".dm-assistant-bridge-test-btn").length).toBe(1);
  });

  it("renders a success message after a successful probe", async () => {
    const root  = buildSettingsPanel();
    const probe: ProbeFn = vi.fn(async () => ({ ok: true as const, contractVersion: "0.1.0", serverVersion: "0.21.0" }));
    attachTestConnectionButton(root, probe);
    const btn = root.querySelector(".dm-assistant-bridge-test-btn") as HTMLButtonElement;
    btn.click();
    // The click handler is async — wait for the microtask queue.
    await vi.waitFor(() => {
      expect(root.querySelector(".dm-assistant-bridge-test-result")?.textContent).toContain("✓ connected");
    });
    expect(probe).toHaveBeenCalledOnce();
  });

  it("renders an error message after a failed probe", async () => {
    const root = buildSettingsPanel();
    const probe: ProbeFn = vi.fn(async () => ({ ok: false as const, error: "boom" }));
    attachTestConnectionButton(root, probe);
    const btn = root.querySelector(".dm-assistant-bridge-test-btn") as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => {
      expect(root.querySelector(".dm-assistant-bridge-test-result")?.textContent).toContain("✗ boom");
    });
  });

  it("renders the multi-line hint below the result when the probe returns one", async () => {
    const root = buildSettingsPanel();
    const probe: ProbeFn = vi.fn(async () => ({
      ok:    false as const,
      error: "Failed to fetch",
      hint:  "Likely CORS.\nAdd https://fvtt-local.kaje.org to ALLOWED_ORIGINS.",
    }));
    attachTestConnectionButton(root, probe);
    const btn = root.querySelector(".dm-assistant-bridge-test-btn") as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => {
      const hint = root.querySelector(".dm-assistant-bridge-test-hint") as HTMLElement;
      expect(hint.style.display).toBe("block");
      expect(hint.textContent).toContain("ALLOWED_ORIGINS");
      expect(hint.textContent).toContain("fvtt-local.kaje.org");
    });
  });

  it("hides the hint when a subsequent probe succeeds", async () => {
    const root = buildSettingsPanel();
    const calls: ProbeFn[] = [
      vi.fn(async () => ({ ok: false as const, error: "Failed to fetch", hint: "CORS-y stuff" })),
      vi.fn(async () => ({ ok: true  as const, contractVersion: "0.1.0", serverVersion: "x" })),
    ];
    let i = 0;
    const probe: ProbeFn = () => (calls[i++] as ProbeFn)();
    attachTestConnectionButton(root, probe);
    const btn = root.querySelector(".dm-assistant-bridge-test-btn") as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => {
      const hint = root.querySelector(".dm-assistant-bridge-test-hint") as HTMLElement;
      expect(hint.style.display).toBe("block");
    });
    btn.click();
    await vi.waitFor(() => {
      const hint = root.querySelector(".dm-assistant-bridge-test-hint") as HTMLElement;
      expect(hint.style.display).toBe("none");
    });
  });

  it("disables the button while a probe is in flight", async () => {
    const root = buildSettingsPanel();
    let resolveFn: (v: { ok: true; contractVersion: string; serverVersion: string }) => void = () => {};
    const probe: ProbeFn = vi.fn(
      () =>
        new Promise<{ ok: true; contractVersion: string; serverVersion: string }>((resolve) => {
          resolveFn = resolve;
        }),
    );
    attachTestConnectionButton(root, probe);
    const btn = root.querySelector(".dm-assistant-bridge-test-btn") as HTMLButtonElement;
    btn.click();
    expect(btn.disabled).toBe(true);
    resolveFn({ ok: true, contractVersion: "0.1.0", serverVersion: "x" });
    await vi.waitFor(() => {
      expect(btn.disabled).toBe(false);
    });
  });

  it("does nothing when the settings panel doesn't include the baseUrl input", () => {
    const root = document.createElement("div");
    root.innerHTML = `<form><div class="form-group"><input name="other.thing" /></div></form>`;
    document.body.appendChild(root);
    const probe: ProbeFn = vi.fn();
    attachTestConnectionButton(root, probe);
    expect(root.querySelector(".dm-assistant-bridge-test-btn")).toBeNull();
  });
});
