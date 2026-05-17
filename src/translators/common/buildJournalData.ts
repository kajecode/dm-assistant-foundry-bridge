/**
 * Translates a `/foundry/shop/{slug}` or `/foundry/location/{slug}`
 * payload into the Foundry document-data object needed to create or
 * overwrite a JournalEntry (#25 / #26 — bridge v0.4.0).
 *
 * Unified shop + location translator. The two kinds share enough of
 * the journal-page layout that a single builder handles both with a
 * small discriminated-union branch:
 *
 *   - Shop:      hero = `establishment_image_url`; carries
 *                `proprietor_slug` cross-link; routes via
 *                `_SHOP_DM_SECTION_HEADINGS` server-side
 *   - Location:  hero = `map_image_url`; carries `related_*`
 *                cross-links inside `front_matter`; routes via
 *                `_LOCATION_DM_SECTION_HEADINGS` server-side
 *
 * The bridge translates `sections[]` into public-ownership pages
 * and `dm_sections[]` into per-page-DM-locked pages. Foundry's
 * permission inheritance lets the GM grant Observer at the journal
 * level for player-visible browsing while keeping DM pages locked.
 *
 * Pure data — no Foundry runtime calls. Image upload happens in the
 * orchestrator after this builder; the caller threads the resulting
 * `img` path into the returned import data via `withJournalImage()`.
 */

import type {
  FoundryFactionResponse,
  FoundryJournalResponse,
  FoundryLocationResponse,
  FoundryShopResponse,
  JournalKind,
} from "../../api/types.js";
import { renderMarkdown } from "../../lib/markdown.js";
import type { JournalPageData } from "./buildJournalPages.js";

import { flagKindFor, MODULE_ID, type BridgeFlags, type JournalImportData } from "./buildActorData.js";

export { MODULE_ID } from "./buildActorData.js";

// Re-export for consumers that want to construct an import bundle.
export type { JournalImportData, BridgeFlags };

/** Map a journal kind to the bridge's flag-kind discriminant.
 *  Thin convenience around the shared `flagKindFor()` so callers
 *  don't have to thread the `"journal"` role string. */
export function flagKindForJournal(entityKind: JournalKind) {
  return flagKindFor(entityKind, "journal");
}


export interface BuildJournalOptions {
  campaignId:        string;
  contractVersion?:  string;
}


/**
 * Build a JournalEntry document from a shop or location payload.
 * The discriminated union on `payload.kind` selects the
 * kind-specific rendering (proprietor cross-link header for
 * shops; related-entity links + region/area badges for locations).
 */
export function buildJournalBundle(
  payload: FoundryJournalResponse,
  opts:    BuildJournalOptions,
): JournalImportData {
  const flags: BridgeFlags = {
    slug:                 payload.slug,
    campaign_id:          opts.campaignId,
    source_path:          payload.audit.source_path,
    modified_at:          payload.audit.modified_at,
    api_contract_version: opts.contractVersion,
    kind:                 flagKindForJournal(payload.kind),
  };

  // Hero-page metadata block — front-matter passthrough rendered
  // as a short HTML paragraph at the top of Page 1. Per-kind
  // content (shop type, proprietor cross-link vs location region,
  // related entities).
  const metadataHtml = renderMetadataHeader(payload);
  const pages        = buildPages(payload, metadataHtml);

  // #507 — lore is player-facing world reference: create it
  // player-READABLE (OBSERVER = 2). Every other journal kind is
  // GM-only (default 0). Driven off the payload's player_visible
  // signal so the policy lives server-side.
  const playerReadable =
    payload.kind === "lore" && payload.player_visible === true;

  return {
    name:      payload.display_name || payload.name || payload.slug,
    img:       null,    // orchestrator overwrites after FilePicker upload
    pages,
    ownership: { default: playerReadable ? 2 : 0 },
    flags: {
      [MODULE_ID]: flags,
    },
  };
}


/** Render the per-kind "header" HTML that sits above Page 1's body
 *  prose. Surfaces the dissem-set front-matter (shop_type / region
 *  for shops; region / area / related_* for locations) plus the
 *  shop's proprietor cross-link. */
function renderMetadataHeader(payload: FoundryJournalResponse): string {
  const lines: string[] = [];
  if (payload.kind === "shop") {
    appendShopMetadata(payload, lines);
  } else if (payload.kind === "faction") {
    appendFactionMetadata(payload, lines);
  } else if (payload.kind === "lore") {
    // Lore has no metadata header — it's pure reference prose, no
    // region/owner/related badges. Page 1 is just the body.
  } else {
    appendLocationMetadata(payload, lines);
  }
  return lines.length > 0 ? `<p>${lines.join(" · ")}</p>\n` : "";
}


/** Faction metadata header (#506). Region badge + related-entity
 *  cross-links (member NPCs, allied factions). Mirrors the location
 *  appender's passthrough approach — a structured membership graph
 *  is a deliberate follow-up, not v1. */
function appendFactionMetadata(payload: FoundryFactionResponse, lines: string[]): void {
  const fm = payload.front_matter;
  if (typeof fm.region === "string") {
    lines.push(`<strong>Region:</strong> ${escapeHtml(fm.region)}`);
  }
  appendRelatedRef(fm.related_npcs,     "Members",  "Actor",        lines);
  appendRelatedRef(fm.related_factions, "Allied",   "JournalEntry", lines);
  appendRelatedRef(fm.related_locations, "Holdings", "JournalEntry", lines);
}


function appendShopMetadata(payload: FoundryShopResponse, lines: string[]): void {
  const fm = payload.front_matter;
  if (typeof fm.shop_type === "string") {
    lines.push(`<strong>Type:</strong> ${escapeHtml(fm.shop_type)}`);
  }
  if (typeof fm.region === "string") {
    lines.push(`<strong>Region:</strong> ${escapeHtml(fm.region)}`);
  }
  // Proprietor cross-link. When the proprietor is imported as a
  // Foundry actor, the bridge upgrades this placeholder to a
  // proper `@UUID[Actor.{id}]{Name}` link at journal-render time —
  // for v1 we surface the slug + a placeholder marker so a future
  // re-resolution sweep can patch it.
  if (payload.proprietor_slug) {
    lines.push(
      `<strong>Proprietor:</strong> ` +
      `<em>@UUID[Actor.${escapeHtml(payload.proprietor_slug)}]</em> ` +
      `<!-- bridge: actor pending; slug=${escapeHtml(payload.proprietor_slug)} -->`,
    );
  }
}


function appendLocationMetadata(payload: FoundryLocationResponse, lines: string[]): void {
  const fm = payload.front_matter;
  if (typeof fm.region === "string") {
    lines.push(`<strong>Region:</strong> ${escapeHtml(fm.region)}`);
  }
  if (typeof fm.area === "string") {
    lines.push(`<strong>Area:</strong> ${escapeHtml(fm.area)}`);
  }
  appendRelatedRef(fm.related_npcs,      "NPCs",      "Actor",       lines);
  appendRelatedRef(fm.related_shops,     "Shops",     "JournalEntry", lines);
  appendRelatedRef(fm.related_locations, "Locations", "JournalEntry", lines);
}


function appendRelatedRef(
  value:        unknown,
  label:        string,
  foundryType:  "Actor" | "JournalEntry",
  lines:        string[],
): void {
  if (!Array.isArray(value) || value.length === 0) return;
  const slugs = value.filter((v): v is string => typeof v === "string");
  if (slugs.length === 0) return;
  const links = slugs.map(
    (s) =>
      `<em>@UUID[${foundryType}.${escapeHtml(s)}]</em> ` +
      `<!-- bridge: ${foundryType.toLowerCase()} pending; slug=${escapeHtml(s)} -->`,
  );
  lines.push(`<strong>${label}:</strong> ${links.join(", ")}`);
}


/** Compose the page list: public sections first (each its own page;
 *  Page 1 gets the metadata-header prefix), then DM-only sections
 *  (each with ownership locked to GM). */
function buildPages(
  payload:      FoundryJournalResponse,
  metadataHtml: string,
): JournalPageData[] {
  // Foundry orders embedded pages by their `sort` field; today's
  // `JournalPageData` shape doesn't surface it (Foundry assigns
  // monotonically-increasing defaults on createEmbeddedDocuments).
  // We rely on response order being canonical — the picker UI
  // doesn't expose per-page reordering, and the dm-assistant
  // generator emits sections in a deliberate sequence. If a future
  // requirement needs explicit sort keys, add a `sort` field to
  // JournalPageData and number them here (start 100000, +100 each).
  const pages: JournalPageData[] = [];

  payload.sections.forEach((section, idx) => {
    // First public page carries the metadata-header prefix.
    const prefix = idx === 0 ? metadataHtml : "";
    pages.push({
      name: section.name,
      type: "text",
      text: {
        content: prefix + renderMarkdown(section.body_md),
        format:  1,
      },
    });
  });

  payload.dm_sections.forEach((section) => {
    pages.push({
      name: section.name,
      type: "text",
      text: {
        content: renderMarkdown(section.body_md),
        format:  1,
      },
    });
  });

  return pages;
}


/** Tiny HTML escape — only for cross-link slugs and front-matter
 *  string fields. Renderer handles the markdown body separately. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


/** Splice the uploaded image path into the import data. Orchestrator
 *  calls this after FilePicker upload (same pattern as the actor's
 *  `withImagePaths`). */
export function withJournalImage(
  data:    JournalImportData,
  imgPath: string | null,
): JournalImportData {
  return {
    ...data,
    img: imgPath ?? "icons/svg/book.svg",
  };
}
