/**
 * Tests for `src/translators/common/buildJournalData.ts` (#25 / #26).
 *
 * Pure-data translator tests — no Foundry runtime. Pins the page
 * structure, metadata-header rendering, flag-kind discriminant,
 * and per-kind divergences (proprietor cross-link vs related-entity
 * cross-links).
 */

import { describe, expect, it } from "vitest";
import { buildJournalBundle, MODULE_ID } from "../src/translators/common/buildJournalData.js";
import type {
  FoundryLocationResponse,
  FoundryShopResponse,
} from "../src/api/types.js";


// ── Shared fixtures ─────────────────────────────────────────────────────────


const SHOP: FoundryShopResponse = {
  slug:                    "the-crooked-hammer",
  kind:                    "shop",
  name:                    "The Crooked Hammer",
  display_name:            "The Crooked Hammer",
  proprietor_slug:         "aldric-harwick",
  establishment_image_url: "/api/shop-generate/image/the-crooked-hammer?campaign_id=c",
  establishment_thumb_url: "/api/shop-generate/image/the-crooked-hammer/thumb?campaign_id=c",
  front_matter:            {
    shop_type: "blacksmith",
    region:    "Brawnshire",
  },
  sections: [
    { name: "Shop Name & Type",         body_md: "The Crooked Hammer — blacksmith." },
    { name: "Atmosphere & Description", body_md: "Soot-stained walls; the bellows wheeze." },
  ],
  dm_sections: [
    { name: "Shop's Secret", body_md: "Aldric owes the cult three salt-iron blades." },
  ],
  audit: {
    source_path: "data/c/documents/dm/shop_the-crooked-hammer.md",
    modified_at: "2026-05-13T07:00:00+00:00",
  },
};

const LOCATION: FoundryLocationResponse = {
  slug:           "the-salt-vault",
  kind:           "location",
  name:           "The Salt Vault",
  display_name:   "The Salt Vault",
  map_image_url:  "/api/location-generate/image/the-salt-vault?campaign_id=c",
  map_thumb_url:  "/api/location-generate/image/the-salt-vault/thumb?campaign_id=c",
  front_matter:   {
    region:           "Brawnshire",
    area:             "Forge Row",
    related_npcs:     ["aldric-harwick", "mira-stoneveil"],
    related_shops:    ["the-crooked-hammer"],
    related_locations: [],
  },
  sections: [
    { name: "Overview",  body_md: "A vaulted cellar." },
    { name: "Layout",    body_md: "Three barrel rooms." },
  ],
  dm_sections: [
    { name: "Secrets & Hidden Features", body_md: "Cult shrine behind the third door." },
    { name: "Adventure Hooks",           body_md: "- Quartermaster visits at midnight." },
  ],
  audit: {
    source_path: "data/c/documents/dm/location_the-salt-vault.md",
    modified_at: "2026-05-13T07:00:00+00:00",
  },
};


// ── Shop ────────────────────────────────────────────────────────────────────


describe("buildJournalBundle — shop", () => {
  const opts = { campaignId: "c", contractVersion: "0.3.0" };

  it("produces a journal with one page per public + DM section, in order", () => {
    const bundle = buildJournalBundle(SHOP, opts);
    const names  = bundle.pages.map((p) => p.name);
    expect(names).toEqual([
      "Shop Name & Type",         // sections[0]
      "Atmosphere & Description", // sections[1]
      "Shop's Secret",            // dm_sections[0]
    ]);
  });

  it("renders the metadata header on the first public page only", () => {
    const bundle  = buildJournalBundle(SHOP, opts);
    const page1   = bundle.pages[0]?.text.content ?? "";
    const page2   = bundle.pages[1]?.text.content ?? "";
    expect(page1).toContain("<strong>Type:</strong> blacksmith");
    expect(page1).toContain("<strong>Region:</strong> Brawnshire");
    expect(page2).not.toContain("<strong>Type:</strong>");
  });

  it("emits the proprietor cross-link with @UUID placeholder + slug-hint comment", () => {
    const bundle = buildJournalBundle(SHOP, opts);
    const page1  = bundle.pages[0]?.text.content ?? "";
    // Forward-compat: when bridge sees this and the actor is
    // imported, a future resolution sweep can patch the placeholder
    // into a real UUID. v1 surfaces the slug.
    expect(page1).toContain("@UUID[Actor.aldric-harwick]");
    expect(page1).toContain("bridge: actor pending");
    expect(page1).toContain("slug=aldric-harwick");
  });

  it("omits the proprietor block when proprietor_slug is null", () => {
    const noProprietor: FoundryShopResponse = { ...SHOP, proprietor_slug: null };
    const bundle = buildJournalBundle(noProprietor, opts);
    const page1  = bundle.pages[0]?.text.content ?? "";
    expect(page1).not.toContain("Proprietor:");
    expect(page1).not.toContain("@UUID[Actor.");
  });

  it("stamps shop-journal drift-tracking flags", () => {
    const bundle = buildJournalBundle(SHOP, opts);
    const flags  = bundle.flags[MODULE_ID];
    expect(flags.slug).toBe("the-crooked-hammer");
    expect(flags.campaign_id).toBe("c");
    expect(flags.kind).toBe("shop-journal");
    expect(flags.api_contract_version).toBe("0.3.0");
    expect(flags.source_path).toContain("shop_the-crooked-hammer.md");
  });

  it("HTML-escapes front-matter strings to defend against generator output", () => {
    const escaped: FoundryShopResponse = {
      ...SHOP,
      front_matter: { shop_type: "<script>alert('x')</script>", region: "" },
    };
    const bundle = buildJournalBundle(escaped, opts);
    const page1  = bundle.pages[0]?.text.content ?? "";
    expect(page1).toContain("&lt;script&gt;");
    expect(page1).not.toContain("<script>");
  });

  it("leaves img null pre-upload — orchestrator sets it via withJournalImage", () => {
    const bundle = buildJournalBundle(SHOP, opts);
    expect(bundle.img).toBeNull();
  });
});


// ── Location ────────────────────────────────────────────────────────────────


describe("buildJournalBundle — location", () => {
  const opts = { campaignId: "c", contractVersion: "0.3.0" };

  it("orders pages public-first, dm-second, per response", () => {
    const bundle = buildJournalBundle(LOCATION, opts);
    const names  = bundle.pages.map((p) => p.name);
    expect(names).toEqual([
      "Overview",
      "Layout",
      "Secrets & Hidden Features",
      "Adventure Hooks",
    ]);
  });

  it("renders region + area + related cross-links in metadata header", () => {
    const bundle = buildJournalBundle(LOCATION, opts);
    const page1  = bundle.pages[0]?.text.content ?? "";
    expect(page1).toContain("<strong>Region:</strong> Brawnshire");
    expect(page1).toContain("<strong>Area:</strong> Forge Row");
    // related_npcs: rendered as Actor @UUID links with slug-hint comments.
    expect(page1).toContain("@UUID[Actor.aldric-harwick]");
    expect(page1).toContain("@UUID[Actor.mira-stoneveil]");
    // related_shops: rendered as JournalEntry @UUID links.
    expect(page1).toContain("@UUID[JournalEntry.the-crooked-hammer]");
  });

  it("omits the related-shops line when the array is empty", () => {
    const noRelated: FoundryLocationResponse = {
      ...LOCATION,
      front_matter: { region: "Brawnshire" },
    };
    const bundle = buildJournalBundle(noRelated, opts);
    const page1  = bundle.pages[0]?.text.content ?? "";
    expect(page1).toContain("Region:");
    expect(page1).not.toContain("NPCs:");
    expect(page1).not.toContain("Shops:");
  });

  it("filters non-string entries out of related_* arrays", () => {
    // Defensive — if a malformed front-matter has a non-string slug,
    // we skip it rather than render `[object Object]` into the body.
    const messy: FoundryLocationResponse = {
      ...LOCATION,
      front_matter: {
        related_npcs: ["valid-slug", 42, { not: "a slug" }, "another-valid"],
      },
    };
    const bundle = buildJournalBundle(messy, opts);
    const page1  = bundle.pages[0]?.text.content ?? "";
    expect(page1).toContain("@UUID[Actor.valid-slug]");
    expect(page1).toContain("@UUID[Actor.another-valid]");
    expect(page1).not.toContain("[object Object]");
    expect(page1).not.toContain("42");
  });

  it("stamps location-journal drift-tracking flags", () => {
    const bundle = buildJournalBundle(LOCATION, opts);
    expect(bundle.flags[MODULE_ID].kind).toBe("location-journal");
  });
});
