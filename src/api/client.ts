/**
 * Thin HTTP client over `fetch` for dm-assistant's `/foundry/*`
 * endpoints. v1 ships `fetchHealth` only — `fetchNpc` etc. land
 * with S4 (the NPC import flow).
 *
 * All routes are DM-only on the dm-assistant side; we send
 * `?role=dm` until that gets replaced with header-based auth.
 */

import type { FoundryHealthResponse } from "./types.js";

export class ApiError extends Error {
  public readonly status?: number;
  public override readonly cause?: unknown;

  constructor(message: string, status?: number, cause?: unknown) {
    super(message);
    this.name   = "ApiError";
    this.status = status;
    this.cause  = cause;
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
  if (!base) throw new ApiError("baseUrl is empty");
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
      throw new ApiError(`HTTP ${res.status} from ${url}`, res.status);
    }
    const body = (await res.json()) as FoundryHealthResponse;
    // Light shape validation — refuse responses that don't look right
    // so a misconfigured base URL pointing at the wrong service fails
    // loudly instead of poisoning the indicator with a green tick.
    if (typeof body.api_contract_version !== "string") {
      throw new ApiError(`Response missing api_contract_version`);
    }
    return body;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new ApiError(`Timeout after ${timeoutMs}ms`, undefined, e);
    }
    throw new ApiError(
      e instanceof Error ? e.message : "Unknown fetch error",
      undefined,
      e,
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
