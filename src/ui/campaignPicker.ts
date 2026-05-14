/**
 * Replaces the free-text Campaign ID input in the Module Settings
 * panel with a `<select>` dropdown sourced from
 * `GET /campaigns?role=dm` (#12).
 *
 * v0.4.x's text input let two trippable bugs through:
 *   1. Leading whitespace pasted alongside the id (fixed in `getSetting`
 *      via trim-on-read, but the field still accepted the bad input).
 *   2. Typing the Kanka campaign id instead of the dm-assistant slug,
 *      which produced a confusing 404 with no operator-facing hint.
 *
 * A dropdown sourced from the dm-assistant server eliminates both —
 * the operator picks from known-good values. The setting itself
 * stays registered as a plain `String` (so other consumers read it
 * the same way); this module just replaces the rendered input.
 *
 * Bound to Foundry's `renderSettingsConfig` hook — fires every time
 * the settings panel re-renders.
 *
 * Fallback: if `/campaigns` is unreachable (bad URL / CORS / server
 * down / wrong host), the original text input stays in place and an
 * inline hint explains the fallback. The trim-on-read defence still
 * applies via `getSetting`.
 */

import { listCampaigns, ApiError } from "../api/client.js";
import type { CampaignSummary } from "../api/types.js";
import { MODULE_ID, SETTING } from "../settings/keys.js";
import { log } from "../lib/log.js";

/** Inject point: callers pass a fetcher so tests can substitute a
 *  stub without monkey-patching the module-level `listCampaigns`. */
export type CampaignFetchFn = (baseUrl: string) => Promise<CampaignSummary[]>;

interface SettingsHost {
  game: {
    settings: {
      get: (module: string, key: string) => unknown;
    };
  };
}

declare const game: SettingsHost["game"];


export function attachCampaignPicker(
  html:    HTMLElement,
  fetcher: CampaignFetchFn = defaultFetcher,
): void {
  const input = findCampaignIdInput(html);
  if (!input) {
    log.debug("settings panel rendered without campaignId input — skipping picker");
    return;
  }
  // Don't double-attach on re-renders.
  if (input.parentElement?.querySelector(".dm-assistant-bridge-campaign-picker")) {
    return;
  }

  // Resolve the configured baseUrl up-front. If empty, the user hasn't
  // configured the bridge yet — leave the text input in place so they
  // can fill in the URL first, then re-open settings.
  const baseUrl = String(game.settings.get(MODULE_ID, SETTING.baseUrl) ?? "").trim();
  if (!baseUrl) {
    appendFallbackHint(
      input,
      "Configure the dm-assistant URL above first, then re-open this panel to populate the dropdown.",
    );
    return;
  }

  // Render a wrapper containing select + refresh + status, and hide
  // (don't remove) the original text input so the underlying form
  // value flow stays intact.
  const wrapper = buildPickerUI(input, baseUrl, fetcher);
  const group   = (input.closest(".form-group") ?? input.parentElement) as HTMLElement | null;
  group?.appendChild(wrapper);

  // Hide the original input — but keep it in the form so the existing
  // text-input save path continues to work as a fallback. The select
  // mirrors changes into the input's value so Foundry persists the
  // selected campaign id on Save.
  input.style.display = "none";
}


function buildPickerUI(
  input:   HTMLInputElement,
  baseUrl: string,
  fetcher: CampaignFetchFn,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "dm-assistant-bridge-campaign-picker";
  wrapper.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:2px;flex-wrap:wrap;";

  const select = document.createElement("select");
  select.style.cssText = "flex:1;min-width:200px;";
  select.disabled = true;
  select.innerHTML = '<option>Loading campaigns…</option>';

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "dm-assistant-bridge-campaign-refresh";
  refresh.textContent = "↻";
  refresh.title = "Refresh campaign list";
  refresh.style.cssText = "padding:2px 8px;";

  const status = document.createElement("span");
  status.className = "dm-assistant-bridge-campaign-status";
  status.style.cssText = "font-size:12px;color:#bbb;width:100%;";

  wrapper.appendChild(select);
  wrapper.appendChild(refresh);
  wrapper.appendChild(status);

  // Mirror select changes back into the hidden text input so the
  // existing String-typed setting persists on Save.
  select.addEventListener("change", () => {
    input.value = select.value;
  });

  const loadList = async (): Promise<void> => {
    select.disabled = true;
    refresh.disabled = true;
    select.innerHTML = '<option>Loading…</option>';
    status.textContent = "";
    status.style.color = "#bbb";
    try {
      const campaigns = await fetcher(baseUrl);
      renderOptions(select, input, campaigns);
      select.disabled = campaigns.length === 0;
      status.textContent =
        campaigns.length === 0
          ? "No campaigns found on dm-assistant — create one first, then refresh."
          : `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} available · refresh after changes`;
    } catch (e) {
      // Fallback: re-show the text input so the operator isn't blocked
      // by an unreachable server. Hide the broken select.
      input.style.display = "";
      wrapper.style.display = "none";
      const after = document.createElement("div");
      after.className = "dm-assistant-bridge-campaign-fallback-hint";
      after.style.cssText = "font-size:12px;color:#a33;margin-top:4px;white-space:pre-line;";
      after.textContent = explainFetchFailure(e);
      input.parentElement?.appendChild(after);
      log.warn("campaign picker fallback to text input:", e);
    } finally {
      refresh.disabled = false;
    }
  };

  refresh.addEventListener("click", (e) => {
    e.preventDefault();
    void loadList();
  });

  // Kick off the initial load.
  void loadList();

  return wrapper;
}


function renderOptions(
  select:    HTMLSelectElement,
  input:     HTMLInputElement,
  campaigns: CampaignSummary[],
): void {
  // Sort by name for predictable ordering; id is the source of truth
  // but humans scan by name.
  const sorted = [...campaigns].sort((a, b) => a.name.localeCompare(b.name));

  // Always include an empty "— select —" sentinel at the top so an
  // unset config doesn't auto-pick the first campaign.
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— select a campaign —";
  select.appendChild(placeholder);

  const currentValue = input.value.trim();
  let currentMatched = false;
  for (const c of sorted) {
    const option = document.createElement("option");
    option.value = c.id;
    option.textContent = `${c.id} — ${c.name}${c.game_system ? ` (${c.game_system})` : ""}`;
    select.appendChild(option);
    if (c.id === currentValue) {
      currentMatched = true;
    }
  }

  // If the existing setting value doesn't match any campaign (stale
  // id from a deleted campaign, or hand-typed value), surface it as
  // a distinct option so the operator can see what's currently
  // configured and re-pick.
  if (currentValue && !currentMatched) {
    const stale = document.createElement("option");
    stale.value = currentValue;
    stale.textContent = `${currentValue} — (not in server list)`;
    select.appendChild(stale);
  }

  // Set selection via `select.value` rather than per-option `selected`
  // attributes — happy-dom (and some real browsers) treat the
  // option-level flag inconsistently when options are appended
  // dynamically.
  select.value = currentValue || "";
}


function appendFallbackHint(input: HTMLInputElement, text: string): void {
  const hint = document.createElement("div");
  hint.className = "dm-assistant-bridge-campaign-fallback-hint";
  hint.style.cssText = "font-size:12px;color:#bbb;margin-top:4px;";
  hint.textContent = text;
  (input.closest(".form-group") ?? input.parentElement)?.appendChild(hint);
}


function explainFetchFailure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.kind === "network") {
      return "Couldn't reach dm-assistant — check the URL above and that the server is running. Falling back to free-text input.";
    }
    if (e.kind === "timeout") {
      return "Timed out fetching campaigns. Falling back to free-text input.";
    }
    if (e.kind === "http") {
      return `dm-assistant returned ${e.status}. Falling back to free-text input.`;
    }
    if (e.kind === "shape") {
      return "Unexpected response shape from /campaigns. Falling back to free-text input.";
    }
  }
  return "Couldn't load campaign list. Falling back to free-text input.";
}


function findCampaignIdInput(root: ParentNode): HTMLInputElement | null {
  return root.querySelector(
    `input[name="${MODULE_ID}.${SETTING.campaignId}"]`,
  );
}


async function defaultFetcher(baseUrl: string): Promise<CampaignSummary[]> {
  return listCampaigns({ baseUrl });
}
