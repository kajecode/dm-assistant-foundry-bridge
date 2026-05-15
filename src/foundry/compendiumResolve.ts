/**
 * Compendium-source resolution (#32).
 *
 * The v0.5.x items translator (`src/translators/dnd5e/items.ts`)
 * produces **stub** Item data — name + description + the thin
 * mechanical fields the LLM extracted. For catalogue items
 * (Longsword, Fireball, Healing Potion…) a fully-statted compendium
 * document is far better: real mechanics, art, SRD rules text.
 *
 * This module runs as a **Foundry-runtime post-pass** between the
 * pure translator (`buildImportBundle`) and persistence
 * (`createOrUpdateActor`). For each stub it tries, in order:
 *
 *   1. An explicit `flags.dm-assistant-bridge.compendium_source`
 *      (dm-assistant#485 reserved field; populated by #481 v2).
 *      Resolved via `fromUuid`.
 *   2. An exact (normalised) name match across the operator's
 *      configured Item compendiums.
 *
 * On a confident match the stub is replaced with the compendium
 * document's data — same `DnD5eItemData` shape so the persist layer
 * is unchanged. The bridge drift flag (`source: "dm-assistant"`) is
 * preserved so re-import drop-and-replace still works; a
 * `resolved_from` flag + `flags.core.sourceId` record provenance.
 *
 * The matched compendium item is also copied (idempotently) into a
 * world `<prefix> — Items` folder so the GM has a browsable library.
 * That copy is best-effort: a failure logs + is swallowed, never
 * blocking the actor import.
 *
 * Feature is **opt-in**: the `itemCompendiums` setting is empty by
 * default → every stub passes through untouched (v0.5.2 behaviour).
 */

import { MODULE_ID, SETTING } from "../settings/keys.js";
import { getSetting } from "../settings/register.js";
import { resolveItemsFolderId } from "./folders.js";
import {
  ITEM_SOURCE_MARKER,
  type DnD5eItemData,
} from "../translators/dnd5e/items.js";
import type { ActionItemType } from "../translators/dnd5e/types.js";
import { log } from "../lib/log.js";


// ─── Foundry runtime shapes (minimal slices) ───────────────────────────────

interface CompendiumIndexEntry {
  _id:  string;
  name: string;
  type: string;
}

interface CompendiumDocLike {
  /** Plain-object form of the document, incl. `system`, `img`,
   *  `name`, `type`, `effects`. */
  toObject: () => Record<string, unknown>;
  uuid:     string;
}

interface CompendiumPackLike {
  metadata:     { id: string };
  documentName: string;                       // "Item" for item packs
  index:        Iterable<CompendiumIndexEntry> & {
    find: (p: (e: CompendiumIndexEntry) => boolean) => CompendiumIndexEntry | undefined;
  };
  getDocument:  (id: string) => Promise<CompendiumDocLike | null>;
}

interface ItemDirDocLike {
  getFlag: (scope: string, key: string) => unknown;
}

declare const game: {
  packs: Iterable<CompendiumPackLike> & {
    get: (id: string) => CompendiumPackLike | undefined;
  };
  items: { find: (p: (d: ItemDirDocLike) => boolean) => ItemDirDocLike | undefined };
};
declare const Item: {
  create: (data: Record<string, unknown>) => Promise<unknown>;
};
declare function fromUuid(uuid: string): Promise<CompendiumDocLike | null>;


// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Resolve a list of stub items against the configured compendiums.
 * Returns a new array (same length, same order) where matched stubs
 * are swapped for compendium-backed data and unmatched stubs pass
 * through verbatim.
 *
 * Never throws — a resolution failure for one item degrades that
 * item to its stub and is logged; the import always proceeds.
 */
export async function resolveItemsAgainstCompendiums(
  stubs: DnD5eItemData[],
): Promise<DnD5eItemData[]> {
  if (stubs.length === 0) return stubs;

  const setting = String(getSetting(SETTING.itemCompendiums) ?? "").trim();
  const packs   = selectPacks(setting);

  // Feature off (empty setting) AND no item carries an explicit
  // compendium_source → nothing to do, return stubs untouched.
  const anyExplicit = stubs.some(
    (s) => !!s.flags[MODULE_ID].compendium_source,
  );
  if (packs.length === 0 && !anyExplicit) return stubs;

  let itemsFolderId: string | null = null;
  const ensureFolder = async (): Promise<string | null> => {
    if (itemsFolderId !== null) return itemsFolderId;
    try {
      itemsFolderId = await resolveItemsFolderId();
    } catch (e) {
      log.warn("compendium-resolve: Items folder create failed; skipping library copy", e);
      itemsFolderId = "";    // sentinel: tried + failed, don't retry
    }
    return itemsFolderId || null;
  };

  const out: DnD5eItemData[] = [];
  for (const stub of stubs) {
    try {
      const resolved = await resolveOne(stub, packs);
      if (resolved) {
        out.push(resolved.data);
        const folderId = await ensureFolder();
        if (folderId) {
          await copyToItemsFolder(resolved.raw, resolved.uuid, stub, folderId);
        }
      } else {
        out.push(stub);
      }
    } catch (e) {
      log.warn(
        `compendium-resolve: ${stub.flags[MODULE_ID].origin_name ?? stub.name} ` +
        `failed; keeping LLM stub`, e,
      );
      out.push(stub);
    }
  }
  return out;
}


// ─── Pack selection ────────────────────────────────────────────────────────

/**
 * Resolve the `itemCompendiums` setting into a list of packs to
 * search. `""` → none (off). `"auto"` → every Item-type pack.
 * Otherwise a comma-separated list of pack collection ids; unknown
 * ids are logged + skipped (don't fail the whole import for a typo).
 */
function selectPacks(setting: string): CompendiumPackLike[] {
  if (!setting) return [];
  const allItemPacks = [...game.packs].filter((p) => p.documentName === "Item");

  if (setting.toLowerCase() === "auto") return allItemPacks;

  const ids = setting.split(",").map((s) => s.trim()).filter(Boolean);
  const picked: CompendiumPackLike[] = [];
  for (const id of ids) {
    const pack = game.packs.get(id);
    if (!pack) {
      log.warn(`compendium-resolve: configured pack "${id}" not found — skipping`);
      continue;
    }
    if (pack.documentName !== "Item") {
      log.warn(`compendium-resolve: pack "${id}" is not an Item pack — skipping`);
      continue;
    }
    picked.push(pack);
  }
  return picked;
}


// ─── Per-item resolution ───────────────────────────────────────────────────

interface ResolvedItem {
  data: DnD5eItemData;                 // resolved, persist-ready
  raw:  Record<string, unknown>;       // the compendium toObject() (for the library copy)
  uuid: string;                        // compendium provenance UUID
}

async function resolveOne(
  stub:  DnD5eItemData,
  packs: CompendiumPackLike[],
): Promise<ResolvedItem | null> {
  const flag = stub.flags[MODULE_ID];

  // 1. Explicit compendium_source wins. dm-assistant#481 v2 will
  //    populate this; format is assumed to be a Foundry UUID
  //    (`Compendium.<pack>.Item.<id>`). If it doesn't resolve we
  //    fall through to name search rather than failing.
  if (flag.compendium_source) {
    const doc = await fromUuid(flag.compendium_source).catch(() => null);
    if (doc) {
      const built = buildResolved(doc, stub);
      if (built) return built;
    } else {
      log.debug(
        `compendium-resolve: compendium_source "${flag.compendium_source}" ` +
        `did not resolve; falling back to name search`,
      );
    }
  }

  // 2. Exact (normalised) name search. Match on the LLM's original
  //    item name, NOT the `(actor)`-decorated display name.
  const target = normaliseName(flag.origin_name ?? stub.name);
  if (!target) return null;

  for (const pack of packs) {
    const entry = pack.index.find((e) => normaliseName(e.name) === target);
    if (!entry) continue;
    const doc = await pack.getDocument(entry._id);
    if (!doc) continue;
    const built = buildResolved(doc, stub);
    if (built) {
      log.info(
        `compendium-resolve: "${flag.origin_name ?? stub.name}" → ` +
        `${pack.metadata.id} (${doc.uuid})`,
      );
      return built;
    }
  }
  return null;
}


/**
 * Turn a resolved compendium document into persist-ready
 * `DnD5eItemData`. Rejects (returns null) when the compendium doc's
 * type isn't one the bridge translates — guards against a stray
 * name collision pulling in a "class" / "background" document.
 */
function buildResolved(
  doc:  CompendiumDocLike,
  stub: DnD5eItemData,
): ResolvedItem | null {
  const raw = doc.toObject();
  const type = raw.type as string;

  const ALLOWED: ReadonlySet<ActionItemType> = new Set<ActionItemType>([
    "weapon", "feat", "spell", "equipment", "consumable", "tool", "loot",
  ]);
  if (!ALLOWED.has(type as ActionItemType)) {
    log.debug(
      `compendium-resolve: ${doc.uuid} is type "${type}", not a bridge ` +
      `item type — keeping stub`,
    );
    return null;
  }

  const flag = stub.flags[MODULE_ID];

  // Strip Foundry-managed identity off the compendium copy so the
  // create assigns fresh ids/timestamps. Keep `system`, `img`,
  // `effects` — that's the whole point (real mechanics + art).
  const {
    _id: _droppedId,
    _stats: _droppedStats,
    folder: _droppedFolder,
    ownership: _droppedOwnership,
    flags: rawFlags,
    ...rest
  } = raw as Record<string, unknown> & { flags?: Record<string, unknown> };

  const data: DnD5eItemData = {
    name: raw.name as string,            // catalogue name, NOT actor-decorated
    type: type as ActionItemType,        // compendium type is authoritative
    img:  raw.img as string | undefined,
    system: (rest.system ?? {}) as Record<string, unknown>,
    flags: {
      // Preserve any non-bridge flags the compendium item carried
      // (dnd5e provenance etc.) — but drop the deprecated
      // `core.sourceId` so we don't reintroduce the v12 deprecation.
      ...stripDeprecatedCoreSourceId(rawFlags),
      [MODULE_ID]: {
        slug:              flag.slug,
        source:            ITEM_SOURCE_MARKER,
        origin_name:       flag.origin_name ?? stub.name,
        compendium_source: flag.compendium_source ?? null,
        resolved_from:     doc.uuid,
      },
    } as DnD5eItemData["flags"],
  };

  // `effects` rides along verbatim when present (active effects make
  // many SRD items work) — it's in `rest` already; re-attach so the
  // create call gets it.
  if (Array.isArray((rest as Record<string, unknown>).effects)) {
    (data as unknown as Record<string, unknown>).effects = (rest as Record<string, unknown>).effects;
  }

  // Foundry v12+ native compendium provenance. `flags.core.sourceId`
  // is deprecated (removed in v14; console-spams under v13's
  // compatibility shim) — `_stats.compendiumSource` is the correct
  // slot. The bridge targets v13, so this is the forward-safe write.
  // Not on the DnD5eItemData type (same as `effects`); attached via
  // the established cast pattern. Foundry fills the rest of `_stats`
  // (timestamps etc.) on create.
  (data as unknown as Record<string, unknown>)._stats = {
    compendiumSource: doc.uuid,
  };

  return { data, raw, uuid: doc.uuid };
}


/** Drop the deprecated `core.sourceId` from a compendium item's
 *  inherited flags so resolved items don't reintroduce the v12
 *  deprecation. `_stats.compendiumSource` carries provenance now.
 *  Other `core.*` flags + non-core flag scopes pass through. */
function stripDeprecatedCoreSourceId(
  rawFlags: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!rawFlags) return {};
  const { core, ...otherScopes } = rawFlags as {
    core?: Record<string, unknown>;
  } & Record<string, unknown>;
  if (!core) return { ...otherScopes };
  const { sourceId: _droppedSourceId, ...coreRest } = core;
  return Object.keys(coreRest).length > 0
    ? { ...otherScopes, core: coreRest }
    : { ...otherScopes };
}


// ─── World Items-folder library copy (best-effort, idempotent) ─────────────

async function copyToItemsFolder(
  raw:      Record<string, unknown>,
  uuid:     string,
  stub:     DnD5eItemData,
  folderId: string,
): Promise<void> {
  // Idempotent: skip if an Item already carries this compendium
  // source UUID (we copied it on a prior import of any actor).
  const already = game.items.find(
    (d) => d.getFlag(MODULE_ID, "resolved_from") === uuid,
  );
  if (already) return;

  const {
    _id: _i, _stats: _s, ownership: _o, ...clean
  } = raw as Record<string, unknown>;

  try {
    await Item.create({
      ...clean,
      folder: folderId,
      // v12+ native provenance (not the deprecated core.sourceId).
      _stats: { compendiumSource: uuid },
      flags: {
        ...stripDeprecatedCoreSourceId(clean.flags as Record<string, unknown> | undefined),
        [MODULE_ID]: {
          slug:          stub.flags[MODULE_ID].slug,
          source:        ITEM_SOURCE_MARKER,
          resolved_from: uuid,
        },
      },
    });
    log.debug(`compendium-resolve: copied ${uuid} into the Items library folder`);
  } catch (e) {
    log.warn(`compendium-resolve: Items-folder copy of ${uuid} failed (non-fatal)`, e);
  }
}


// ─── Name normalisation ────────────────────────────────────────────────────

/**
 * Normalise an item name for exact matching: trim, lowercase,
 * collapse internal whitespace, drop surrounding quotes. Deliberately
 * does NOT strip suffixes like "+1" or "(Elowen Tristane)" — exact
 * match only at v1 so we never resolve "Dagger" to "Dagger +1"
 * (fuzzy is a documented follow-up). The `(actor)` decoration is
 * sidestepped by matching on `origin_name`, not the display name.
 */
export function normaliseName(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}
