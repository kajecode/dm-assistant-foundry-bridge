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
 * Selection order: prefer `#players` (Foundry's player list panel)
 * so the chip collapses with that panel; fall back to a floating
 * pill on `document.body` when the panel isn't present.
 */
export function mountStatusIndicator(): void {
  document.getElementById(EL_ID)?.remove();

  const playersPanel = document.querySelector("#players");
  if (playersPanel) {
    currentEl = buildChip(/* fallback= */ false);
    playersPanel.appendChild(currentEl);
  } else {
    currentEl = buildChip(/* fallback= */ true);
    document.body.appendChild(currentEl);
  }
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

function buildChip(fallback: boolean): HTMLElement {
  const root = document.createElement("div");
  root.id = EL_ID;
  // Two style modes. Inside the players panel we want to inherit the
  // panel's font / padding so we look like a sibling player row.
  // The fallback floats fixed-position with a bit more padding so
  // it's legible against any background.
  if (fallback) {
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
