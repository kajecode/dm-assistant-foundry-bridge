/**
 * Pure-data tests for the NPC payload → Foundry document translator.
 *
 * No Foundry runtime — these test the shape of the actor + companion
 * journal data the orchestrator hands to `Actor.create` /
 * `JournalEntry.create`. Three representative payloads:
 *
 *   - Full: front-matter + public sections + dm sections + image
 *   - No image: portrait_url/thumb_url null
 *   - No front-matter: race / occupation absent → no lead paragraph
 *   - No dm sections: companion journal is null
 */

import { describe, expect, it } from "vitest";
import type { FoundryNpcResponse } from "../src/api/types.js";
import {
  buildImportBundle,
  MODULE_ID,
} from "../src/translators/common/buildActorData.js";

function makePayload(overrides: Partial<FoundryNpcResponse> = {}): FoundryNpcResponse {
  const base: FoundryNpcResponse = {
    slug:         "aldric-harwick",
    kind:         "npc",
    name:         "Aldric Harwick",
    display_name: "Aldric Harwick",
    portrait_url: "/api/npc-generate/image/aldric-harwick",
    thumb_url:    "/api/npc-generate/image/aldric-harwick/thumb",
    front_matter: { race: "Human", occupation: "Blacksmith" },
    sections: [
      { name: "Appearance & Mannerisms", body_md: "Soot-streaked apron." },
      { name: "Personality & Quirks",    body_md: "- Patient with apprentices\n- Sharp with merchants" },
    ],
    dm_sections: [
      { name: "Motivation & Secret", body_md: "Owes the Elder Eye Cult three salt-iron blades." },
      { name: "Plot Hooks",          body_md: "- Apprentice Mira is the cult's plant." },
    ],
    audit: {
      source_path: "data/c/documents/dm/npc_aldric-harwick.md",
      modified_at: "2026-05-09T18:42:31+00:00",
    },
  };
  return { ...base, ...overrides };
}

describe("buildImportBundle — happy path", () => {
  const payload = makePayload();
  const bundle  = buildImportBundle(payload, {
    campaignId:      "c",
    contractVersion: "0.1.0",
  });

  it("sets type=npc and copies the display name verbatim", () => {
    expect(bundle.actor.type).toBe("npc");
    expect(bundle.actor.name).toBe("Aldric Harwick");
    expect(bundle.actor.prototypeToken.name).toBe("Aldric Harwick");
  });

  it("leaves img + token texture null — orchestrator fills them post-upload", () => {
    expect(bundle.actor.img).toBeNull();
    expect(bundle.actor.prototypeToken.texture.src).toBeNull();
  });

  it("emits sensible NPC token defaults (matches v13 dnd5e dump)", () => {
    expect(bundle.actor.prototypeToken.disposition).toBe(0);
    expect(bundle.actor.prototypeToken.actorLink).toBe(false);
    expect(bundle.actor.prototypeToken.displayName).toBe(0);
    expect(bundle.actor.prototypeToken.displayBars).toBe(0);
    expect(bundle.actor.prototypeToken.bar1.attribute).toBe("attributes.hp");
  });

  it("ownership defaults to GM-only ({default: 0})", () => {
    expect(bundle.actor.ownership).toEqual({ default: 0 });
  });

  it("biography prepends a race + occupation lead paragraph", () => {
    const bio = bundle.actor.system.details.biography.value;
    expect(bio).toContain("<strong>Race:</strong> Human");
    expect(bio).toContain("<strong>Occupation:</strong> Blacksmith");
  });

  it("biography renders each public section as <h2> + rendered body", () => {
    const bio = bundle.actor.system.details.biography.value;
    expect(bio).toContain("<h2>Appearance &amp; Mannerisms</h2>");
    expect(bio).toContain("Soot-streaked apron");
    expect(bio).toContain("<h2>Personality &amp; Quirks</h2>");
    expect(bio).toContain("<li>Patient with apprentices</li>");
  });

  it("biography .public mirrors .value (sections are already public-only)", () => {
    expect(bundle.actor.system.details.biography.public).toBe(
      bundle.actor.system.details.biography.value,
    );
  });

  it("stamps drift-tracking flags on the actor", () => {
    const flags = bundle.actor.flags[MODULE_ID];
    expect(flags.slug).toBe("aldric-harwick");
    expect(flags.campaign_id).toBe("c");
    expect(flags.source_path).toBe("data/c/documents/dm/npc_aldric-harwick.md");
    expect(flags.modified_at).toBe("2026-05-09T18:42:31+00:00");
    expect(flags.api_contract_version).toBe("0.1.0");
    expect(flags.kind).toBe("npc-actor");
  });

  it("does NOT populate system.attributes/abilities — that's S9 territory", () => {
    const sys = bundle.actor.system as Record<string, unknown>;
    expect(sys.attributes).toBeUndefined();
    expect(sys.abilities).toBeUndefined();
  });

  it("builds a companion DM-notes journal with one page per dm_section", () => {
    expect(bundle.journal).not.toBeNull();
    expect(bundle.journal!.name).toBe("Aldric Harwick — DM Notes");
    expect(bundle.journal!.pages).toHaveLength(2);
    expect(bundle.journal!.pages[0]!.name).toBe("Motivation & Secret");
    expect(bundle.journal!.pages[0]!.type).toBe("text");
    expect(bundle.journal!.pages[0]!.text.format).toBe(1);
    expect(bundle.journal!.pages[0]!.text.content).toContain("salt-iron blades");
    expect(bundle.journal!.pages[1]!.name).toBe("Plot Hooks");
    expect(bundle.journal!.pages[1]!.text.content).toContain("<li>");
  });

  it("stamps drift-tracking flags on the journal with kind=npc-dm-notes", () => {
    const flags = bundle.journal!.flags[MODULE_ID];
    expect(flags.slug).toBe("aldric-harwick");
    expect(flags.kind).toBe("npc-dm-notes");
    // Same campaign_id / source_path as the actor — links the pair.
    expect(flags.campaign_id).toBe(bundle.actor.flags[MODULE_ID].campaign_id);
    expect(flags.source_path).toBe(bundle.actor.flags[MODULE_ID].source_path);
  });

  it("bundle surfaces slug, campaignId, contractVersion for orchestrator use", () => {
    expect(bundle.slug).toBe("aldric-harwick");
    expect(bundle.campaignId).toBe("c");
    expect(bundle.contractVersion).toBe("0.1.0");
  });
});

describe("buildImportBundle — variants", () => {
  it("skips the lead paragraph when neither race nor occupation are present", () => {
    const payload = makePayload({ front_matter: {} });
    const bundle  = buildImportBundle(payload, { campaignId: "c" });
    expect(bundle.actor.system.details.biography.value).not.toContain("<strong>Race:</strong>");
    expect(bundle.actor.system.details.biography.value).not.toContain("<strong>Occupation:</strong>");
  });

  it("renders just race when occupation is absent", () => {
    const payload = makePayload({ front_matter: { race: "Halfling" } });
    const bio = buildImportBundle(payload, { campaignId: "c" }).actor.system.details.biography.value;
    expect(bio).toContain("<strong>Race:</strong> Halfling");
    expect(bio).not.toContain("<strong>Occupation:</strong>");
    // No trailing separator dot.
    expect(bio).not.toContain(" · </p>");
  });

  it("returns journal=null when there are no dm_sections", () => {
    const payload = makePayload({ dm_sections: [] });
    const bundle  = buildImportBundle(payload, { campaignId: "c" });
    expect(bundle.journal).toBeNull();
  });

  it("falls back to slug when name + display_name are empty", () => {
    const payload = makePayload({ name: "", display_name: "" });
    const bundle  = buildImportBundle(payload, { campaignId: "c" });
    expect(bundle.actor.name).toBe("aldric-harwick");
    expect(bundle.actor.prototypeToken.name).toBe("aldric-harwick");
  });

  it("escapes HTML special chars in race/occupation front-matter (defence-in-depth)", () => {
    const payload = makePayload({
      front_matter: { race: "Human <script>alert(1)</script>", occupation: "Smith" },
    });
    const bio = buildImportBundle(payload, { campaignId: "c" }).actor.system.details.biography.value;
    expect(bio).not.toContain("<script>");
    expect(bio).toContain("&lt;script&gt;");
  });

  it("preserves section order from the response — no implicit reordering", () => {
    const payload = makePayload({
      sections: [
        { name: "Voice & Speech Pattern",   body_md: "Low rasp." },
        { name: "Appearance & Mannerisms",  body_md: "Soot-streaked." },
        { name: "Name & Identity",          body_md: "Aldric." },
      ],
    });
    const bio = buildImportBundle(payload, { campaignId: "c" }).actor.system.details.biography.value;
    const voiceIdx = bio.indexOf("Voice");
    const appIdx   = bio.indexOf("Appearance");
    const nameIdx  = bio.indexOf("Name &amp; Identity");
    expect(voiceIdx).toBeGreaterThan(0);
    expect(appIdx).toBeGreaterThan(voiceIdx);
    expect(nameIdx).toBeGreaterThan(appIdx);
  });
});
