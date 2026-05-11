/**
 * Builds the HTML payload for an actor's
 * `system.details.biography.value` (and `.public`) from the public
 * sections returned by `/foundry/npc/{slug}`.
 *
 * Layout:
 *   [lead]   <p><strong>Race:</strong> X · <strong>Occupation:</strong> Y</p>
 *   [section]  <h2>{section.name}</h2>{rendered body_md}
 *   [section]  <h2>{section.name}</h2>{rendered body_md}
 *
 * The lead paragraph is the v1 prose-fallback for the structured
 * fields deferred to S9 (race / occupation move to dnd5e 4.x Item
 * embeds in S9; for v1 they go in the prose so the data isn't lost).
 *
 * If `front_matter` has neither `race` nor `occupation`, the lead is
 * skipped — no need for an empty `<p>`.
 *
 * Section order: preserved verbatim from the response. dm-assistant
 * generates sections in a deterministic order; we don't reorder.
 */

import type { FoundryNpcResponse, FoundrySection } from "../../api/types.js";
import { renderMarkdown } from "../../lib/markdown.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface LeadFields {
  race?:       string;
  occupation?: string;
}

function pickLeadFields(fm: Record<string, unknown>): LeadFields {
  const race       = typeof fm.race       === "string" ? fm.race       : undefined;
  const occupation = typeof fm.occupation === "string" ? fm.occupation : undefined;
  return { race, occupation };
}

function renderLead(fm: Record<string, unknown>): string {
  const { race, occupation } = pickLeadFields(fm);
  if (!race && !occupation) return "";
  const parts: string[] = [];
  if (race)       parts.push(`<strong>Race:</strong> ${escapeHtml(race)}`);
  if (occupation) parts.push(`<strong>Occupation:</strong> ${escapeHtml(occupation)}`);
  return `<p>${parts.join(" · ")}</p>`;
}

function renderSection(s: FoundrySection): string {
  const heading = `<h2>${escapeHtml(s.name)}</h2>`;
  const body    = renderMarkdown(s.body_md);
  return body ? `${heading}\n${body}` : heading;
}

/**
 * Concatenate public sections + the lead paragraph into the final
 * biography HTML. Returns the string verbatim ready to be assigned
 * to `system.details.biography.value`.
 */
export function buildBiographyHtml(payload: FoundryNpcResponse): string {
  const blocks: string[] = [];
  const lead = renderLead(payload.front_matter);
  if (lead) blocks.push(lead);
  for (const section of payload.sections) {
    blocks.push(renderSection(section));
  }
  return blocks.join("\n");
}
