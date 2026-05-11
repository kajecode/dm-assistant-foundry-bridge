/**
 * Entrypoint for the dm-assistant-bridge Foundry module.
 *
 * Lifecycle:
 *   init   → register settings (settings panel needs them at this point)
 *   ready  → mount the status indicator + run the first connection probe
 *   renderSettingsConfig → attach the "Test Connection" button to the panel
 *
 * No import flow yet — that's S4. The module just announces itself,
 * checks it can reach dm-assistant, and parks a status pill in the
 * corner so the operator knows where they stand.
 */

import { MODULE_ID, SETTING } from "./settings/keys.js";
import { getSetting, registerSettings } from "./settings/register.js";
import { ApiError, compareSemver, fetchHealth } from "./api/client.js";
import { mountStatusIndicator, setStatus } from "./ui/statusIndicator.js";
import { attachTestConnectionButton, type ProbeResult } from "./ui/testConnection.js";
import { explainError } from "./lib/errorHints.js";
import { log } from "./lib/log.js";

declare const Hooks: {
  on:   (name: string, fn: (...args: unknown[]) => void) => void;
  once: (name: string, fn: (...args: unknown[]) => void) => void;
};

/**
 * Reads the bridge module's declared minimum API contract version
 * from `module.json` via Foundry's module registry. Falls back to
 * `0.0.0` (accept-anything) when the flag isn't present, so a
 * misconfigured manifest doesn't trip a false `outdated` indicator.
 */
function getMinContractVersion(): string {
  type ModuleEntry = { flags?: Record<string, Record<string, unknown>> };
  type GameModules = { get: (id: string) => ModuleEntry | undefined };
  const moduleEntry = (globalThis as unknown as { game: { modules: GameModules } })
    .game.modules.get(MODULE_ID);
  const flag = moduleEntry?.flags?.[MODULE_ID]?.["min-api-contract-version"];
  return typeof flag === "string" ? flag : "0.0.0";
}

async function runProbe(): Promise<ProbeResult> {
  const baseUrl = getSetting<string>(SETTING.baseUrl);
  const apiKey  = getSetting<string>(SETTING.apiKey);
  setStatus({ state: "probing" });
  try {
    const health = await fetchHealth({ baseUrl, apiKey: apiKey || undefined });
    const minVer = getMinContractVersion();
    if (compareSemver(health.api_contract_version, minVer) < 0) {
      setStatus({
        state:   "outdated",
        version: health.api_contract_version,
        detail:  `Server contract v${health.api_contract_version} < bridge minimum v${minVer}. Upgrade dm-assistant.`,
      });
      return {
        ok:    false,
        error: `Server contract v${health.api_contract_version} is older than bridge minimum v${minVer}`,
      };
    }
    setStatus({
      state:   "connected",
      version: health.api_contract_version,
      detail:  `dm-assistant ${health.dm_assistant_version} · contract v${health.api_contract_version}`,
    });
    return {
      ok:              true,
      contractVersion: health.api_contract_version,
      serverVersion:   health.dm_assistant_version,
    };
  } catch (e) {
    if (e instanceof ApiError) {
      const hint = explainError(e);
      log.warn("health probe failed", e.kind, e.message);
      setStatus({
        state:   e.kind === "timeout" || e.kind === "network" ? "unreachable" : "unreachable",
        detail:  hint.detail,
      });
      return {
        ok:     false,
        error:  hint.message,
        hint:   hint.detail,
        origin: hint.origin,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("health probe failed (non-ApiError)", msg);
    setStatus({ state: "unreachable", detail: msg });
    return { ok: false, error: msg };
  }
}

Hooks.once("init", () => {
  log.info("init");
  registerSettings(() => {
    void runProbe();
  });
});

Hooks.once("ready", () => {
  log.info("ready — mounting status indicator and running first probe");
  mountStatusIndicator();
  void runProbe();
});

Hooks.on("renderSettingsConfig", (_app: unknown, html: unknown) => {
  attachTestConnectionButton(html as HTMLElement, runProbe);
});

// Exported for tests — not part of the public runtime surface.
export const _internal = {
  runProbe,
  getMinContractVersion,
};
