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

import type { ActorKind, SavedCreatureSummary, SavedNpcSummary } from "../api/types.js";
import { listCreatures, listNpcs } from "../api/client.js";
import { importActor } from "../import/importActor.js";
import { getSetting } from "../settings/register.js";
import { SETTING } from "../settings/keys.js";
import { log } from "../lib/log.js";

/** Summary shape the picker renders. Unifies NPC + Creature
 *  summaries — Creatures lack `region` so it's optional here. */
interface PickerRow {
  slug:        string;
  name:        string;
  region?:     string;        // present for NPCs, absent for Creatures
  modified_at: string;
}

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

function rowHtml(row: PickerRow, kind: ActorKind): string {
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

function listHtml(rows: PickerRow[], kind: ActorKind, emptyMsg: string): string {
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

function buildBody(npcs: PickerRow[], creatures: PickerRow[]): string {
  // Kind toggle stays sticky at top; the two lists are siblings —
  // CSS shows only the active one. Default selection is NPC because
  // it's the higher-volume kind in practice (most campaigns have
  // many NPCs and only a handful of bestiary creatures).
  return `
    <div style="display:flex;flex-direction:column;gap:8px;max-height:480px;">
      <fieldset class="dab-kind-toggle"
                style="border:0;padding:0;margin:0;display:flex;gap:16px;">
        <legend style="margin-bottom:4px;font-weight:600;">Import</legend>
        <label style="cursor:pointer;">
          <input type="radio" name="dab-kind" value="npc" checked /> NPC
          <span style="opacity:0.7">(${npcs.length})</span>
        </label>
        <label style="cursor:pointer;">
          <input type="radio" name="dab-kind" value="creature" /> Creature
          <span style="opacity:0.7">(${creatures.length})</span>
        </label>
      </fieldset>
      <input type="search" class="dab-actor-filter" placeholder="Filter by name…"
             style="padding:4px 8px;width:100%;" />
      <div class="dab-list-container" data-active-kind="npc">
        ${listHtml(npcs,      "npc",
            "No saved NPCs found for this campaign. Generate one in dm-assistant first.")}
        ${listHtml(creatures, "creature",
            "No saved creatures found for this campaign. Disseminate a bestiary entry in dm-assistant first.")}
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
  const apply = (active: ActorKind): void => {
    container.dataset.activeKind = active;
    el.querySelectorAll<HTMLElement>(".dab-actor-list, .dab-empty").forEach((node) => {
      node.style.display = node.dataset.kind === active ? "" : "none";
    });
  };
  // Initial render — show NPC list, hide creature list.
  apply("npc");
  el.querySelectorAll<HTMLInputElement>('input[name="dab-kind"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) apply(radio.value as ActorKind);
    });
  });
}

/** Returns the picked (kind, slug) pair, or null if nothing is
 *  selected. The radio input value is encoded as `"<kind>:<slug>"`
 *  so a single radio group can carry both bits. */
function pickedActor(html: unknown): { kind: ActorKind; slug: string } | null {
  const el = unwrapHtml(html);
  if (!el) return null;
  const checked = el.querySelector<HTMLInputElement>('input[name="dab-actor-pick"]:checked');
  if (!checked) return null;
  const [kind, slug] = checked.value.split(":");
  if ((kind !== "npc" && kind !== "creature") || !slug) return null;
  return { kind, slug };
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

  // Fetch both lists concurrently — picker shows them side-by-side
  // via the kind toggle. If one list endpoint fails we still want
  // the other to populate, so we use `Promise.allSettled`.
  const opts = { baseUrl, apiKey: apiKey || undefined, campaignId };
  const [npcsRes, creaturesRes] = await Promise.allSettled([
    listNpcs(opts),
    listCreatures(opts),
  ]);

  let npcs:      PickerRow[] = [];
  let creatures: PickerRow[] = [];

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

  // Both failed → bail with an error instead of opening an empty
  // dialog. One-side failure still opens the picker so the DM can
  // import what's available.
  if (npcs.length === 0 && creatures.length === 0
      && npcsRes.status === "rejected" && creaturesRes.status === "rejected") {
    ui.notifications.error("Couldn't reach dm-assistant — check the base URL + connection.");
    return;
  }

  const DialogV2 = resolveDialogV2();
  const dialog = new DialogV2({
    window: { title: "Import from dm-assistant" },
    content: buildBody(npcs, creatures),
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
            ui.notifications.warn("Pick an NPC or Creature first.");
            return;
          }
          try {
            ui.notifications.info(`Importing ${pick.kind} ${pick.slug}…`);
            const r = await importActor({
              baseUrl,
              apiKey: apiKey || undefined,
              campaignId,
              slug: pick.slug,
              kind: pick.kind,
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
