/**
 * Registers the bridge's six world-scoped settings with Foundry's
 * settings system. Called from the `init` hook so the settings panel
 * has them by the time the world is ready.
 *
 * On any URL/key/campaign change we re-probe `/foundry/health` and
 * update the bottom-right status indicator — keeps the operator's
 * mental model and the actual connection state in sync.
 */

import { MODULE_ID, SETTING, type SettingKey } from "./keys.js";
import { log } from "../lib/log.js";

type GameLike = {
  settings: {
    register: (module: string, key: string, config: Record<string, unknown>) => void;
    get:      (module: string, key: string) => unknown;
  };
};

declare const game: GameLike;

/**
 * Called on every setting change that affects the connection probe.
 * Injected at registration time so this module doesn't depend on the
 * status-indicator module (avoids an import cycle when the indicator
 * pulls settings to read the configured URL).
 */
export type OnConnectionSettingChange = () => void | Promise<void>;

export function registerSettings(onConnChange: OnConnectionSettingChange): void {
  const reprobe = (): void => {
    void Promise.resolve(onConnChange()).catch((e: unknown) => log.error("re-probe failed", e));
  };

  game.settings.register(MODULE_ID, SETTING.baseUrl, {
    name:    "DM-ASSISTANT-BRIDGE.settings.baseUrl.name",
    hint:    "DM-ASSISTANT-BRIDGE.settings.baseUrl.hint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "http://localhost:5000",
    onChange: reprobe,
  });

  game.settings.register(MODULE_ID, SETTING.apiKey, {
    name:    "DM-ASSISTANT-BRIDGE.settings.apiKey.name",
    hint:    "DM-ASSISTANT-BRIDGE.settings.apiKey.hint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "",
    onChange: reprobe,
  });

  game.settings.register(MODULE_ID, SETTING.campaignId, {
    name:    "DM-ASSISTANT-BRIDGE.settings.campaignId.name",
    hint:    "DM-ASSISTANT-BRIDGE.settings.campaignId.hint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "",
    onChange: reprobe,
  });

  game.settings.register(MODULE_ID, SETTING.useCampaignCodex, {
    name:    "DM-ASSISTANT-BRIDGE.settings.useCampaignCodex.name",
    hint:    "DM-ASSISTANT-BRIDGE.settings.useCampaignCodex.hint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTING.actorFolder, {
    name:    "DM-ASSISTANT-BRIDGE.settings.actorFolder.name",
    hint:    "DM-ASSISTANT-BRIDGE.settings.actorFolder.hint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "dm-assistant Imports",
  });

  game.settings.register(MODULE_ID, SETTING.journalFolder, {
    name:    "DM-ASSISTANT-BRIDGE.settings.journalFolder.name",
    hint:    "DM-ASSISTANT-BRIDGE.settings.journalFolder.hint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "dm-assistant Imports",
  });

  game.settings.register(MODULE_ID, SETTING.dataPathPrefix, {
    name:    "DM-ASSISTANT-BRIDGE.settings.dataPathPrefix.name",
    hint:    "DM-ASSISTANT-BRIDGE.settings.dataPathPrefix.hint",
    scope:   "world",
    config:  true,
    type:    String,
    default: "dm-assistant",
  });
}

/**
 * Type-safe wrapper around `game.settings.get()`. The settings API
 * returns `unknown`; this collapses the cast to one place.
 *
 * String settings are trimmed before return — a leading / trailing
 * space typed into the Foundry settings input would otherwise leak
 * into URL construction and produce 404s with the encoded space
 * (`?campaign_id=%20392740`). Trimming on read is centralised here
 * so every consumer benefits without remembering to trim.
 */
export function getSetting<T = string>(key: SettingKey): T {
  const value = game.settings.get(MODULE_ID, key);
  if (typeof value === "string") {
    return value.trim() as unknown as T;
  }
  return value as T;
}
