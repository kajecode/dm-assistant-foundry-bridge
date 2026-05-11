/**
 * Builds the GM-locked companion JournalEntry's pages from the
 * `dm_sections` array on a `/foundry/npc/{slug}` response.
 *
 * Each DM-only section becomes one `JournalEntryPage` of type `text`
 * with the rendered HTML on `text.content`. Foundry expects:
 *
 *   { name, type: "text", text: { content, format: 1 } }
 *
 * `format: 1` = HTML; `format: 2` would be markdown if Foundry
 * shipped a renderer, but it doesn't — we pre-render to HTML.
 *
 * The companion journal itself (folder / ownership / flags) is
 * assembled in `buildActorData` alongside the actor data; this file
 * only handles the page-level shape.
 */

import type { FoundryNpcResponse } from "../../api/types.js";
import { renderMarkdown } from "../../lib/markdown.js";

export interface JournalPageData {
  name: string;
  type: "text";
  text: {
    content: string;
    format:  1;     // HTML — see module docstring
  };
}

export function buildDmJournalPages(payload: FoundryNpcResponse): JournalPageData[] {
  return payload.dm_sections.map((section) => ({
    name: section.name,
    type: "text",
    text: {
      content: renderMarkdown(section.body_md),
      format:  1,
    },
  }));
}
