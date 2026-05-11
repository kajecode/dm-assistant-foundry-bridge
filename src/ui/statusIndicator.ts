/**
 * Bottom-right status pill showing the bridge's connection state.
 *
 * Renders once on `ready` and is updated by `setStatus()` from the
 * probe flow. Pure DOM — no Foundry-specific UI primitives — so it
 * lives outside Foundry's ApplicationV2 lifecycle and survives sheet
 * re-renders without re-mounting.
 */

import { log } from "../lib/log.js";

export type StatusState = "unknown" | "probing" | "connected" | "unreachable" | "outdated";

interface StatusPayload {
  state:     StatusState;
  detail?:   string;          // human-readable status line — appears in tooltip
  version?:  string;          // server's api_contract_version when known
}

const EL_ID = "dm-assistant-bridge-status";

const STATE_TO_BG: Record<StatusState, string> = {
  unknown:     "#555",
  probing:     "#3a6ea5",
  connected:   "#2f7a3f",
  unreachable: "#a33",
  outdated:    "#b58800",
};

const STATE_TO_LABEL: Record<StatusState, string> = {
  unknown:     "dm-assistant: ?",
  probing:     "dm-assistant: probing…",
  connected:   "dm-assistant: ✓ connected",
  unreachable: "dm-assistant: ✗ unreachable",
  outdated:    "dm-assistant: ⚠ outdated",
};

let currentEl: HTMLDivElement | null = null;
let currentPayload: StatusPayload = { state: "unknown" };

/**
 * Mount the indicator into the DOM. Idempotent — safe to call on
 * every `ready` hook (Foundry fires it once per world load, but the
 * guard keeps re-mounts cheap during hot reload in dev).
 */
export function mountStatusIndicator(): void {
  if (document.getElementById(EL_ID)) {
    currentEl = document.getElementById(EL_ID) as HTMLDivElement;
    return;
  }
  const el = document.createElement("div");
  el.id = EL_ID;
  Object.assign(el.style, {
    position:     "fixed",
    bottom:       "8px",
    right:        "8px",
    padding:      "4px 8px",
    fontSize:     "12px",
    fontFamily:   "system-ui, sans-serif",
    color:        "#fff",
    background:   STATE_TO_BG.unknown,
    borderRadius: "4px",
    zIndex:       "100",
    boxShadow:    "0 1px 3px rgba(0,0,0,0.3)",
    cursor:       "default",
    pointerEvents: "auto",
    userSelect:   "none",
  } satisfies Partial<CSSStyleDeclaration>);
  el.textContent = STATE_TO_LABEL.unknown;
  document.body.appendChild(el);
  currentEl = el;
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

function applyPayload(p: StatusPayload): void {
  if (!currentEl) return;
  currentEl.style.background = STATE_TO_BG[p.state];
  const label = STATE_TO_LABEL[p.state];
  const versionTag = p.version ? ` (v${p.version})` : "";
  currentEl.textContent = `${label}${versionTag}`;
  currentEl.title = p.detail ?? label;
}

// Test-only: drops the singleton so isolated test cases don't leak
// DOM state into each other. Not part of the runtime API.
export function _resetForTests(): void {
  currentEl?.remove();
  currentEl = null;
  currentPayload = { state: "unknown" };
}
