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
  FoundryFactionResponse,
  FoundryLocationResponse,
  FoundryLoreResponse,
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


// ── Faction (#506 / S10b) ───────────────────────────────────────────────────

const FACTION: FoundryFactionResponse = {
  slug:         "the-elder-eye-cult",
  kind:         "faction",
  name:         "The Elder Eye Cult",
  display_name: "The Elder Eye Cult",
  image_url:    "/api/faction-generate/image/the-elder-eye-cult?campaign_id=c",
  thumb_url:    "/api/faction-generate/image/the-elder-eye-cult/thumb?campaign_id=c",
  front_matter: {
    region:            "Brawnshire",
    related_npcs:      ["aldric-harwick", "mira-stoneveil"],
    related_factions:  ["the-salt-guild"],
    related_locations: ["the-salt-vault"],
  },
  sections: [
    { name: "Charter",      body_md: "A subterranean order." },
    { name: "Public Goals", body_md: "Restore the salt-guild monopoly." },
  ],
  dm_sections: [
    { name: "Plot Hooks",        body_md: "- The quartermaster launders ash-iron." },
    { name: "Suppressed Truths", body_md: "Something sealed behind the third door." },
  ],
  audit: {
    source_path: "data/c/documents/dm/faction_the-elder-eye-cult.md",
    modified_at: "2026-05-16T07:00:00+00:00",
  },
};

describe("buildJournalBundle — faction (#506)", () => {
  const opts = { campaignId: "c", contractVersion: "0.6.0" };

  it("one page per public + DM section, in response order", () => {
    const bundle = buildJournalBundle(FACTION, opts);
    expect(bundle.pages.map((p) => p.name)).toEqual([
      "Charter", "Public Goals", "Plot Hooks", "Suppressed Truths",
    ]);
  });

  it("flag-kind discriminant is faction-journal", () => {
    const bundle = buildJournalBundle(FACTION, opts);
    expect(bundle.flags[MODULE_ID].kind).toBe("faction-journal");
  });

  it("metadata header surfaces region + member/allied/holding cross-links", () => {
    const bundle = buildJournalBundle(FACTION, opts);
    const page1  = bundle.pages[0]!.text.content;
    expect(page1).toContain("<strong>Region:</strong> Brawnshire");
    expect(page1).toContain("Actor.aldric-harwick");        // members
    expect(page1).toContain("JournalEntry.the-salt-guild"); // allied factions
    expect(page1).toContain("JournalEntry.the-salt-vault"); // holdings
  });

  it("no region/refs → no metadata header paragraph", () => {
    const bare: FoundryFactionResponse = { ...FACTION, front_matter: {} };
    const bundle = buildJournalBundle(bare, opts);
    expect(bundle.pages[0]!.text.content).not.toContain("<strong>Region:</strong>");
  });
});


// ── Lore (#507 — player-readable, no DM split, imageless) ───────────────────

const LORE: FoundryLoreResponse = {
  slug:           "the-tide-below",
  kind:           "lore",
  name:           "The Tide-Below",
  display_name:   "The Tide-Below",
  image_url:      null,
  thumb_url:      null,
  player_visible: true,
  front_matter:   { type: "lore" },
  sections: [
    { name: "Overview",   body_md: "A slow subterranean sea." },
    { name: "Plot Hooks", body_md: "The fenfolk pay in pearls." },
  ],
  dm_sections: [],   // lore has no DM split — server guarantees []
  audit: {
    source_path: "data/c/documents/shared/lore_the-tide-below.md",
    modified_at: "2026-05-16T07:00:00+00:00",
  },
};

describe("buildJournalBundle — lore (#507)", () => {
  const opts = { campaignId: "c", contractVersion: "0.7.0" };

  it("is player-READABLE (ownership default 2 = OBSERVER)", () => {
    const bundle = buildJournalBundle(LORE, opts);
    expect(bundle.ownership).toEqual({ default: 2 });
  });

  it("GM-locked kinds stay ownership 0 (regression guard)", () => {
    expect(buildJournalBundle(FACTION, opts).ownership).toEqual({ default: 0 });
    expect(buildJournalBundle(SHOP, opts).ownership).toEqual({ default: 0 });
  });

  it("one page per section, all public (dm_sections is [])", () => {
    const bundle = buildJournalBundle(LORE, opts);
    expect(bundle.pages.map((p) => p.name)).toEqual(["Overview", "Plot Hooks"]);
  });

  it("no metadata header — Page 1 is just the body prose", () => {
    const bundle = buildJournalBundle(LORE, opts);
    const page1  = bundle.pages[0]!.text.content;
    expect(page1).not.toContain("<strong>Region:</strong>");
    expect(page1).not.toContain("@UUID[");
  });

  it("flag-kind discriminant is lore-journal", () => {
    const bundle = buildJournalBundle(LORE, opts);
    expect(bundle.flags[MODULE_ID].kind).toBe("lore-journal");
  });

  it("only lore gets player-read — defends the player_visible gate", () => {
    const notVisible: FoundryLoreResponse = { ...LORE, player_visible: false };
    // Belt-and-suspenders: if the server ever sent player_visible:false
    // for a lore doc, fall back to GM-locked rather than leak.
    expect(buildJournalBundle(notVisible, opts).ownership).toEqual({ default: 0 });
  });
});
