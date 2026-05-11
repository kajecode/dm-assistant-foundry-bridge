/**
 * Thin wrapper around `marked` for rendering dm-assistant section
 * markdown into HTML for Foundry's actor biography pane.
 *
 * Configuration:
 *
 * - `gfm: true` — GitHub-Flavored Markdown. dm-assistant's section
 *   bodies use `- foo` lists and the occasional `**bold**`; gfm
 *   handles both.
 * - `breaks: false` — single newlines stay as soft breaks, NOT
 *   `<br>`. Foundry's biography renderer behaves better when we
 *   emit semantic paragraphs / lists rather than line-by-line
 *   `<br>` salad.
 *
 * Sanitisation: we pre-escape `<` / `>` / `&` in the input before
 * handing it to marked. This costs the rare `<https://...>` autolink
 * form (dm-assistant doesn't emit those), but guarantees that any
 * literal HTML in the LLM output renders as text rather than DOM.
 * Foundry's actor-sheet biography pane renders HTML via innerHTML;
 * an unescaped `<script>` from a hallucinated generation would
 * execute. Pre-escape is the simplest bulletproof defence.
 */

import { Marked } from "marked";

const marked = new Marked({
  gfm:    true,
  breaks: false,
});

const HTML_ESCAPE_RE = /[<>&]/g;
const HTML_ESCAPE_MAP: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
};

function escapeHtml(s: string): string {
  return s.replace(HTML_ESCAPE_RE, (c) => HTML_ESCAPE_MAP[c] ?? c);
}

/**
 * Render markdown → HTML. Returns the rendered string trimmed of
 * surrounding whitespace. Empty input → empty string.
 *
 * Sync interface even though marked's `parse` returns `string |
 * Promise<string>`: when no async extensions are registered (our
 * case) the result is always sync. We cast explicitly so callers
 * don't have to await.
 */
export function renderMarkdown(md: string): string {
  if (!md || !md.trim()) return "";
  const escaped = escapeHtml(md);
  const html = marked.parse(escaped) as string;
  return html.trim();
}
