/**
 * Foundry folder management for kind-aware import placement.
 *
 * The bridge groups imported documents into per-kind sub-folders
 * under a user-configurable prefix (see `SETTING.folderPrefix`):
 *
 *   <prefix> — NPCs               (Actor folder)
 *   <prefix> — Creatures          (Actor folder)
 *   <prefix> — NPC DM Notes       (JournalEntry folder)
 *   <prefix> — Creature DM Notes  (JournalEntry folder)
 *   <prefix> — Shops              (JournalEntry folder; S6-bridge)
 *   <prefix> — Locations          (JournalEntry folder; S7-bridge)
 *   <prefix> — Factions           (JournalEntry folder; future)
 *
 * Find-or-create is idempotent — calling resolve*FolderId twice
 * with the same args returns the same folder ID on the second call
 * (no duplicate created). Lookup happens on every import, not at
 * module init, so operators who never import don't get a folder
 * tree polluted with empty placeholders.
 *
 * Foundry's `Folder` document is per-document-type — Actor folders
 * and JournalEntry folders are distinct sidebar trees, even when
 * they share a name. The `type` field on `Folder.create()` controls
 * which sidebar gets the folder.
 *
 * History: replaces the pre-v0.3.1 `actorFolder` + `journalFolder`
 * settings (bridge#24). Those were free-text inputs that the bridge
 * never actually consulted — dead UI. Operators can still rename
 * the auto-created folders in Foundry after the fact if they want
 * a different layout.
 */

import type { ActorKind } from "../api/types.js";
import { SETTING } from "../settings/keys.js";
import { getSetting } from "../settings/register.js";
import { log } from "../lib/log.js";

/**
 * Minimal contract over Foundry's `Folder` document. Only the bits
 * we touch — name, type, id. Other Folder methods (depth, children,
 * sorting) aren't used here.
 */
interface FoundryFolderLike {
  id:   string;
  name: string;
  type: string;
}

interface FoundryFolderClass {
  create: (
    data: { name: string; type: string; folder?: string | null },
  ) => Promise<FoundryFolderLike | null>;
}

declare const Folder: FoundryFolderClass;

declare const game: {
  folders: {
    find: (predicate: (f: FoundryFolderLike) => boolean) => FoundryFolderLike | undefined;
  };
};

/** Document types that Foundry exposes a folder sidebar for. Only
 *  the three the bridge cares about today. */
export type FolderDocType = "Actor" | "JournalEntry" | "Item";

/** Role of the imported document — distinguishes between the main
 *  actor / journal and its companion DM-notes journal so the folder
 *  picker routes them to sibling folders rather than mixing them. */
export type FolderRole = "actor" | "dm-notes";

const DEFAULT_PREFIX = "DM Assistant";

/** Per-(kind, role) label slug used after the prefix separator.
 *  Keep this dict the single source of truth — adding a new kind
 *  means one entry here plus the consumer in importActor (or
 *  wherever the new orchestrator lives). */
const KIND_TO_LABEL: Record<string, string> = {
  "npc:actor":         "NPCs",
  "creature:actor":    "Creatures",
  "npc:dm-notes":      "NPC DM Notes",
  "creature:dm-notes": "Creature DM Notes",
  // Forward-compat — kinds added in v0.4.x onward:
  "shop:journal":      "Shops",
  "location:journal":  "Locations",
  "faction:journal":   "Factions",
};

/** Resolve the configured folder prefix. Empty / whitespace-only
 *  values fall back to the default so a freshly-cleared input
 *  doesn't produce folder names like " — NPCs". */
function getPrefix(): string {
  const setting = getSetting<string>(SETTING.folderPrefix);
  return setting && setting.length > 0 ? setting : DEFAULT_PREFIX;
}

/**
 * Compose the Foundry folder name for a given (kind, role) pair.
 * Exported for tests + for callers that want to render the name in
 * a UI (e.g. a "where will this land?" hint in the import picker).
 */
export function folderNameFor(entityKind: string, role: FolderRole | "journal"): string {
  const prefix = getPrefix();
  const label  = KIND_TO_LABEL[`${entityKind}:${role}`];
  if (label === undefined) {
    log.warn(
      `folderNameFor: unknown (kind=${entityKind}, role=${role}); falling back to "Other"`,
    );
    return `${prefix} — Other`;
  }
  return `${prefix} — ${label}`;
}

/**
 * Find an existing folder by (name, type), or create it. Returns
 * the folder's ID — the value Foundry's `Actor.create({ folder })`
 * and `JournalEntry.create({ folder })` expect.
 *
 * Throws if `Folder.create` returns null (rare; usually an
 * orchestrator-side problem we want to surface, not swallow).
 */
export async function findOrCreateFolder(
  name: string,
  type: FolderDocType,
): Promise<string> {
  const existing = game.folders.find((f) => f.name === name && f.type === type);
  if (existing) return existing.id;
  const created = await Folder.create({ name, type, folder: null });
  if (!created) {
    throw new Error(`Folder.create returned null for "${name}" (${type})`);
  }
  log.info("created Foundry folder", `"${name}"`, `(${type})`);
  return created.id;
}

/**
 * Resolve the Actor-folder ID for a given dm-assistant entity kind.
 * Used by `importActor` to place imported actors. Both NPCs and
 * Creatures are Foundry Actor documents (dnd5e uses the same
 * Actor type for monsters as for NPCs).
 */
export async function resolveActorFolderId(entityKind: ActorKind): Promise<string> {
  return findOrCreateFolder(folderNameFor(entityKind, "actor"), "Actor");
}

/**
 * Resolve the JournalEntry-folder ID for a given dm-assistant
 * entity kind's companion DM-notes journal. Sibling-folder design
 * (rather than co-located with the actor) keeps the actor folders
 * clean — the DM browses them to drag tokens to a scene; not the
 * place for prose notes.
 */
export async function resolveDmNotesFolderId(entityKind: ActorKind): Promise<string> {
  return findOrCreateFolder(folderNameFor(entityKind, "dm-notes"), "JournalEntry");
}

/**
 * Resolve the JournalEntry-folder ID for a shop / location / faction
 * import. Each gets its own `<prefix> — Shops` / `<prefix> — Locations`
 * folder so the DM's Journal sidebar stays browseable by kind. Label
 * vocab was pre-wired in v0.3.1's `KIND_TO_LABEL`; this helper just
 * threads the "journal" role through.
 */
export async function resolveJournalFolderId(
  entityKind: "shop" | "location" | "faction",
): Promise<string> {
  return findOrCreateFolder(folderNameFor(entityKind, "journal"), "JournalEntry");
}

/**
 * Resolve the Item-folder ID for compendium-resolved items (#32).
 * `<prefix> — Items` is a browsable world library of the fully-
 * statted compendium documents the resolver copied in. Distinct
 * sidebar tree from Actor / JournalEntry folders.
 */
export async function resolveItemsFolderId(): Promise<string> {
  return findOrCreateFolder(`${getPrefix()} — Items`, "Item");
}

// Test-only hook: lets unit tests inject fake `game.folders` +
// `Folder` globals without monkey-patching the production module.
// Not part of the runtime API.
export const _internalForTests = {
  getPrefix,
  KIND_TO_LABEL,
  DEFAULT_PREFIX,
};
