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

import type { SavedNpcSummary } from "../api/types.js";
import { listNpcs } from "../api/client.js";
import { importNpc } from "../import/importNpc.js";
import { getSetting } from "../settings/register.js";
import { SETTING } from "../settings/keys.js";
import { log } from "../lib/log.js";

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

function rowHtml(npc: SavedNpcSummary): string {
  const region = npc.region ? ` <span class="dab-region">(${escape(npc.region)})</span>` : "";
  return `
    <li class="dab-npc-row" data-slug="${escape(npc.slug)}">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 6px;">
        <input type="radio" name="dab-npc-pick" value="${escape(npc.slug)}" />
        <span class="dab-npc-name">${escape(npc.name || npc.slug)}</span>${region}
      </label>
    </li>
  `;
}

function buildBody(npcs: SavedNpcSummary[]): string {
  if (npcs.length === 0) {
    return `<p>No saved NPCs found for this campaign. Generate one in dm-assistant first.</p>`;
  }
  const rows = npcs.map(rowHtml).join("");
  return `
    <div style="display:flex;flex-direction:column;gap:8px;max-height:400px;">
      <input type="search" class="dab-npc-filter" placeholder="Filter by name…"
             style="padding:4px 8px;width:100%;" />
      <ol class="dab-npc-list" style="list-style:none;margin:0;padding:0;overflow-y:auto;max-height:340px;">
        ${rows}
      </ol>
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
  const input = el.querySelector<HTMLInputElement>(".dab-npc-filter");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    el.querySelectorAll<HTMLElement>(".dab-npc-row").forEach((row) => {
      const name = row.querySelector(".dab-npc-name")?.textContent?.toLowerCase() ?? "";
      row.style.display = name.includes(q) ? "" : "none";
    });
  });
}

function pickedSlug(html: unknown): string | null {
  const el = unwrapHtml(html);
  if (!el) return null;
  const checked = el.querySelector<HTMLInputElement>('input[name="dab-npc-pick"]:checked');
  return checked?.value ?? null;
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

  let npcs: SavedNpcSummary[];
  try {
    npcs = await listNpcs({ baseUrl, apiKey: apiKey || undefined, campaignId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("listNpcs failed", msg);
    ui.notifications.error(`Couldn't list NPCs: ${msg}`);
    return;
  }

  const DialogV2 = resolveDialogV2();
  const dialog = new DialogV2({
    window: { title: "Import NPC from dm-assistant" },
    content: buildBody(npcs),
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
          const slug = pickedSlug(dlg.element);
          if (!slug) {
            ui.notifications.warn("Pick an NPC first.");
            // Returning here resolves the dialog promise + auto-closes.
            // For "pick again" UX we'd need to throw to keep the dialog
            // open, but v1's behaviour was also single-shot — keep
            // parity with the v0.1.0 release.
            return;
          }
          try {
            ui.notifications.info(`Importing ${slug}…`);
            const r = await importNpc({
              baseUrl,
              apiKey: apiKey || undefined,
              campaignId,
              slug,
              dataPrefix,
            });
            const journalMsg =
              r.journal === "created" ? " + DM-notes journal created" :
              r.journal === "updated" ? " + DM-notes journal updated" :
              r.journal === "deleted" ? " (stale DM-notes journal removed)" :
              "";
            ui.notifications.info(
              `Imported ${r.slug} — actor ${r.actor}${journalMsg}.`,
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
  // DialogV2 doesn't expose a per-instance `render` hook callback like
  // v1 did, so wire the filter listener after render() resolves —
  // `dialog.element` is the live DOM at that point.
  wireFilter(dialog.element);
}

// Test-only exports — keep the runtime API surface (`openImportPicker`)
// public-only; expose the DOM helpers so unit tests can pin the
// HTMLElement / jQuery-wrapper unwrap behaviour without spinning up
// Foundry.
export const _internalForTests = {
  unwrapHtml,
  pickedSlug,
  resolveDialogV2,
};
