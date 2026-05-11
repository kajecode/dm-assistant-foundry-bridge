/**
 * Pins the rendering behaviour of the marked wrapper.
 *
 * dm-assistant's NPC sections use a handful of markdown features
 * (paragraphs, lists, bold, italic, the occasional link); these
 * cases lock in what each translates to so future marked upgrades
 * can't silently change biography rendering.
 */

import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/lib/markdown.js";

describe("renderMarkdown", () => {
  it("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n\n  ")).toBe("");
  });

  it("wraps a single paragraph in <p>", () => {
    expect(renderMarkdown("Aldric is a blacksmith.")).toBe("<p>Aldric is a blacksmith.</p>");
  });

  it("renders bullet lists", () => {
    const html = renderMarkdown("- One\n- Two\n- Three");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>One</li>");
    expect(html).toContain("<li>Two</li>");
    expect(html).toContain("<li>Three</li>");
  });

  it("renders bold + italic inline", () => {
    expect(renderMarkdown("This is **bold** and *italic*.")).toContain("<strong>bold</strong>");
    expect(renderMarkdown("This is **bold** and *italic*.")).toContain("<em>italic</em>");
  });

  it("escapes literal HTML to text — no script injection from the LLM", () => {
    const html = renderMarkdown("<script>alert(1)</script>plain text");
    expect(html).not.toContain("<script>");
    // The escaped form should appear as text content.
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders multiple paragraphs separated by blank lines", () => {
    const html = renderMarkdown("First paragraph.\n\nSecond paragraph.");
    expect(html).toContain("<p>First paragraph.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
  });

  it("preserves links", () => {
    const html = renderMarkdown("Visit [Saltmarsh](https://example/saltmarsh).");
    expect(html).toContain('href="https://example/saltmarsh"');
    expect(html).toContain(">Saltmarsh</a>");
  });
});
