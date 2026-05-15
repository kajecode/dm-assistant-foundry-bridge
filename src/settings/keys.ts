/**
 * Module ID + setting-key string constants.
 *
 * Foundry's `game.settings.register()` / `.get()` / `.set()` all key
 * off `(moduleId, settingKey)` — keeping both as exported consts here
 * means a typo only ever fails in one place.
 */

export const MODULE_ID = "dm-assistant-bridge" as const;

export const SETTING = {
  baseUrl:          "baseUrl",
  apiKey:           "apiKey",
  campaignId:       "campaignId",
  useCampaignCodex: "useCampaignCodex",
  folderPrefix:     "folderPrefix",
  dataPathPrefix:   "dataPathPrefix",
  itemCompendiums:  "itemCompendiums",
} as const;

export type SettingKey = (typeof SETTING)[keyof typeof SETTING];
