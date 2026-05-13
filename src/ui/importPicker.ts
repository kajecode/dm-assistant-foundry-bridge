/**
 * Import picker — Foundry v13 ApplicationV2 dialog listing the NPCs
 * in the configured dm-assistant campaign. DM picks one, clicks
 * Import, the orchestrator runs.
 *
 * Ports from the deprecated v1 `Dialog` class to
 * `foundry.applications.api.DialogV2` (#11). Resolves via the
 * `foundry.applications.api` namespace the same way KeyboardManager
 * and FilePicker do — v13's deprecation warning was the last
 * console-noise item from the v0.1.0 smoke.
 */

import type {
  ActorKind,
  JournalKind,
  SavedCreatureSummary,
  SavedLocationSummary,
  SavedNpcSummary,
  SavedShopSummary,
} from "../api/types.js";
import {
  listCreatures,
  listLocations,
  listNpcs,
  listShops,
} from "../api/client.js";
import { importActor } from "../import/importActor.js";
import { importJournal } from "../import/importJournal.js";
import { getSetting } from "../settings/register.js";
import { SETTING } from "../settings/keys.js";
import { log } from "../lib/log.js";

/** Anything the picker shows under a radio. Unifies NPC / Creature /
 *  Shop / Location summaries. */
interface PickerRow {
  slug:        string;
  name:        string;
  region?:     string;        // present for NPCs / shops with region front-matter
  modified_at: string;
}

/** All four kinds the picker can import. Drives the kind toggle, the
 *  list dispatch, and the orchestrator routing. */
type PickerKind = ActorKind | JournalKind;

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

function buildBody(
  npcs:      PickerRow[],
  creatures: PickerRow[],
  shops:     PickerRow[],
  locations: PickerRow[],
): string {
  // Kind toggle stays sticky at top; four lists are siblings — CSS
  // shows only the active one. Default selection is NPC because it's
  // the highest-volume kind in practice. Shops + Locations are
  // journal-flavoured (#25 / #26 — bridge v0.4.0); NPCs + Creatures
  // are actor-flavoured.
  return `
    <div style="display:flex;flex-direction:column;gap:8px;max-height:480px;">
      <fieldset class="dab-kind-toggle"
                style="border:0;padding:0;margin:0;display:flex;gap:16px;flex-wrap:wrap;">
        <legend style="margin-bottom:4px;font-weight:600;">Import</legend>
        <label style="cursor:pointer;">
          <input type="radio" name="dab-kind" value="npc" checked /> NPC
          <span style="opacity:0.7">(${npcs.length})</span>
        </label>
        <label style="cursor:pointer;">
          <input type="radio" name="dab-kind" value="creature" /> Creature
          <span style="opacity:0.7">(${creatures.length})</span>
        </label>
        <label style="cursor:pointer;">
          <input type="radio" name="dab-kind" value="shop" /> Shop
          <span style="opacity:0.7">(${shops.length})</span>
        </label>
        <label style="cursor:pointer;">
          <input type="radio" name="dab-kind" value="location" /> Location
          <span style="opacity:0.7">(${locations.length})</span>
        </label>
      </fieldset>
      <input type="search" class="dab-actor-filter" placeholder="Filter by name…"
             style="padding:4px 8px;width:100%;" />
      <div class="dab-list-container" data-active-kind="npc">
        ${listHtml(npcs,      "npc",
            "No saved NPCs found for this campaign. Generate one in dm-assistant first.")}
        ${listHtml(creatures, "creature",
            "No saved creatures found for this campaign. Disseminate a bestiary entry in dm-assistant first.")}
        ${listHtml(shops,     "shop",
            "No saved shops found for this campaign. Generate one in dm-assistant first.")}
        ${listHtml(locations, "location",
            "No saved locations found for this campaign. Disseminate one in dm-assistant first.")}
      </div>
    </div>
  `;
}

/**
 * Best-effort DOM unwrap. DialogV2 hands callbacks a `dialog.element`
 * that's a raw HTMLElement — no jQuery wrapper. Helper kept around
 * (and accepting `unknown`) so future ports + tests can pass either
 * form without changing call sites.
 */
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

function wireKindToggle(html: unknown): void {
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
  // Initial render — show NPC list, hide the others.
  apply("npc");
  el.querySelectorAll<HTMLInputElement>('input[name="dab-kind"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) apply(radio.value as PickerKind);
    });
  });
}

const _PICKER_KIND_SET: ReadonlySet<PickerKind> = new Set<PickerKind>([
  "npc", "creature", "shop", "location",
]);

/** Returns the picked (kind, slug) pair, or null if nothing is
 *  selected. The radio input value is encoded as `"<kind>:<slug>"`
 *  so a single radio group can carry all four kinds. */
function pickedActor(html: unknown): { kind: PickerKind; slug: string } | null {
  const el = unwrapHtml(html);
  if (!el) return null;
  const checked = el.querySelector<HTMLInputElement>('input[name="dab-actor-pick"]:checked');
  if (!checked) return null;
  const [rawKind, slug] = checked.value.split(":");
  if (!slug) return null;
  if (!_PICKER_KIND_SET.has(rawKind as PickerKind)) return null;
  return { kind: rawKind as PickerKind, slug };
}

/** @deprecated kept for the test-only re-export; new callers use `pickedActor`. */
function pickedSlug(html: unknown): string | null {
  const pick = pickedActor(html);
  return pick?.slug ?? null;
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Open the picker. Fetches the NPC list first so any HTTP error is
 * surfaced before the dialog opens (avoids an empty modal flickering).
 */
export async function openImportPicker(): Promise<void> {
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

  // Fetch all four lists concurrently — picker shows them via the
  // kind toggle. If a list endpoint fails we still want the others
  // to populate, so we use `Promise.allSettled`.
  const opts = { baseUrl, apiKey: apiKey || undefined, campaignId };
  const [npcsRes, creaturesRes, shopsRes, locationsRes] = await Promise.allSettled([
    listNpcs(opts),
    listCreatures(opts),
    listShops(opts),
    listLocations(opts),
  ]);

  let npcs:      PickerRow[] = [];
  let creatures: PickerRow[] = [];
  let shops:     PickerRow[] = [];
  let locations: PickerRow[] = [];

  if (npcsRes.status === "fulfilled") {
    npcs = npcsRes.value.map(npcToRow);
  } else {
    const msg = npcsRes.reason instanceof Error ? npcsRes.reason.message : String(npcsRes.reason);
    log.warn("listNpcs failed", msg);
    ui.notifications.warn(`Couldn't list NPCs: ${msg}`);
  }
  if (creaturesRes.status === "fulfilled") {
    creatures = creaturesRes.value.map(creatureToRow);
  } else {
    const msg = creaturesRes.reason instanceof Error ? creaturesRes.reason.message : String(creaturesRes.reason);
    log.warn("listCreatures failed", msg);
    ui.notifications.warn(`Couldn't list Creatures: ${msg}`);
  }
  if (shopsRes.status === "fulfilled") {
    shops = shopsRes.value.map(shopToRow);
  } else {
    const msg = shopsRes.reason instanceof Error ? shopsRes.reason.message : String(shopsRes.reason);
    log.warn("listShops failed", msg);
    ui.notifications.warn(`Couldn't list Shops: ${msg}`);
  }
  if (locationsRes.status === "fulfilled") {
    locations = locationsRes.value.map(locationToRow);
  } else {
    const msg = locationsRes.reason instanceof Error ? locationsRes.reason.message : String(locationsRes.reason);
    log.warn("listLocations failed", msg);
    ui.notifications.warn(`Couldn't list Locations: ${msg}`);
  }

  // All four failed → bail with an error instead of opening an
  // empty dialog. Partial failure still opens the picker so the
  // DM can import what's available.
  const allRejected =
    npcsRes.status      === "rejected" &&
    creaturesRes.status === "rejected" &&
    shopsRes.status     === "rejected" &&
    locationsRes.status === "rejected";
  if (npcs.length === 0 && creatures.length === 0 && shops.length === 0 && locations.length === 0 && allRejected) {
    ui.notifications.error("Couldn't reach dm-assistant — check the base URL + connection.");
    return;
  }

  const DialogV2 = resolveDialogV2();
  const dialog = new DialogV2({
    window: { title: "Import from dm-assistant" },
    content: buildBody(npcs, creatures, shops, locations),
    buttons: [
      {
        action: "cancel",
        label:  "Cancel",
        icon:   "fas fa-times",
      },
      {
        action:  "import",
        label:   "Import",
        icon:    "fas fa-download",
        default: true,
        callback: async (_event, _button, dlg) => {
          const pick = pickedActor(dlg.element);
          if (!pick) {
            ui.notifications.warn("Pick an entity first.");
            return;
          }
          try {
            ui.notifications.info(`Importing ${pick.kind} ${pick.slug}…`);
            // Actor-flavoured kinds (npc + creature) go through
            // importActor; journal-flavoured kinds (shop + location)
            // go through importJournal. Each writes a different
            // Foundry document type with different drift-flag kinds.
            if (pick.kind === "npc" || pick.kind === "creature") {
              const r = await importActor({
                baseUrl,
                apiKey: apiKey || undefined,
                campaignId,
                slug:        pick.slug,
                kind:        pick.kind,
                dataPrefix,
              });
              const journalMsg =
                r.journal === "created" ? " + DM-notes journal created" :
                r.journal === "updated" ? " + DM-notes journal updated" :
                r.journal === "deleted" ? " (stale DM-notes journal removed)" :
                "";
              ui.notifications.info(
                `Imported ${r.kind} ${r.slug} — actor ${r.actor}${journalMsg}.`,
              );
            } else {
              const r = await importJournal({
                baseUrl,
                apiKey: apiKey || undefined,
                campaignId,
                slug:       pick.slug,
                kind:       pick.kind,
                dataPrefix,
              });
              ui.notifications.info(
                `Imported ${r.kind} ${r.slug} — journal ${r.journal}.`,
              );
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
  // DialogV2 doesn't expose a per-instance `render` hook callback
  // like v1 did, so wire the listeners after render() resolves —
  // `dialog.element` is the live DOM at that point.
  wireFilter(dialog.element);
  wireKindToggle(dialog.element);
}

// Test-only exports — keep the runtime API surface (`openImportPicker`)
// public-only; expose the DOM helpers so unit tests can pin the
// HTMLElement / jQuery-wrapper unwrap behaviour without spinning up
// Foundry.
export const _internalForTests = {
  unwrapHtml,
  pickedSlug,
  pickedActor,
  resolveDialogV2,
};
