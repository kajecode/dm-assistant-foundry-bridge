/**
 * Import picker — Foundry Dialog listing the NPCs in the configured
 * dm-assistant campaign. DM picks one, clicks Import, the
 * orchestrator runs.
 *
 * v1 deliberately renders a plain HTML list with a search filter on
 * top, inside Foundry's `Dialog` class. ApplicationV2 ports +
 * fancier UX land in S6 (shop picker) when the kind-multiplexing
 * problem actually exists.
 */

import type { SavedNpcSummary } from "../api/types.js";
import { listNpcs } from "../api/client.js";
import { importNpc } from "../import/importNpc.js";
import { getSetting } from "../settings/register.js";
import { SETTING } from "../settings/keys.js";
import { log } from "../lib/log.js";

interface FoundryDialogOpts {
  title:    string;
  content:  string;
  buttons: Record<string, {
    icon?:    string;
    label:    string;
    callback?: ((html: HTMLElement) => void | Promise<void>);
  }>;
  default?: string;
  render?:  (html: HTMLElement) => void;
  close?:   () => void;
}

declare const Dialog: new (opts: FoundryDialogOpts) => { render: (force?: boolean) => unknown };
declare const ui: {
  notifications: {
    info:  (msg: string) => void;
    warn:  (msg: string) => void;
    error: (msg: string) => void;
  };
};

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

function wireFilter(root: HTMLElement): void {
  const el = root as HTMLElement;
  const input = el.querySelector?.<HTMLInputElement>(".dab-npc-filter");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    el.querySelectorAll<HTMLElement>(".dab-npc-row").forEach((row) => {
      const name = row.querySelector(".dab-npc-name")?.textContent?.toLowerCase() ?? "";
      row.style.display = name.includes(q) ? "" : "none";
    });
  });
}

function pickedSlug(root: HTMLElement): string | null {
  const el = root as HTMLElement;
  const checked = el.querySelector?.<HTMLInputElement>('input[name="dab-npc-pick"]:checked');
  return checked?.value ?? null;
}

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

  const dialog = new Dialog({
    title:   "Import NPC from dm-assistant",
    content: buildBody(npcs),
    buttons: {
      cancel: { icon: "<i class='fas fa-times'></i>", label: "Cancel" },
      import: {
        icon:  "<i class='fas fa-download'></i>",
        label: "Import",
        callback: async (html) => {
          const slug = pickedSlug(html);
          if (!slug) {
            ui.notifications.warn("Pick an NPC first.");
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
    },
    default: "import",
    render:  wireFilter,
  });
  dialog.render(true);
}
