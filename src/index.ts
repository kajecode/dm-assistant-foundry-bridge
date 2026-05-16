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
import { attachCampaignPicker } from "./ui/campaignPicker.js";
import {
  openImportPicker,
  SCOPE_ACTORS,
  SCOPE_ITEMS,
  SCOPE_JOURNAL,
  type PickerScope,
} from "./ui/importPicker.js";
import { explainError } from "./lib/errorHints.js";
import { log } from "./lib/log.js";

declare const Hooks: {
  on:   (name: string, fn: (...args: unknown[]) => void) => void;
  once: (name: string, fn: (...args: unknown[]) => void) => void;
};

declare const game: {
  modules:     { get: (id: string) => unknown };
  keybindings: {
    register: (module: string, action: string, config: Record<string, unknown>) => void;
  };
};

/**
 * Foundry v13 namespaced `KeyboardManager` under
 * `foundry.helpers.interaction.KeyboardManager`. The legacy global
 * still works but emits a deprecation warning every time it's read.
 * Look up the namespaced version first, fall through to the global
 * for older releases.
 */
type KeyboardManagerShape = {
  MODIFIER_KEYS: { CONTROL: string; SHIFT: string };
};

function resolveKeyboardManager(): KeyboardManagerShape {
  const g  = globalThis as unknown as {
    foundry?:         { helpers?: { interaction?: { KeyboardManager?: KeyboardManagerShape } } };
    KeyboardManager?: KeyboardManagerShape;
  };
  const v13 = g.foundry?.helpers?.interaction?.KeyboardManager;
  if (v13) return v13;
  if (g.KeyboardManager) return g.KeyboardManager;
  // Last-resort literals — Foundry's enum values are stable strings
  // ("Control" / "Shift"). If neither path resolves, the keybind
  // registration would otherwise crash; surface the deprecation
  // warning suppression as a string-fallback instead.
  return { MODIFIER_KEYS: { CONTROL: "Control", SHIFT: "Shift" } };
}

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

/**
 * Bridge module version, injected at build time from `module.json`
 * via Vite's `define` (see `vite.config.ts`). Foundry's runtime
 * `game.modules.get(id).version` was returning "0.0.0" in some v13
 * worlds — the build-time constant gives us a value we control end
 * to end. Falls back to undefined-equivalent in test environments
 * where `__BRIDGE_VERSION__` wasn't substituted (chip then renders
 * bare without a version tag).
 */
declare const __BRIDGE_VERSION__: string | undefined;

function getBridgeModuleVersion(): string | undefined {
  // `typeof` guard avoids ReferenceError in any environment that
  // happens to evaluate this code without the define applied.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const v: string | undefined = typeof __BRIDGE_VERSION__ === "string" ? __BRIDGE_VERSION__ : undefined;
  return v && v.length > 0 ? v : undefined;
}

async function runProbe(): Promise<ProbeResult> {
  const baseUrl = getSetting<string>(SETTING.baseUrl);
  const apiKey  = getSetting<string>(SETTING.apiKey);
  setStatus({ state: "probing" });
  try {
    const health = await fetchHealth({ baseUrl, apiKey: apiKey || undefined });
    const minVer = getMinContractVersion();
    const versions = {
      bridge:      getBridgeModuleVersion(),
      dmAssistant: health.dm_assistant_version,
      apiContract: health.api_contract_version,
    };
    if (compareSemver(health.api_contract_version, minVer) < 0) {
      setStatus({
        state:    "outdated",
        versions,
        detail:   `Server contract v${health.api_contract_version} < bridge minimum v${minVer}. Upgrade dm-assistant.`,
      });
      return {
        ok:    false,
        error: `Server contract v${health.api_contract_version} is older than bridge minimum v${minVer}`,
      };
    }
    setStatus({
      state:    "connected",
      versions,
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

  // Ctrl+Shift+D opens the NPC import picker. Modifier names go
  // through Foundry's KeyboardManager constants so we work on any
  // host OS (CONTROL maps to ⌘ on Mac automatically).
  const km = resolveKeyboardManager();
  game.keybindings.register(MODULE_ID, "openImportPicker", {
    name:    "DM-ASSISTANT-BRIDGE.keybindings.openImportPicker.name",
    hint:    "DM-ASSISTANT-BRIDGE.keybindings.openImportPicker.hint",
    editable: [{
      key:       "KeyD",
      modifiers: [km.MODIFIER_KEYS.CONTROL, km.MODIFIER_KEYS.SHIFT],
    }],
    onDown: () => {
      void openImportPicker();
      return true;
    },
    restricted: true,
  });
});

Hooks.once("ready", () => {
  log.info("ready — mounting status indicator and running first probe");
  mountStatusIndicator();
  // Foundry v13's player list renders via ApplicationV2 on a separate
  // tick. `ready` can fire before `#player-list` exists in the DOM —
  // re-attempt after a short delay so the chip lands in the right
  // target even when the panel arrived late. The renderPlayerList /
  // renderPlayers hooks below handle subsequent re-renders.
  setTimeout(() => {
    mountStatusIndicator();
  }, 500);
  void runProbe();
});

Hooks.on("renderSettingsConfig", (_app: unknown, html: unknown) => {
  const root = html as HTMLElement;
  attachTestConnectionButton(root, runProbe);
  attachCampaignPicker(root);
});

// Foundry re-renders the players list on every join/leave + on
// activity-tracking toggles, wiping any child elements we added.
// Re-mount the chip on every render so it survives those refreshes.
// `mountStatusIndicator` is idempotent (removes existing first) so
// double-firing is harmless.
//
// Hook name flux: v1 fires `renderPlayerList`, v13 ApplicationV2
// emits `renderPlayers` (deprecated `renderPlayerList` still fires
// in most builds, but not guaranteed). Listen on both.
Hooks.on("renderPlayerList", () => {
  mountStatusIndicator();
});
Hooks.on("renderPlayers", () => {
  mountStatusIndicator();
});

// #505 — mount a SCOPED "Import from dm-assistant" button on each
// Foundry sidebar tab's header, so the picker only offers the kinds
// that land in that tab:
//
//   Actors  → NPC / Creature
//   Items   → Object
//   Journal → Shop / Location  (Lore / Faction deferred — #505)
//
// `renderXDirectory` fires on every render of that directory; the
// `.dab-import-btn` guard prevents double-attach on re-renders.
function mountImportButton(
  hookLabel: string,
  html:      unknown,
  scope:     PickerScope,
): void {
  const root = (html as HTMLElement & { querySelector?: (s: string) => Element | null });
  if (root.querySelector?.(".dab-import-btn")) return;
  const header = root.querySelector?.(".directory-header .action-buttons")
              ?? root.querySelector?.(".directory-header")
              ?? root.querySelector?.("header");
  if (!header) {
    log.debug(`${hookLabel}: no header found, skipping import button`);
    return;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dab-import-btn";
  btn.innerHTML = '<i class="fas fa-download"></i> Import from dm-assistant';
  btn.style.cssText = "margin: 4px 0; padding: 4px 10px;";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    void openImportPicker(scope);
  });
  header.appendChild(btn);
}

Hooks.on("renderActorDirectory", (_app: unknown, html: unknown) => {
  mountImportButton("renderActorDirectory", html, SCOPE_ACTORS);
});
Hooks.on("renderItemDirectory", (_app: unknown, html: unknown) => {
  mountImportButton("renderItemDirectory", html, SCOPE_ITEMS);
});
Hooks.on("renderJournalDirectory", (_app: unknown, html: unknown) => {
  mountImportButton("renderJournalDirectory", html, SCOPE_JOURNAL);
});

// Module API exposed under `game.modules.get("dm-assistant-bridge").api`
// so DMs / future modules can call `importNpc` etc. from console or
// macros without going through the picker. Wired at `ready` because
// it depends on `game.modules` being populated.
Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID) as { api?: Record<string, unknown> } | undefined;
  if (mod) {
    mod.api = { openImportPicker, runProbe };
    log.info("module API ready: game.modules.get('" + MODULE_ID + "').api");
  }
});

// Exported for tests — not part of the public runtime surface.
export const _internal = {
  runProbe,
  getMinContractVersion,
};
