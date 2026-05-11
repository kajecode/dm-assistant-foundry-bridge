/**
 * Builds a human-readable hint for a probe failure based on the
 * `ApiError.kind` and the current browser origin.
 *
 * The hint is the "this is what's probably wrong" line that follows
 * the raw error message. Kept separate from `ApiError` itself so the
 * messaging can be UI-tweaked without bumping the API client's
 * surface.
 *
 * Network failures get the most useful expansion: in a Foundry
 * deployment over HTTPS, `TypeError: Failed to fetch` is almost
 * always either (a) the Foundry origin missing from dm-assistant's
 * `ALLOWED_ORIGINS`, or (b) the base URL being unreachable from the
 * browser (Insomnia / curl don't enforce CORS so they "work" even
 * when the bridge fails).
 */

import type { ApiError, ApiErrorKind } from "../api/client.js";

export interface ErrorHint {
  /** Short label that goes next to the ✗ in the UI. */
  message:  string;
  /** Multi-line tooltip explanation. */
  detail:   string;
  /** Optional. The Foundry origin to add to `ALLOWED_ORIGINS`. */
  origin?:  string;
}

/**
 * Reads the current page origin — `window.location.origin` in any
 * browser context. Returns null in tests (jsdom-without-location) so
 * the hint string is still meaningful without a real window.
 */
function readOrigin(): string | null {
  try {
    return typeof window !== "undefined" ? window.location.origin : null;
  } catch {
    return null;
  }
}

export function explainError(err: ApiError): ErrorHint {
  return EXPLAINERS[err.kind](err);
}

const EXPLAINERS: Record<ApiErrorKind, (err: ApiError) => ErrorHint> = {
  network: (err) => {
    const origin = readOrigin();
    const lines: string[] = [
      `${err.message}`,
      "",
      "The browser refused or couldn't complete the request. The most",
      "likely causes, in order:",
      "",
      "  1. CORS — your Foundry origin isn't in dm-assistant's",
      "     ALLOWED_ORIGINS list. If the same URL works in Insomnia or",
      "     curl, this is almost certainly the cause.",
      "  2. The base URL is unreachable from this browser (DNS, VPN,",
      "     firewall, dm-assistant not running).",
      "  3. Mixed content — Foundry is on HTTPS but the base URL is",
      "     HTTP. Browsers block HTTP requests from HTTPS pages.",
    ];
    if (origin) {
      lines.push("");
      lines.push(`To fix CORS, add this origin to dm-assistant's`);
      lines.push(`ALLOWED_ORIGINS env var:`);
      lines.push("");
      lines.push(`    ${origin}`);
    }
    return {
      message: origin
        ? `Failed to fetch — add "${origin}" to dm-assistant's ALLOWED_ORIGINS, or check the URL is reachable.`
        : `Failed to fetch — likely a CORS or unreachable-URL problem.`,
      detail:  lines.join("\n"),
      origin:  origin ?? undefined,
    };
  },

  http: (err) => {
    const lines = [
      `HTTP ${err.status} from ${err.url ?? "(no url)"}`,
      "",
      err.status === 403
        ? "Server rejected the request. /foundry/* is DM-only; check the bridge is sending role=dm (it should be by default)."
        : err.status === 404
        ? "Endpoint not found. Confirm the base URL points at dm-assistant and includes the /api prefix if your nginx routes it that way."
        : err.status === 401
        ? "Server demanded authentication. Set the dm-assistant API key in the settings panel."
        : "Server returned an error response. Check dm-assistant's logs for the matching request.",
    ];
    return {
      message: `HTTP ${err.status}${err.status === 404 ? " — base URL likely wrong" : ""}`,
      detail:  lines.join("\n"),
    };
  },

  timeout: (err) => ({
    message: err.message,
    detail:
      `${err.message}\n\nThe request took longer than 5 seconds. dm-assistant is probably slow or stuck — check its logs / journalctl.`,
  }),

  shape: (err) => ({
    message: "Wrong shape — base URL probably points at the wrong service",
    detail:
      `${err.message}\n\nThe URL responded but the JSON didn't include 'api_contract_version'. Confirm the base URL points at a dm-assistant /foundry/health endpoint, not some other API.`,
  }),

  config: (err) => ({
    message: err.message,
    detail:  err.message,
  }),
};
