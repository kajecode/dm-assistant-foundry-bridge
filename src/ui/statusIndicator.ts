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
 * players list don't end up with stale + new chips both in the DOM.
 *
 * Selection order:
 *   1. `#player-list` (the inner `<ol>` Foundry v13 renders inside
 *      the panel) — chip mounts as an `<li>` so it sits alongside
 *      player rows. This is the case we expect in a live world.
 *   2. `#players` (the outer `<aside>`) — chip mounts as a `<div>`
 *      after the `<ol>`. Used when Foundry's internal structure
 *      shifts in a future release.
 *   3. Floating pill on `document.body` — fallback for tests and
 *      pre-`ready` firings where no players panel exists.
 *
 * Logs the chosen mount target at INFO so operators can confirm in
 * devtools that mount actually ran. v0.1.0 smoke surfaced a case
 * where the chip wasn't visible; the log lets us tell "didn't mount"
 * from "mounted but hidden by panel CSS" without a screen share.
 */
export function mountStatusIndicator(): void {
  document.getElementById(EL_ID)?.remove();

  // Prefer the inner ol — that's where player <li> rows live, so an
  // <li> we append visually sits alongside them and inherits panel
  // styling. Selector covers Foundry v13's `#player-list` plus a
  // couple of historical variants for safety.
  const innerList = document.querySelector<HTMLElement>(
    "#player-list, #players ol, #players .players-list",
  );
  if (innerList) {
    currentEl = buildChip({ mode: "list-item" });
    innerList.appendChild(currentEl);
    log.info("status chip mounted inside player list (li)", innerList.id || innerList.className);
    applyPayload(currentPayload);
    return;
  }

  const playersAside = document.querySelector<HTMLElement>("#players");
  if (playersAside) {
    currentEl = buildChip({ mode: "panel-footer" });
    playersAside.appendChild(currentEl);
    log.info("status chip mounted in #players aside (no inner ol found)");
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

type ChipMode = "list-item" | "panel-footer" | "fallback-pill";

function buildChip(opts: { mode: ChipMode }): HTMLElement {
  // Inside the player list we want a proper <li> so we sit alongside
  // player rows and inherit the panel's row styling. Elsewhere a
  // <div> is fine.
  const tag = opts.mode === "list-item" ? "li" : "div";
  const root = document.createElement(tag);
  root.id = EL_ID;
  if (opts.mode === "list-item") {
    // Match Foundry's `<li class="player">` so we pick up the
    // panel's row padding / hover styling. The `dab-bridge` class
    // lets us override anything that doesn't fit.
    root.className = "player dab-bridge";
  }
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
    Object.assign(root.style, {
      padding: "4px 8px",
      color:   "var(--color-text-primary, #ddd)",
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
    // Prevent Foundry's list CSS from clipping our content if the
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
