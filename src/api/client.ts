/**
 * Thin HTTP client over `fetch` for dm-assistant's `/foundry/*`
 * endpoints. v1 ships `fetchHealth` only — `fetchNpc` etc. land
 * with S4 (the NPC import flow).
 *
 * All routes are DM-only on the dm-assistant side; we send
 * `?role=dm` until that gets replaced with header-based auth.
 */

import type { FoundryHealthResponse } from "./types.js";

/**
 * Categorises the failure so the UI can render a useful hint
 * instead of the raw browser error. The browser deliberately
 * conflates several distinct failures into `TypeError: Failed to
 * fetch` (CORS preflight failure, DNS failure, connection refused,
 * mixed-content block, etc.) — without devtools the operator can't
 * tell them apart. We can't fix the conflation, but we can route
 * the most common bridge cause (CORS) to a hint.
 */
export type ApiErrorKind =
  | "network"           // fetch threw — could be CORS, DNS, mixed-content, refused conn
  | "http"              // got a response, status was non-2xx
  | "timeout"           // AbortController fired
  | "shape"             // response parsed but didn't match the expected schema
  | "config";           // caller misconfigured (e.g. empty baseUrl)

export class ApiError extends Error {
  public readonly kind:    ApiErrorKind;
  public readonly status?: number;
  public readonly url?:    string;
  public override readonly cause?: unknown;

  constructor(
    message: string,
    opts: { kind: ApiErrorKind; status?: number; url?: string; cause?: unknown },
  ) {
    super(message);
    this.name   = "ApiError";
    this.kind   = opts.kind;
    this.status = opts.status;
    this.url    = opts.url;
    this.cause  = opts.cause;
  }
}

export interface ClientOptions {
  baseUrl:     string;
  apiKey?:     string;
  timeoutMs?:  number;   // default 5000
}

function normaliseBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function buildHeaders(apiKey: string | undefined): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  // dm-assistant doesn't gate /foundry/* with an API key today; the
  // setting is wired up for forward-compat. Send the header when set
  // so the upstream can start enforcing without a bridge release.
  if (apiKey && apiKey.length > 0) {
    headers["X-API-Key"] = apiKey;
  }
  return headers;
}

async function withTimeout<T>(p: Promise<T>, ms: number, signal: AbortController): Promise<T> {
  const timer = setTimeout(() => signal.abort(), ms);
  try {
    return await p;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHealth(opts: ClientOptions): Promise<FoundryHealthResponse> {
  const base   = normaliseBase(opts.baseUrl);
  if (!base) throw new ApiError("baseUrl is empty", { kind: "config" });
  const url    = `${base}/foundry/health?role=dm`;
  const ctrl   = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 5000;
  try {
    const res = await withTimeout(
      fetch(url, { headers: buildHeaders(opts.apiKey), signal: ctrl.signal }),
      timeoutMs,
      ctrl,
    );
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, { kind: "http", status: res.status, url });
    }
    const body = (await res.json()) as FoundryHealthResponse;
    // Light shape validation — refuse responses that don't look right
    // so a misconfigured base URL pointing at the wrong service fails
    // loudly instead of poisoning the indicator with a green tick.
    if (typeof body.api_contract_version !== "string") {
      throw new ApiError("Response missing api_contract_version", { kind: "shape", url });
    }
    return body;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new ApiError(`Timeout after ${timeoutMs}ms`, { kind: "timeout", url, cause: e });
    }
    // Browsers throw TypeError for ANY fetch that doesn't complete a
    // full HTTP round-trip — CORS preflight rejection, DNS miss,
    // refused connection, mixed-content block all collapse into
    // "Failed to fetch". We can't distinguish them at runtime, but
    // we can flag the failure as `network` so the UI offers a hint.
    throw new ApiError(
      e instanceof Error ? e.message : "Unknown fetch error",
      { kind: "network", url, cause: e },
    );
  }
}

/**
 * Pure semver comparator. Returns -1 / 0 / 1 like a sort callback.
 * Doesn't handle pre-release suffixes — the contract is plain X.Y.Z
 * (pinned by `test_contract_version_is_semver_shape` upstream).
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10));
  const pb = b.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}
