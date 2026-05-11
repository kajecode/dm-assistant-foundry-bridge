/**
 * Adds a "Test Connection" button to the Module Settings panel for
 * dm-assistant-bridge. Clicking it runs the same probe that fires on
 * world startup + on setting change, but surfaces the result inline
 * in the panel so the operator gets feedback without leaving the dialog.
 *
 * Bound to Foundry's `renderSettingsConfig` hook — fires every time
 * the settings panel re-renders.
 */

import { MODULE_ID } from "../settings/keys.js";
import { log } from "../lib/log.js";

export type ProbeResult =
  | { ok: true;  contractVersion: string; serverVersion: string }
  | { ok: false; error: string; hint?: string; origin?: string };

export type ProbeFn = () => Promise<ProbeResult>;

/**
 * The Foundry hook handler. `html` is the rendered settings DOM —
 * we attach the button next to the baseUrl input. JQuery-style API
 * because Foundry's settings panel still uses jQuery internally even
 * in v13 (ApplicationV2 uses HTMLElement directly, but the global
 * SettingsConfig is still v1).
 */
type JQueryLike = {
  find:   (selector: string) => JQueryLike;
  length: number;
  closest: (selector: string) => JQueryLike;
  append: (child: HTMLElement | string) => JQueryLike;
};

export function attachTestConnectionButton(html: JQueryLike | HTMLElement, probe: ProbeFn): void {
  const root = html as HTMLElement;
  // Support both the jQuery object Foundry passes pre-v13 and the
  // raw HTMLElement v13's ApplicationV2 passes. We work off the
  // raw DOM either way — easier to test than the jQuery shim.
  const baseUrlInput = findBaseUrlInput(root);
  if (!baseUrlInput) {
    log.debug("settings panel rendered without baseUrl input — skipping Test button");
    return;
  }
  // Don't double-attach on re-renders.
  if (baseUrlInput.parentElement?.querySelector(".dm-assistant-bridge-test-btn")) {
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:4px;";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dm-assistant-bridge-test-btn";
  button.textContent = "Test Connection";
  button.style.cssText = "padding:2px 10px;";

  const result = document.createElement("span");
  result.className = "dm-assistant-bridge-test-result";
  result.style.cssText = "font-size:12px;";

  const hint = document.createElement("div");
  hint.className = "dm-assistant-bridge-test-hint";
  hint.style.cssText = "font-size:12px;color:#bbb;margin-top:4px;white-space:pre-line;display:none;";

  button.addEventListener("click", async (e) => {
    e.preventDefault();
    button.disabled = true;
    result.style.color = "";
    result.textContent = "Probing…";
    hint.style.display = "none";
    hint.textContent = "";
    try {
      const r = await probe();
      if (r.ok) {
        result.style.color = "#2f7a3f";
        result.textContent = `✓ connected — contract v${r.contractVersion} (dm-assistant ${r.serverVersion})`;
      } else {
        result.style.color = "#a33";
        result.textContent = `✗ ${r.error}`;
        if (r.hint) {
          hint.style.display = "block";
          hint.textContent = r.hint;
        }
      }
    } finally {
      button.disabled = false;
    }
  });

  wrapper.appendChild(button);
  wrapper.appendChild(result);

  // Foundry settings rows are structured: <div class="form-group">
  //   <label>…</label> <input name="dm-assistant-bridge.baseUrl">
  // We append the test row inside the same form-group so it stays
  // visually adjacent to the input.
  const group = baseUrlInput.closest(".form-group") ?? baseUrlInput.parentElement;
  group?.appendChild(wrapper);
  group?.appendChild(hint);
}

function findBaseUrlInput(root: ParentNode): HTMLElement | null {
  // Foundry namespaces setting inputs as `<module>.<key>`.
  return root.querySelector(`input[name="${MODULE_ID}.baseUrl"]`);
}
