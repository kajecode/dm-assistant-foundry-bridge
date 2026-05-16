/**
 * Import picker — Foundry v13 ApplicationV2 dialog (#11).
 *
 * #505: the picker is now **scoped**. Each Foundry sidebar tab mounts
 * its own "Import from dm-assistant" button that opens the picker
 * filtered to only the kinds that land in that tab:
 *
 *   Actors  → npc, creature        (→ Actor docs, `importActor`)
 *   Items   → object               (→ world Item,  `importObject`)
 *   Journal → shop, location       (→ JournalEntry, `importJournal`)
 *
 * (Lore + Faction Journal kinds are deferred — they need new
 * `/foundry/lore|faction` endpoint families; see #505 Out of Scope.)
 *
 * One shared component parameterised by the kind list — no per-tab
 * duplication. The kind toggle / lists / dispatch all key off the
 * passed scope.
 */

import type {
  ActorKind,
  JournalKind,
  SavedCreatureSummary,
  SavedLocationSummary,
  SavedNpcSummary,
  SavedObjectSummary,
  SavedShopSummary,
} from "../api/types.js";
import {
  listCreatures,
  listLocations,
  listNpcs,
  listObjects,
  listShops,
  type ClientOptions,
} from "../api/client.js";
import { importActor } from "../import/importActor.js";
import { importJournal } from "../import/importJournal.js";
import { importObject } from "../import/importObject.js";
import { getSetting } from "../settings/register.js";
import { SETTING } from "../settings/keys.js";
import { log } from "../lib/log.js";

/** Every kind the picker can import. `object` (#504) routes to a
 *  world Item; the rest are the pre-existing Actor/Journal kinds. */
export type PickerKind = ActorKind | JournalKind | "object";

/** A tab scope = the ordered kinds that tab's button offers. */
export type PickerScope = readonly PickerKind[];

export const SCOPE_ACTORS:  PickerScope = ["npc", "creature"];
export const SCOPE_ITEMS:   PickerScope = ["object"];
export const SCOPE_JOURNAL: PickerScope = ["shop", "location"];

/** Anything the picker shows under a radio. */
interface PickerRow {
  slug:        string;
  name:        string;
  region?:     string;
  modified_at: string;
}

interface KindConfig {
  label:    string;
  empty:    string;
  list:     (opts: ListOpts) => Promise<PickerRow[]>;
}

type ListOpts = ClientOptions & { campaignId: string };

const KINDS: Record<PickerKind, KindConfig> = {
  npc: {
    label: "NPC",
    empty: "No saved NPCs found for this campaign. Generate one in dm-assistant first.",
    list:  async (o) => (await listNpcs(o)).map(npcToRow),
  },
  creature: {
    label: "Creature",
    empty: "No saved creatures found. Disseminate a bestiary entry in dm-assistant first.",
    list:  async (o) => (await listCreatures(o)).map(creatureToRow),
  },
  shop: {
    label: "Shop",
    empty: "No saved shops found for this campaign. Generate one in dm-assistant first.",
    list:  async (o) => (await listShops(o)).map(shopToRow),
  },
  location: {
    label: "Location",
    empty: "No saved locations found. Disseminate one in dm-assistant first.",
    list:  async (o) => (await listLocations(o)).map(locationToRow),
  },
  object: {
    label: "Object",
    empty: "No saved objects found for this campaign. Generate or register one in dm-assistant first.",
    list:  async (o) => (await listObjects(o)).map(objectToRow),
  },
};

// ─── DialogV2 namespace resolver ─────────────────────────────────────────────

interface DialogV2Instance {
  element: HTMLElement;
  render:  (opts?: { force?: boolean }) => Promise<unknown>;
  close:   () => Promise<unknown>;
}

interface DialogV2Constructor {
  new (opts: {
    window: { title: string };
    content: string | HTMLElement;
    buttons: Array<{
      action:    string;
      label:     string;
      icon?:     string;
      default?:  boolean;
      callback?: (event: unknown, button: unknown, dialog: DialogV2Instance) => void | Promise<void>;
    }>;
    modal?:        boolean;
    rejectClose?:  boolean;
  }): DialogV2Instance;
}

function resolveDialogV2(): DialogV2Constructor {
  const g = globalThis as unknown as {
    foundry?: { applications?: { api?: { DialogV2?: DialogV2Constructor } } };
  };
  const v2 = g.foundry?.applications?.api?.DialogV2;
  if (!v2) {
    throw new Error(
      "Foundry DialogV2 is not available — module loaded outside a " +
      "Foundry v13+ world?",
    );
  }
  return v2;
}

// ─── Foundry runtime globals (minimal declarations) ─────────────────────────

declare const ui: {
  notifications: {
    info:  (msg: string) => void;
    warn:  (msg: string) => void;
    error: (msg: string) => void;
  };
};

// ─── HTML / DOM helpers ─────────────────────────────────────────────────────

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function npcToRow(n: SavedNpcSummary): PickerRow {
  return { slug: n.slug, name: n.name, region: n.region, modified_at: n.modified_at };
}
function creatureToRow(c: SavedCreatureSummary): PickerRow {
  return { slug: c.slug, name: c.name, modified_at: c.modified_at };
}
function shopToRow(s: SavedShopSummary): PickerRow {
  return { slug: s.slug, name: s.name, modified_at: s.modified_at };
}
function locationToRow(l: SavedLocationSummary): PickerRow {
  return { slug: l.slug, name: l.name, modified_at: l.modified_at };
}
function objectToRow(o: SavedObjectSummary): PickerRow {
  return { slug: o.slug, name: o.name, modified_at: o.modified_at };
}

function rowHtml(row: PickerRow, kind: PickerKind): string {
  const region = row.region ? ` <span class="dab-region">(${escape(row.region)})</span>` : "";
  return `
    <li class="dab-actor-row" data-kind="${kind}" data-slug="${escape(row.slug)}">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 6px;">
        <input type="radio" name="dab-actor-pick" value="${kind}:${escape(row.slug)}" />
        <span class="dab-actor-name">${escape(row.name || row.slug)}</span>${region}
      </label>
    </li>
  `;
}

function listHtml(rows: PickerRow[], kind: PickerKind, emptyMsg: string): string {
  if (rows.length === 0) {
    return `<p class="dab-empty" data-kind="${kind}">${emptyMsg}</p>`;
  }
  return `
    <ol class="dab-actor-list" data-kind="${kind}"
        style="list-style:none;margin:0;padding:0;overflow-y:auto;max-height:340px;">
      ${rows.map((r) => rowHtml(r, kind)).join("")}
    </ol>
  `;
}

/** Build the dialog body for the given (ordered) scope. Only the
 *  scoped kinds get a toggle radio + list; the first kind is the
 *  default selection. A single-kind scope (e.g. Items) still renders
 *  the toggle for layout consistency but it's the only option. */
function buildBody(scope: PickerScope, rows: Map<PickerKind, PickerRow[]>): string {
  const toggles = scope.map((k, i) => `
        <label style="cursor:pointer;">
          <input type="radio" name="dab-kind" value="${k}" ${i === 0 ? "checked" : ""} />
          ${KINDS[k].label}
          <span style="opacity:0.7">(${(rows.get(k) ?? []).length})</span>
        </label>`).join("");
  const lists = scope.map((k) =>
    listHtml(rows.get(k) ?? [], k, KINDS[k].empty)).join("");
  return `
    <div style="display:flex;flex-direction:column;gap:8px;max-height:480px;">
      <fieldset class="dab-kind-toggle"
                style="border:0;padding:0;margin:0;display:flex;gap:16px;flex-wrap:wrap;">
        <legend style="margin-bottom:4px;font-weight:600;">Import</legend>
        ${toggles}
      </fieldset>
      <input type="search" class="dab-actor-filter" placeholder="Filter by name…"
             style="padding:4px 8px;width:100%;" />
      <div class="dab-list-container" data-active-kind="${scope[0]}">
        ${lists}
      </div>
    </div>
  `;
}

function unwrapHtml(html: unknown): HTMLElement | null {
  if (html instanceof HTMLElement) return html;
  if (html && typeof html === "object" && "0" in html) {
    const inner = (html as { 0?: unknown })[0];
    if (inner instanceof HTMLElement) return inner;
  }
  return null;
}

function wireFilter(html: unknown): void {
  const el = unwrapHtml(html);
  if (!el) return;
  const input = el.querySelector<HTMLInputElement>(".dab-actor-filter");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    el.querySelectorAll<HTMLElement>(".dab-actor-row").forEach((row) => {
      const name = row.querySelector(".dab-actor-name")?.textContent?.toLowerCase() ?? "";
      row.style.display = name.includes(q) ? "" : "none";
    });
  });
}

function wireKindToggle(html: unknown, scope: PickerScope): void {
  const el = unwrapHtml(html);
  if (!el) return;
  const container = el.querySelector<HTMLElement>(".dab-list-container");
  if (!container) return;
  const apply = (active: PickerKind): void => {
    container.dataset.activeKind = active;
    el.querySelectorAll<HTMLElement>(".dab-actor-list, .dab-empty").forEach((node) => {
      node.style.display = node.dataset.kind === active ? "" : "none";
    });
  };
  apply(scope[0]!);
  el.querySelectorAll<HTMLInputElement>('input[name="dab-kind"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) apply(radio.value as PickerKind);
    });
  });
}

/** Returns the picked (kind, slug) pair, or null. The radio value is
 *  `"<kind>:<slug>"`. Validated against the active scope so a stale
 *  DOM value can't dispatch an out-of-scope import. */
function pickedActor(html: unknown, scope: PickerScope): { kind: PickerKind; slug: string } | null {
  const el = unwrapHtml(html);
  if (!el) return null;
  const checked = el.querySelector<HTMLInputElement>('input[name="dab-actor-pick"]:checked');
  if (!checked) return null;
  const [rawKind, slug] = checked.value.split(":");
  if (!slug) return null;
  if (!scope.includes(rawKind as PickerKind)) return null;
  return { kind: rawKind as PickerKind, slug };
}

/** @deprecated test-only re-export; uses the full kind set. */
function pickedSlug(html: unknown): string | null {
  const ALL: PickerScope = ["npc", "creature", "shop", "location", "object"];
  return pickedActor(html, ALL)?.slug ?? null;
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Open the picker scoped to `scope` (the kinds that tab imports).
 * Fetches the scoped lists concurrently; a per-list failure still
 * opens the dialog so the DM can import what's available.
 */
export async function openImportPicker(scope: PickerScope = SCOPE_ACTORS): Promise<void> {
  const baseUrl    = getSetting<string>(SETTING.baseUrl);
  const apiKey     = getSetting<string>(SETTING.apiKey);
  const campaignId = getSetting<string>(SETTING.campaignId);
  const dataPrefix = getSetting<string>(SETTING.dataPathPrefix);

  if (!campaignId) {
    ui.notifications.warn("Set the Campaign ID in module settings before importing.");
    return;
  }
  if (!baseUrl) {
    ui.notifications.warn("Set the dm-assistant base URL in module settings before importing.");
    return;
  }

  const opts: ListOpts = { baseUrl, apiKey: apiKey || undefined, campaignId };
  const settled = await Promise.allSettled(scope.map((k) => KINDS[k].list(opts)));

  const rows = new Map<PickerKind, PickerRow[]>();
  let anyOk = false;
  scope.forEach((k, i) => {
    const r = settled[i]!;
    if (r.status === "fulfilled") {
      rows.set(k, r.value);
      anyOk = true;
    } else {
      rows.set(k, []);
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      log.warn(`list ${k} failed`, msg);
      ui.notifications.warn(`Couldn't list ${KINDS[k].label}s: ${msg}`);
    }
  });

  const total = scope.reduce((n, k) => n + (rows.get(k) ?? []).length, 0);
  if (total === 0 && !anyOk) {
    ui.notifications.error("Couldn't reach dm-assistant — check the base URL + connection.");
    return;
  }

  const DialogV2 = resolveDialogV2();
  const dialog = new DialogV2({
    window: { title: "Import from dm-assistant" },
    content: buildBody(scope, rows),
    buttons: [
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      {
        action:  "import",
        label:   "Import",
        icon:    "fas fa-download",
        default: true,
        callback: async (_event, _button, dlg) => {
          const pick = pickedActor(dlg.element, scope);
          if (!pick) {
            ui.notifications.warn("Pick an entity first.");
            return;
          }
          try {
            ui.notifications.info(`Importing ${pick.kind} ${pick.slug}…`);
            if (pick.kind === "npc" || pick.kind === "creature") {
              const r = await importActor({
                baseUrl, apiKey: apiKey || undefined, campaignId,
                slug: pick.slug, kind: pick.kind, dataPrefix,
              });
              const journalMsg =
                r.journal === "created" ? " + DM-notes journal created" :
                r.journal === "updated" ? " + DM-notes journal updated" :
                r.journal === "deleted" ? " (stale DM-notes journal removed)" : "";
              ui.notifications.info(
                `Imported ${r.kind} ${r.slug} — actor ${r.actor}${journalMsg}.`,
              );
            } else if (pick.kind === "object") {
              const r = await importObject({
                baseUrl, apiKey: apiKey || undefined, campaignId, slug: pick.slug,
              });
              ui.notifications.info(`Imported object ${r.slug} — Item ${r.item}.`);
            } else {
              const r = await importJournal({
                baseUrl, apiKey: apiKey || undefined, campaignId,
                slug: pick.slug, kind: pick.kind, dataPrefix,
              });
              ui.notifications.info(`Imported ${r.kind} ${r.slug} — journal ${r.journal}.`);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            log.warn("import failed", msg);
            ui.notifications.error(`Import failed: ${msg}`);
          }
        },
      },
    ],
  });

  await dialog.render({ force: true });
  wireFilter(dialog.element);
  wireKindToggle(dialog.element, scope);
}

// Test-only exports.
export const _internalForTests = {
  unwrapHtml,
  pickedSlug,
  pickedActor,
  resolveDialogV2,
  buildBody,
  KINDS,
};
