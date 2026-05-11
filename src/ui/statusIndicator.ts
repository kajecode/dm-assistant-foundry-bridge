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

interface StatusPayload {
  state:    StatusState;
  detail?:  string;
  version?: string;
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
 *   1. `#players` (the panel's outer `<aside>`) — chip mounts as a
 *      footer `<div>`, clearly separate from any player `<ol>`.
 *      v13 renders the panel with multiple lists (`players-active`,
 *      `players-inactive`); appending to the aside puts the chip
 *      AFTER those lists so a real user logging out doesn't end up
 *      visually grouped with the bridge chip.
 *   2. Floating pill on `document.body` — fallback for tests and
 *      pre-`ready` firings where no players panel exists.
 *
 * Logs the chosen mount target at INFO so operators can confirm in
 * devtools that mount actually ran without a screen share.
 */
export function mountStatusIndicator(): void {
  document.getElementById(EL_ID)?.remove();

  const playersAside = document.querySelector<HTMLElement>("#players");
  if (playersAside) {
    currentEl = buildChip({ mode: "panel-footer" });
    playersAside.appendChild(currentEl);
    log.info("status chip mounted as footer in #players aside");
    applyPayload(currentPayload);
    return;
  }

  currentEl = buildChip({ mode: "fallback-pill" });
  document.body.appendChild(currentEl);
  log.info("status chip mounted as fallback pill on document.body (no #players panel)");
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

type ChipMode = "panel-footer" | "fallback-pill";

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
    // Footer style: subtle card aligned to the panel's typography,
    // a thin top border separating us from the player lists above.
    Object.assign(root.style, {
      padding:     "6px 10px",
      marginTop:   "4px",
      color:       "var(--color-text-primary, #ddd)",
      borderTop:   "1px solid rgba(255, 255, 255, 0.08)",
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
    const versionTag = p.state === "connected" && p.version ? ` (v${p.version})` : "";
    label.textContent = `${MODULE_DISPLAY_NAME}${versionTag}`;
  }
  // Tooltip carries the full state + detail. `detail` from
  // `runProbe` already includes the multi-line CORS hint when the
  // probe fails, so hovering the chip is enough to diagnose.
  const stateLabel = STATE_TO_LABEL[p.state];
  const versionTail = p.version ? ` · contract v${p.version}` : "";
  currentEl.title = p.detail
    ? `${MODULE_DISPLAY_NAME}: ${stateLabel}${versionTail}\n\n${p.detail}`
    : `${MODULE_DISPLAY_NAME}: ${stateLabel}${versionTail}`;
}

// Test-only: drops the singleton so isolated test cases don't leak
// DOM state into each other. Not part of the runtime API.
export function _resetForTests(): void {
  currentEl?.remove();
  currentEl = null;
  currentPayload = { state: "unknown" };
}
