/**
 * Bridge connection status — rendered as a row inside Foundry's
 * Players Online panel (`#players`), so it collapses with the panel
 * and never overlaps the chat dock or scene controls.
 *
 * Visual: a small coloured dot + the module's display name, mimicking
 * how Foundry already renders a connected player. Tooltip carries the
 * full state detail (version, error explanation, etc.).
 *
 * Foundry re-renders the players list whenever a user joins / leaves
 * or the GM toggles activity tracking; the chip would be wiped each
 * time. We re-mount via the `renderPlayerList` hook (wired up in
 * `index.ts`) so the chip survives those refreshes.
 *
 * Fallback: in environments without a `#players` panel (tests,
 * pre-ready firings, exotic Foundry overrides) the chip mounts as a
 * pill on `document.body`. Same visual structure (dot + label), just
 * positioned fixed so it's still visible.
 */

import { log } from "../lib/log.js";

export type StatusState = "unknown" | "probing" | "connected" | "unreachable" | "outdated";

/**
 * The three version sources the bridge tracks. Each comes from a
 * different place and moves on a different cadence — see README's
 * "Versioning" section for context.
 */
export interface BridgeVersions {
  /** This module's version from `module.json`. The artefact a DM
   *  installs and sees in Foundry's module list. Used in the chip
   *  label so the user sees "what version is installed". */
  bridge?:      string;
  /** dm-assistant package version (from `/foundry/health`). The
   *  Python service running on the server. Ticks fastest of the
   *  three. Tooltip-only — not in the chip label. */
  dmAssistant?: string;
  /** API contract version (from `/foundry/health`). The HTTP wire
   *  contract. Moves slowest; controls compatibility via the
   *  bridge's declared `min-api-contract-version`. Tooltip-only. */
  apiContract?: string;
}

interface StatusPayload {
  state:     StatusState;
  detail?:   string;
  versions?: BridgeVersions;
}

const EL_ID = "dm-assistant-bridge-status";

const STATE_TO_DOT: Record<StatusState, string> = {
  unknown:     "#888",
  probing:     "#3a6ea5",
  connected:   "#2f7a3f",
  unreachable: "#a33",
  outdated:    "#b58800",
};

const STATE_TO_LABEL: Record<StatusState, string> = {
  unknown:     "unknown",
  probing:     "probing…",
  connected:   "connected",
  unreachable: "unreachable",
  outdated:    "outdated",
};

const MODULE_DISPLAY_NAME = "DM Assistant Bridge";

let currentEl: HTMLElement | null = null;
let currentPayload: StatusPayload = { state: "unknown" };

/**
 * Mount (or re-mount) the chip. Idempotent — if the chip already
 * exists, it's removed before re-creation so re-renders of the
 * players panel don't end up with stale + new chips both in the DOM.
 *
 * Selection order:
 *   1. `#players-active .players-list` — chip mounts as a list item
 *      inside the active players list, matching ItemPiles' pattern.
 *      This keeps the chip visually grouped with the players rather
 *      than separated as a footer.
 *   2. Floating pill on `document.body` — fallback for tests and
 *      pre-`ready` firings where no players panel exists.
 *
 * Logs the chosen mount target at INFO so operators can confirm in
 * devtools that mount actually ran without a screen share.
 */
export function mountStatusIndicator(): void {
  document.getElementById(EL_ID)?.remove();

  const playersList = document.querySelector<HTMLElement>("#players-active .players-list");
  if (playersList) {
    currentEl = buildChip({ mode: "list-item" });
    playersList.appendChild(currentEl);
    log.info("status chip mounted as list item in #players-active .players-list");
    applyPayload(currentPayload);
    return;
  }

  currentEl = buildChip({ mode: "fallback-pill" });
  document.body.appendChild(currentEl);
  log.info("status chip mounted as fallback pill on document.body (no players list)");
  applyPayload(currentPayload);
}

export function setStatus(next: StatusPayload): void {
  currentPayload = next;
  if (!currentEl) {
    log.debug("setStatus called before mountStatusIndicator", next.state);
    return;
  }
  applyPayload(next);
}

export function getStatus(): StatusPayload {
  return { ...currentPayload };
}

type ChipMode = "list-item" | "fallback-pill";

function buildChip(opts: { mode: ChipMode }): HTMLElement {
  const root = document.createElement("div");
  root.id = EL_ID;
  root.className = "dab-bridge-status";
  if (opts.mode === "fallback-pill") {
    Object.assign(root.style, {
      position:     "fixed",
      bottom:       "8px",
      right:        "8px",
      padding:      "4px 8px",
      background:   "rgba(0, 0, 0, 0.6)",
      color:        "#fff",
      borderRadius: "4px",
      zIndex:       "100",
      boxShadow:    "0 1px 3px rgba(0,0,0,0.3)",
    } satisfies Partial<CSSStyleDeclaration>);
  } else {
    // List item style: subtle appearance integrated into the players
    // list, with padding matching the list item styling.
    Object.assign(root.style, {
      padding:     "4px 10px",
      color:       "var(--color-text-primary, #ddd)",
    } satisfies Partial<CSSStyleDeclaration>);
  }
  Object.assign(root.style, {
    display:     "flex",
    alignItems:  "center",
    gap:         "6px",
    fontSize:    "12px",
    fontFamily:  "system-ui, sans-serif",
    cursor:      "default",
    userSelect:  "none",
    // Prevent Foundry's panel CSS from clipping our content if the
    // panel is narrow.
    minWidth:    "0",
    overflow:    "visible",
  } satisfies Partial<CSSStyleDeclaration>);

  const dot = document.createElement("span");
  dot.className = "dab-status-dot";
  Object.assign(dot.style, {
    display:      "inline-block",
    width:        "8px",
    height:       "8px",
    borderRadius: "50%",
    background:   STATE_TO_DOT.unknown,
    flexShrink:   "0",
  } satisfies Partial<CSSStyleDeclaration>);
  root.appendChild(dot);

  const label = document.createElement("span");
  label.className = "dab-status-label";
  label.textContent = MODULE_DISPLAY_NAME;
  root.appendChild(label);

  return root;
}

function applyPayload(p: StatusPayload): void {
  if (!currentEl) return;
  const dot   = currentEl.querySelector(".dab-status-dot")   as HTMLElement | null;
  const label = currentEl.querySelector(".dab-status-label") as HTMLElement | null;
  if (dot) dot.style.background = STATE_TO_DOT[p.state];
  if (label) {
    // Chip label appends the BRIDGE module version when connected —
    // matches the DM's mental model ("what version did I install").
    // The other two versions (dm-assistant, API contract) live in
    // the tooltip so a glance at the chip stays uncluttered.
    const versionTag = p.state === "connected" && p.versions?.bridge
      ? ` v${p.versions.bridge}`
      : "";
    label.textContent = `${MODULE_DISPLAY_NAME}${versionTag}`;
  }
  currentEl.title = buildTooltip(p);
}

/**
 * Tooltip structure (newline-separated, since `title` renders as
 * plain text in every browser):
 *
 *     DM Assistant Bridge: <state>
 *
 *     Bridge module: v0.2.0
 *     dm-assistant: v0.23.0
 *     API contract: v0.1.0
 *
 *     <detail line — error explanation, CORS hint, upgrade prompt>
 *
 * Empty sections (no versions, no detail) collapse out cleanly so
 * the tooltip stays minimal in the unknown / probing states.
 */
function buildTooltip(p: StatusPayload): string {
  const stateLabel = STATE_TO_LABEL[p.state];
  const parts: string[] = [`${MODULE_DISPLAY_NAME}: ${stateLabel}`];
  const versionBlock = buildVersionBlock(p.versions);
  if (versionBlock) parts.push("", versionBlock);
  if (p.detail)     parts.push("", p.detail);
  return parts.join("\n");
}

function buildVersionBlock(v: BridgeVersions | undefined): string | null {
  if (!v) return null;
  const lines: string[] = [];
  if (v.bridge)      lines.push(`Bridge module: v${v.bridge}`);
  if (v.dmAssistant) lines.push(`dm-assistant: v${v.dmAssistant}`);
  if (v.apiContract) lines.push(`API contract: v${v.apiContract}`);
  return lines.length > 0 ? lines.join("\n") : null;
}

// Test-only: drops the singleton so isolated test cases don't leak
// DOM state into each other. Not part of the runtime API.
export function _resetForTests(): void {
  currentEl?.remove();
  currentEl = null;
  currentPayload = { state: "unknown" };
}
