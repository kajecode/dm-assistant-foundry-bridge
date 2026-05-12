/**
 * Thin HTTP client over `fetch` for dm-assistant's `/foundry/*`
 * endpoints. v1 ships `fetchHealth` only — `fetchNpc` etc. land
 * with S4 (the NPC import flow).
 *
 * All routes are DM-only on the dm-assistant side; we send
 * `?role=dm` until that gets replaced with header-based auth.
 */

import type {
  ActorKind,
  FoundryActorResponse,
  FoundryHealthResponse,
  FoundryNpcResponse,
  SavedCreatureListResponse,
  SavedCreatureSummary,
  SavedNpcListResponse,
  SavedNpcSummary,
} from "./types.js";

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

export interface NpcFetchOptions extends ClientOptions {
  campaignId: string;
  slug:       string;
}

export interface ActorFetchOptions extends ClientOptions {
  campaignId: string;
  slug:       string;
  kind:       ActorKind;
}

/**
 * Fetch a single actor's import payload. Mirrors dm-assistant's
 * `GET /foundry/actor/{kind}/{slug}?campaign_id=...&role=dm`
 * introduced in API contract 0.2.0. Replaces the per-kind
 * `/foundry/npc/{slug}` route (which still works as a shim on the
 * server side but won't be called by this bridge after this change).
 */
export async function fetchActor(opts: ActorFetchOptions): Promise<FoundryActorResponse> {
  const base = normaliseBase(opts.baseUrl);
  if (!base)            throw new ApiError("baseUrl is empty", { kind: "config" });
  if (!opts.campaignId) throw new ApiError("campaignId is empty", { kind: "config" });
  if (!opts.slug)       throw new ApiError("slug is empty", { kind: "config" });
  if (!opts.kind)       throw new ApiError("kind is empty",   { kind: "config" });

  const url    = `${base}/foundry/actor/${encodeURIComponent(opts.kind)}/${encodeURIComponent(opts.slug)}`
               + `?campaign_id=${encodeURIComponent(opts.campaignId)}&role=dm`;
  const ctrl   = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 10000;
  try {
    const res = await withTimeout(
      fetch(url, { headers: buildHeaders(opts.apiKey), signal: ctrl.signal }),
      timeoutMs,
      ctrl,
    );
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, { kind: "http", status: res.status, url });
    }
    const body = (await res.json()) as FoundryActorResponse;
    if (typeof body.slug !== "string" || typeof body.kind !== "string") {
      throw new ApiError("Response missing slug/kind", { kind: "shape", url });
    }
    return body;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new ApiError(`Timeout after ${timeoutMs}ms`, { kind: "timeout", url, cause: e });
    }
    throw new ApiError(
      e instanceof Error ? e.message : "Unknown fetch error",
      { kind: "network", url, cause: e },
    );
  }
}

/**
 * Fetch a single NPC's import payload. **Deprecated** since
 * `fetchActor({kind: "npc", ...})` lands — thin wrapper kept for
 * back-compat in case anything else in the codebase depends on it.
 * New callers should use `fetchActor` directly.
 */
export async function fetchNpc(opts: NpcFetchOptions): Promise<FoundryNpcResponse> {
  return fetchActor({ ...opts, kind: "npc" });
}

export interface ListNpcsOptions extends ClientOptions {
  campaignId: string;
}

/**
 * Fetch the picker's NPC list. v1 uses dm-assistant's existing
 * `/npc-generate/saved` endpoint (no `/foundry/manifest` yet — see
 * S6 / `dm-assistant#450` for the planned consolidation).
 */
export async function listNpcs(opts: ListNpcsOptions): Promise<SavedNpcSummary[]> {
  const base = normaliseBase(opts.baseUrl);
  if (!base)            throw new ApiError("baseUrl is empty", { kind: "config" });
  if (!opts.campaignId) throw new ApiError("campaignId is empty", { kind: "config" });

  const url    = `${base}/npc-generate/saved?campaign_id=${encodeURIComponent(opts.campaignId)}&role=dm`;
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
    const body = (await res.json()) as SavedNpcListResponse;
    if (!Array.isArray(body.saved)) {
      throw new ApiError("Response missing 'saved' array", { kind: "shape", url });
    }
    return body.saved;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new ApiError(`Timeout after ${timeoutMs}ms`, { kind: "timeout", url, cause: e });
    }
    throw new ApiError(
      e instanceof Error ? e.message : "Unknown fetch error",
      { kind: "network", url, cause: e },
    );
  }
}

export interface ListCreaturesOptions extends ClientOptions {
  campaignId: string;
}

/**
 * Fetch the picker's Creature list. Uses dm-assistant's existing
 * `/creature-generate/saved` endpoint (parallels `/npc-generate/saved`).
 * The summary shape lacks `region` since creatures aren't tied to a
 * location the way NPCs are.
 */
export async function listCreatures(opts: ListCreaturesOptions): Promise<SavedCreatureSummary[]> {
  const base = normaliseBase(opts.baseUrl);
  if (!base)            throw new ApiError("baseUrl is empty", { kind: "config" });
  if (!opts.campaignId) throw new ApiError("campaignId is empty", { kind: "config" });

  const url    = `${base}/creature-generate/saved?campaign_id=${encodeURIComponent(opts.campaignId)}&role=dm`;
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
    const body = (await res.json()) as SavedCreatureListResponse;
    if (!Array.isArray(body.saved)) {
      throw new ApiError("Response missing 'saved' array", { kind: "shape", url });
    }
    return body.saved;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new ApiError(`Timeout after ${timeoutMs}ms`, { kind: "timeout", url, cause: e });
    }
    throw new ApiError(
      e instanceof Error ? e.message : "Unknown fetch error",
      { kind: "network", url, cause: e },
    );
  }
}

/**
 * Fetch raw bytes from dm-assistant — used for portrait + thumb
 * downloads before FilePicker upload. The `path` argument is the
 * relative URL returned in `portrait_url` / `thumb_url`
 * (e.g. `/api/npc-generate/image/aldric-harwick`); we prepend the
 * configured base URL.
 *
 * Note the path-vs-base mismatch: dm-assistant's image endpoints live
 * at `/api/npc-generate/image/...`, but the `/foundry/*` endpoints
 * also live under `/api/foundry/...`. The bridge's `baseUrl` setting
 * is e.g. `https://dm-assist-local.kaje.org/api` — so the `image`
 * URLs from the API response actually start with `/api/...`, meaning
 * a naive concat would double the `/api` prefix.
 *
 * We strip the leading `/api` from the response path when the base
 * URL already ends in `/api`. Verbose but correct.
 */
export async function fetchImageBytes(opts: ClientOptions & { path: string }): Promise<Blob> {
  const base = normaliseBase(opts.baseUrl);
  if (!base) throw new ApiError("baseUrl is empty", { kind: "config" });

  // dm-assistant's responses put `/api/...` paths in image URLs even
  // though the API itself is mounted at `/api`. If our base already
  // ends in `/api`, strip the leading `/api` to avoid doubling.
  let path = opts.path;
  if (base.endsWith("/api") && path.startsWith("/api/")) {
    path = path.slice("/api".length);
  }
  const url    = `${base}${path}`;
  const ctrl   = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 15000;
  try {
    const res = await withTimeout(
      fetch(url, { headers: buildHeaders(opts.apiKey), signal: ctrl.signal }),
      timeoutMs,
      ctrl,
    );
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, { kind: "http", status: res.status, url });
    }
    return await res.blob();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new ApiError(`Timeout after ${timeoutMs}ms`, { kind: "timeout", url, cause: e });
    }
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
