/**
 * DOM tests for the campaign-picker dropdown (#12).
 *
 * The picker attaches to the settings panel's existing campaign-id
 * text input and replaces its UI with a `<select>` sourced from
 * dm-assistant's `/campaigns` endpoint. The underlying String setting
 * stays in place; we just mirror the selected option into the
 * input's `value` so Foundry persists the choice on Save.
 *
 * Inject a fake fetcher (no real network calls) and a stubbed
 * `game.settings.get` to drive baseUrl resolution.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachCampaignPicker, type CampaignFetchFn } from "../src/ui/campaignPicker.js";
import type { CampaignSummary } from "../src/api/types.js";
import { ApiError } from "../src/api/client.js";
import { SETTING } from "../src/settings/keys.js";


function buildSettingsPanel(currentValue = ""): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <form>
      <div class="form-group">
        <label>Campaign ID</label>
        <input name="dm-assistant-bridge.campaignId" value="${currentValue}" />
      </div>
    </form>
  `;
  document.body.appendChild(root);
  return root;
}


function stubGame(baseUrl: string): void {
  vi.stubGlobal("game", {
    settings: {
      get: (_mod: string, key: string) => {
        if (key === SETTING.baseUrl) return baseUrl;
        return "";
      },
    },
  });
}


const SAMPLE_CAMPAIGNS: CampaignSummary[] = [
  { id: "withering-dawn",  name: "The Withering Dawn", game_system: "D&D 5e",   chroma_ready: true  },
  { id: "tests-of-brawn",  name: "Tests of Brawn",     game_system: "D&D 5e",   chroma_ready: true  },
  { id: "elder-eye",       name: "Elder Eye",          game_system: "Pathfinder 2e", chroma_ready: false },
];


describe("attachCampaignPicker", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    stubGame("https://dm-assist-local.kaje.org");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces the text input UI with a select once campaigns load", async () => {
    const root    = buildSettingsPanel();
    const fetcher: CampaignFetchFn = vi.fn(async () => SAMPLE_CAMPAIGNS);

    attachCampaignPicker(root, fetcher);

    await vi.waitFor(() => {
      const select = root.querySelector(".dm-assistant-bridge-campaign-picker select") as HTMLSelectElement | null;
      expect(select).not.toBeNull();
      expect(select?.disabled).toBe(false);
      // 3 campaigns + 1 placeholder option = 4 options
      expect(select?.options.length).toBe(4);
    });

    // Original input is hidden, not removed (the form-value flow needs it).
    const input = root.querySelector('input[name="dm-assistant-bridge.campaignId"]') as HTMLInputElement;
    expect(input.style.display).toBe("none");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("sorts options by name (humans scan by name, not id)", async () => {
    const root    = buildSettingsPanel();
    const fetcher: CampaignFetchFn = vi.fn(async () => SAMPLE_CAMPAIGNS);

    attachCampaignPicker(root, fetcher);

    await vi.waitFor(() => {
      const select = root.querySelector(".dm-assistant-bridge-campaign-picker select") as HTMLSelectElement;
      const labels = Array.from(select.options).slice(1).map((o) => o.textContent);
      // Elder Eye → Tests of Brawn → The Withering Dawn (alpha by name).
      expect(labels).toEqual([
        "elder-eye — Elder Eye (Pathfinder 2e)",
        "tests-of-brawn — Tests of Brawn (D&D 5e)",
        "withering-dawn — The Withering Dawn (D&D 5e)",
      ]);
    });
  });

  it("pre-selects the current campaign id when it matches a known campaign", async () => {
    const root    = buildSettingsPanel("tests-of-brawn");
    const fetcher: CampaignFetchFn = vi.fn(async () => SAMPLE_CAMPAIGNS);

    attachCampaignPicker(root, fetcher);

    await vi.waitFor(() => {
      const select = root.querySelector(".dm-assistant-bridge-campaign-picker select") as HTMLSelectElement;
      expect(select.value).toBe("tests-of-brawn");
    });
  });

  it("surfaces a stale id as a distinct '(not in server list)' option", async () => {
    // Setting was previously `deleted-campaign`; server no longer reports it.
    const root    = buildSettingsPanel("deleted-campaign");
    const fetcher: CampaignFetchFn = vi.fn(async () => SAMPLE_CAMPAIGNS);

    attachCampaignPicker(root, fetcher);

    await vi.waitFor(() => {
      const select = root.querySelector(".dm-assistant-bridge-campaign-picker select") as HTMLSelectElement;
      expect(select.value).toBe("deleted-campaign");
      const labels = Array.from(select.options).map((o) => o.textContent);
      expect(labels).toContain("deleted-campaign — (not in server list)");
    });
  });

  it("mirrors the selected option back into the hidden text input", async () => {
    const root    = buildSettingsPanel();
    const fetcher: CampaignFetchFn = vi.fn(async () => SAMPLE_CAMPAIGNS);

    attachCampaignPicker(root, fetcher);

    await vi.waitFor(() => {
      expect(root.querySelector(".dm-assistant-bridge-campaign-picker select")).not.toBeNull();
    });

    const select = root.querySelector(".dm-assistant-bridge-campaign-picker select") as HTMLSelectElement;
    select.value = "withering-dawn";
    select.dispatchEvent(new Event("change"));

    const input = root.querySelector('input[name="dm-assistant-bridge.campaignId"]') as HTMLInputElement;
    expect(input.value).toBe("withering-dawn");
  });

  it("falls back to the text input when /campaigns is unreachable", async () => {
    const root    = buildSettingsPanel();
    const fetcher: CampaignFetchFn = vi.fn(async () => {
      throw new ApiError("Failed to fetch", { kind: "network", url: "https://x/campaigns" });
    });

    attachCampaignPicker(root, fetcher);

    await vi.waitFor(() => {
      // Picker UI hidden; original input restored.
      const wrapper = root.querySelector(".dm-assistant-bridge-campaign-picker") as HTMLElement;
      expect(wrapper.style.display).toBe("none");
      const input = root.querySelector('input[name="dm-assistant-bridge.campaignId"]') as HTMLInputElement;
      expect(input.style.display).toBe("");
      // Inline hint surfaces the failure with operator-friendly copy.
      const hint = root.querySelector(".dm-assistant-bridge-campaign-fallback-hint");
      expect(hint?.textContent).toContain("Couldn't reach dm-assistant");
    });
  });

  it("shows a different hint for HTTP errors than for network errors", async () => {
    const root    = buildSettingsPanel();
    const fetcher: CampaignFetchFn = vi.fn(async () => {
      throw new ApiError("HTTP 500", { kind: "http", status: 500, url: "https://x/campaigns" });
    });

    attachCampaignPicker(root, fetcher);

    await vi.waitFor(() => {
      const hint = root.querySelector(".dm-assistant-bridge-campaign-fallback-hint");
      expect(hint?.textContent).toContain("500");
    });
  });

  it("shows an empty-state hint when the server has zero campaigns", async () => {
    const root    = buildSettingsPanel();
    const fetcher: CampaignFetchFn = vi.fn(async () => []);

    attachCampaignPicker(root, fetcher);

    await vi.waitFor(() => {
      const status = root.querySelector(".dm-assistant-bridge-campaign-status");
      expect(status?.textContent).toContain("No campaigns found");
      // Select stays disabled — nothing to pick.
      const select = root.querySelector(".dm-assistant-bridge-campaign-picker select") as HTMLSelectElement;
      expect(select.disabled).toBe(true);
    });
  });

  it("refresh button re-invokes the fetcher", async () => {
    const root    = buildSettingsPanel();
    const fetcher: CampaignFetchFn = vi.fn(async () => SAMPLE_CAMPAIGNS);

    attachCampaignPicker(root, fetcher);

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledOnce();
    });

    const refresh = root.querySelector(".dm-assistant-bridge-campaign-refresh") as HTMLButtonElement;
    refresh.click();

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  it("is idempotent — re-attaching on the same DOM doesn't duplicate", async () => {
    const root    = buildSettingsPanel();
    const fetcher: CampaignFetchFn = vi.fn(async () => SAMPLE_CAMPAIGNS);

    attachCampaignPicker(root, fetcher);
    attachCampaignPicker(root, fetcher);

    await vi.waitFor(() => {
      expect(root.querySelectorAll(".dm-assistant-bridge-campaign-picker").length).toBe(1);
    });
  });

  it("skips initialisation + shows configure-url hint when baseUrl is unset", () => {
    stubGame("");
    const root    = buildSettingsPanel();
    const fetcher: CampaignFetchFn = vi.fn(async () => SAMPLE_CAMPAIGNS);

    attachCampaignPicker(root, fetcher);

    // No fetch attempted — operator has to configure URL first.
    expect(fetcher).not.toHaveBeenCalled();
    // No picker UI mounted.
    expect(root.querySelector(".dm-assistant-bridge-campaign-picker")).toBeNull();
    // Fallback hint surfaces the missing-URL state.
    const hint = root.querySelector(".dm-assistant-bridge-campaign-fallback-hint");
    expect(hint?.textContent).toContain("Configure the dm-assistant URL");
    // Original input still visible (no display:none flip).
    const input = root.querySelector('input[name="dm-assistant-bridge.campaignId"]') as HTMLInputElement;
    expect(input.style.display).toBe("");
  });

  it("skips when there is no campaign-id input in the panel", () => {
    // Some Foundry releases or unrelated module-setting panels won't
    // have our input — attaching should be a no-op, not throw.
    const root = document.createElement("div");
    root.innerHTML = `<form><div class="form-group"><input name="other.field" /></div></form>`;
    document.body.appendChild(root);

    const fetcher: CampaignFetchFn = vi.fn(async () => SAMPLE_CAMPAIGNS);
    expect(() => attachCampaignPicker(root, fetcher)).not.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
