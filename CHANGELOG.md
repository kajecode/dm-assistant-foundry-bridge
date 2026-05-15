# Changelog

All notable changes to **dm-assistant-foundry-bridge** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`module.json::version` (the Foundry-side artefact version) and the Git tag
move together — one `vX.Y.Z` per release.

The bridge declares a **minimum compatible API contract version** (the
dm-assistant `/foundry/*` endpoint family) via the
`flags.dm-assistant-bridge.min-api-contract-version` field in
`module.json`. Bumping that field is a breaking change for users running
older dm-assistant deployments; flag it explicitly in the entry below.


## [0.6.0] — 2026-05-15

### Added

- **Compendium-source resolution** (#32). Imported items can now be replaced with fully-statted compendium documents instead of LLM stubs. When an imported weapon / spell / equipment / consumable / tool / loot name matches an item in a configured compendium (the dnd5e SRD, a DDB Importer pack, homebrew, …), the bridge swaps the stub for the real compendium document — full mechanics, art, rules text.
  - **New setting `Item compendiums to resolve against`** (`itemCompendiums`). Empty (default) = OFF: items stay v0.5.2 stubs, no behaviour change for existing worlds. `auto` = search every Item-type compendium. Or a comma-separated list of pack ids (`dnd5e.items, world.homebrew`). Unknown pack ids are logged + skipped, never fatal.
  - **Resolution order**: an explicit `flags.dm-assistant-bridge.compendium_source` (the dm-assistant#485 reserved field, populated by #481 v2) wins via `fromUuid`; otherwise an **exact, normalised name match** (case / whitespace / quotes) against the configured packs. Exact-only at v1 — never resolves "Dagger" → "Dagger +1" (fuzzy is a documented follow-up).
  - **Library copy**: matched compendium items are also copied (idempotently, keyed on the compendium UUID) into a browsable world `<prefix> — Items` folder. Best-effort — a copy failure is logged and never blocks the actor import.
  - **Drift policy preserved**: resolved items keep the `source: "dm-assistant"` flag, so re-import drop-and-replace still cleans bridge items without touching user-authored ones. Native `flags.core.sourceId` records the compendium provenance so the dnd5e sheet shows "from compendium X".
  - **Type guard**: a compendium doc whose type isn't a bridge item type (e.g. a "class" / "background" name collision) is rejected — the stub is kept rather than embedding a junk document.

### Why

Surfaced during the v0.5.0/v0.5.2 Pi smoke — the operator runs DDB Importer and wants real SRD/DDB items + spells on imported actors, not the thin LLM stubs. This upgrades the v0.5.2 spell/item stubs into mechanically-complete documents when a compendium match exists.

### Internal

- New `src/foundry/compendiumResolve.ts` — Foundry-runtime post-pass between the pure translator and persistence (the translator stays pure data; `importActor` runs the resolver before `createOrUpdateActor`). Never throws — a miss or error degrades to the v0.5.2 stub.
- New `resolveItemsFolderId()` in `foundry/folders.ts` (proper public helper; `<prefix> — Items`, type `Item`).
- `DnD5eItemData` bridge-flag block gains `origin_name` (the LLM's pre-decoration name — the resolver matches on this, not the `(actor)`-suffixed display name), `compendium_source` passthrough, and `resolved_from` provenance.
- 13 new tests (resolver match / no-match / precedence / fallback / type-guard / idempotent library copy / never-throws / name normalisation). 224/224 total pass.

### Compatibility

- **No API contract change.** `min-api-contract-version` stays `0.4.0`.
- **Opt-in.** Existing worlds see no change until the operator sets `itemCompendiums`.


## [0.5.2] — 2026-05-15

### Fixed

- **Per-type `Item.system` fields for non-weapon items.** v0.5.0 only populated weapon-specific `system` slots; spell / feat / equipment / consumable / tool / loot items were created with description + activation + uses only. dnd5e v5.x renders those as blank or broken rows without their type-specific slots. v0.5.2 adds minimal-but-valid shapes per type:
  - **spell** — `level` (defaults to `0`/cantrip — the dnd5e Spells tab groups by level and breaks without it; the actions schema doesn't emit spell level yet), `school`, `properties`, `materials`, `preparation`, `target`, `range`.
  - **feat** — `type.value: "monster"` (matches what the dnd5e system migration assigns NPC-attached feats; confirmed via the Elowen Tristane reference export), `properties`, `requirements`, `prerequisites`.
  - **equipment** — physical-item common slots (`quantity`, `weight`, `price`, `rarity`, `identified`) + `armor` + `equipped`.
  - **consumable** / **tool** / **loot** — physical-item common slots + their per-type `type` / `ability` / `proficient` slots.

### Why

Surfaced during the v0.5.0 Pi smoke. The companion dm-assistant v0.29.3 fix makes the LLM emit per-spell `type: "spell"` entries (previously a spellcaster's whole list collapsed into one feat); without this v0.5.2 shape fix, those spell items would land on the actor as unrenderable stubs. The two releases ship together.

### Notes

- Spell stubs are intentionally minimal (level-0 cantrip default, empty school). Full spell mechanics come from **#32** (compendium-source resolution — match the spell name against an installed SRD / DDB compendium and replace the stub with the real entry). Until #32 ships, the GM refines spell level/school, or drag-drops the spell from a compendium.
- No API contract change; `min-api-contract-version` stays at `0.4.0`.
- 7 new translator tests pin the per-type shapes. 213/213 total tests pass.


## [0.5.1] — 2026-05-14

### Fixed

- **Activity `_id` length for weapon items** (#30). The synthesised `AttackActivity`
  was assigned the hardcoded key `dmaImport0001` (13 characters). Foundry dnd5e v5.x
  validates every activity `_id` against `/^[a-zA-Z0-9]{16}$/`; a 13-character id
  fails silently — the activity object is discarded, so imported weapons appeared in
  the actor sheet but their attack-roll buttons did nothing. Fix generates a random
  16-character alphanumeric id at translation time. Also includes a drive-by typecheck
  correction in `tests/documents-items.test.ts` that was blocking CI under the stricter
  compiler settings introduced in v0.5.0.


## [0.5.0] — 2026-05-14

> ⚠ **Breaking for users on dm-assistant < 0.28.0.** `min-api-contract-version`
> bumps `0.3.0 → 0.4.0` because the bridge now consumes the
> `front_matter.actions` field introduced in dm-assistant v0.28.0.
> Older deployments will see the chip go yellow ("outdated"). Upgrade
> the server first.

### Added

- **Embedded Items translator** (bridge#20, closes the **#481** v1 umbrella). When an imported NPC or Creature payload includes a `front_matter.actions.items[]` array (dm-assistant v0.28.0+), the bridge now translates each entry into a Foundry embedded `Item` document on the actor. Weapon items get a synthesised `activities` entry so attack rolls work out of the box; feat / spell / equipment / consumable / tool / loot items land with description + activation + uses + recharge.
- **Naming convention**: weapon + feat items decorated with `${item.name} (${actor.name})` (matches Foundry's compendium-import convention for natural attacks); other item types stay bare.
- **Drop-and-replace drift policy**: on re-import, items flagged with `flags.dm-assistant-bridge.source === "dm-assistant"` are deleted before the new translated set is created. User-authored items (no `dm-assistant` source flag) survive untouched.
- **Ranged-vs-melee heuristic**: actionType defaults to `mwak` (melee weapon attack). Flips to `rwak` only when the item carries a `thr` (thrown) or `amm` (ammunition) property OR the range is ≥ 30ft. Keeps reach weapons (10ft Slam, etc.) correctly classified as melee.

### Changed

- **`min-api-contract-version` 0.3.0 → 0.4.0** (breaking for dm-assistant < v0.28.0). Required for the embedded-items translation; older dm-assistant servers don't emit the `actions` field.
- **`createOrUpdateActor` signature** gains an optional `items: DnD5eItemData[]` parameter (default `[]`). Existing callers continue to work; passing `[]` runs the drop-and-replace cleanup to remove stale bridge-marked items from previous imports.

### Internal

- New `src/translators/dnd5e/items.ts` translator module (~270 LOC). Pure data; tests cover all seven item types, the naming convention, the source-flag stamping, recharge/uses parsing, melee/ranged heuristic, description rendering, and forward-compat field handling.
- New `src/foundry/documents.ts` helper `syncEmbeddedItems` handles the drop-and-replace cycle via Foundry's embedded-document API.
- `ImportBundle` gains an `items: DnD5eItemData[]` field; `buildImportBundle` populates it from `front_matter.actions` when the payload includes a valid dnd5e actions sidecar.
- 11 new translator tests + 6 new persist-side tests + 5 new bundle-integration tests. Total: 205/205 pass.

### Forward-compat

- `object_slug` and `compendium_source` fields on individual items are reserved (dm-assistant #481 v2 / phase 2). v0.5.0 ignores both; future bridge releases will resolve them against the Objects Library + compendiums.
- `activities` synthesis is the minimal attack-shape only. Full dnd5e v5.x `activities` keyed-dict translation (multiple activities per item, save mechanics, healing, etc.) lands in a phase-2 ticket if needed.


## [0.4.1] — 2026-05-14

### Added

- **Campaign picker dropdown** (#12). The Settings panel's `Campaign ID` field is now sourced from dm-assistant's `GET /campaigns` endpoint — pick from known-good values instead of typing a slug. Surfaced as a `<select>` populated on settings-panel render, with a refresh button for after-the-fact changes. Sorted alphabetically by name; each option shows `<id> — <name> (<game_system>)`. Pre-selects the currently-saved campaign id; a stale id (campaign was deleted on the server side) shows as a distinct `<id> — (not in server list)` option so the operator can re-pick.
- **Free-text fallback** when `/campaigns` is unreachable (CORS / wrong URL / server down / 5xx). The original text input stays in place with the existing trim-on-read defence, plus an inline hint explaining the fallback in operator-friendly copy.
- **`listCampaigns()`** in the API client. NOT a `/foundry/*` route — never API-key gated, so the dropdown probes even from an unconfigured bridge.

### Why this matters

The free-text input caused two trippable bugs during v0.1.0 smoke: accidental leading whitespace (now also defended in the dropdown), and confusing the Kanka campaign id with the dm-assistant slug. Both are eliminated when the operator picks from a list.

### Internal

- 12 new tests pin the picker UI: dropdown render, sort, current-id preselection, stale-id surfacing, mirror-back-to-input, fallback paths (network / HTTP / empty / no-baseUrl / no-input).
- 5 new tests in `api-client.test.ts` for `listCampaigns` (happy path, no-api-key, shape error, HTTP error, config error).

## [0.4.0] — 2026-05-13

> ⚠ **Breaking for users on dm-assistant < 0.25.0.** `min-api-contract-version`
> bumps `0.2.0 → 0.3.0` because the bridge now calls the shop + location
> endpoints introduced in that contract version. Older dm-assistant
> deployments will see the chip go yellow ("outdated"). dm-assistant v0.25.0
> ships with the matching contract — upgrade the server first.

### Added

- **Shop import flow** (#25). Pulls a saved shop from
  dm-assistant's `GET /foundry/shop/{slug}` (introduced in
  dm-assistant v0.25.0 / contract 0.3.0) and writes a Foundry
  `JournalEntry` with one page per dm-assistant section. Public
  sections (`Shop Name & Type`, `Inventory`, `Special & Rare
  Items`, etc.) live on public-ownership pages; DM-only sections
  (`Shop's Secret`, `Proprietor: Motivation & Secret`, etc.) live
  on GM-locked pages.
- **Location import flow** (#26). Same orchestrator as shop — pulls
  from `GET /foundry/location/{slug}` and writes a `JournalEntry`.
  DM-section routing via the location's heading allowlist (`Secrets
  & Hidden Features`, `Adventure Hooks`).
- **Picker kind toggle gains Shop + Location radios.** Same dialog
  as v0.3.x — pick a kind, filter by name, pick an entry, import.
  All four lists (NPCs, Creatures, Shops, Locations) fetch
  concurrently when the picker opens.
- **Folder placement for shops + locations.** `DM Assistant —
  Shops` (Foundry `JournalEntry` folder) and `DM Assistant —
  Locations` (also `JournalEntry`). The folder labels were
  pre-wired in v0.3.1's `KIND_TO_LABEL`; this release activates
  them via the new `resolveJournalFolderId()` helper.
- **Per-kind drift identity.** Bridge flags carry
  `kind: "shop-journal"` / `"location-journal"` so a shop journal
  doesn't collide with a location journal sharing the same slug.
- **`fetchShop` + `listShops` + `fetchLocation` + `listLocations`**
  API client functions. `fetchShop` consumes `/foundry/shop/{slug}`;
  `listShops` consumes `/shop-generate/saved`. Symmetric for
  locations.

- **Targeted API-key error hints in the status chip / Test Connection
  panel** (#28). When dm-assistant returns a 401 with the structured
  `detail.error` discriminant from dm-assistant#489 (contract
  0.3.0+), the bridge surfaces:
  - `missing_api_key` → "API key required" with module-settings
    guidance
  - `invalid_api_key` → "API key mismatch" calling out typo /
    rotation / whitespace-in-paste as common causes
  Older dm-assistant deployments without the structured 401 fall
  back to the generic "Server demanded authentication" copy from
  v0.3.x — no regression.

### Changed

- **`min-api-contract-version` bumped from 0.2.0 to 0.3.0** (#25 /
  #26 — breaking for dm-assistant deployments older than 0.25.0).
  Required for the shop + location endpoints. Older dm-assistant
  servers don't expose those routes.
- **`ApiError` carries optional `authError` + `authHint` fields.**
  Populated automatically by the API client when a 401 response
  body has a `detail.error` / `detail.hint` discriminant.

### Internal

- **Unified `importJournal` orchestrator** at
  `src/import/importJournal.ts` covering shop + location with a
  per-kind branch on `payload.kind`. Same lifecycle as
  `importActor` (fetch → build → upload image → resolve folder →
  create-or-update). Saves ~50% of the duplication two separate
  orchestrators would have introduced.
- **Unified `buildJournalBundle` translator** at
  `src/translators/common/buildJournalData.ts`. Pure data — no
  Foundry runtime calls. Per-kind metadata rendering: shop
  surfaces `shop_type` + `region` + proprietor cross-link;
  location surfaces `region` + `area` + related_* cross-links.
- **`FlagKind` widened** to cover `shop-journal` +
  `location-journal`. `flagKindFor()` now accepts the wider
  `entityKind` + `role` pair without changing the actor-side
  call sites.

### Tests

12 new cases in `tests/buildJournalData.test.ts` covering shop +
location page ordering, metadata-header rendering, proprietor +
related cross-link emission with @UUID placeholder + slug-hint
comments, HTML escaping defence, flag-kind stamping, null-image
fallback. 3 new cases in `tests/error-hints.test.ts` for the
auth-discriminant branches (missing_api_key / invalid_api_key /
unknown forward-compat). 153 tests pass total.

## [0.3.1] — 2026-05-13

### Added

- **Kind-aware folder organization for imported documents** (#24). Imported
  actors and journals now land in per-kind sub-folders rather than the root of
  the Foundry sidebar. NPCs go in `DM Assistant — NPCs`, Creatures in
  `DM Assistant — Creatures`, and their companion DM-notes journals in
  sibling folders (`DM Assistant — NPC DM Notes` / `DM Assistant — Creature
  DM Notes`). Folder names are derived from a new **Import folder prefix**
  setting; folders are created on first import (idempotent) and re-found on
  re-import. Forward-compat labels for `Shops` / `Locations` / `Factions` ship
  in the helper now so the shop + location import flows (#25, #26) can land
  without touching folder code. Re-imports move existing actors/journals into
  the kind folder if they aren't already there.

### Changed

- **Settings rename**: replaced the unused `actorFolder` + `journalFolder`
  free-text inputs with a single `folderPrefix` setting (default
  `DM Assistant`). Existing values on those old settings are silently
  ignored — the new design supersedes them. The old settings did nothing in
  v0.3.0 and earlier (dead UI), so no operational migration is required
  beyond setting the new prefix if you want something other than `DM Assistant`.

### Migration

Pre-existing actors / journals imported by v0.3.0 or earlier stay where they
are (at the root). New imports go into the kind folders. To clean up, drag
existing imports into the new folders manually — Foundry preserves the
bridge's drift-tracking flags on move, so subsequent re-imports continue to
find and update them.

## [0.3.0] — 2026-05-12

> ⚠ **Breaking for users on dm-assistant < 0.24.0.** `min-api-contract-version`
> bumps `0.1.0 → 0.2.0` because the bridge now calls the unified
> `/foundry/actor/{kind}/{slug}` endpoint introduced in that contract.
> Older dm-assistant deployments will see the chip go yellow ("outdated").

### Added

- **Creature import flow** (#19). Bestiary entries (`creature_<slug>.md`
  in dm-assistant) can now be pulled into Foundry as Actors (NPC type,
  matching dnd5e's schema for monsters). Mirrors the NPC import path
  end-to-end: biography + portrait, structured stats via the existing
  D&D 5e translator (creatures inherit the #10 path unchanged because
  the payload shape is identical), drift-overwrite on re-import.
- **Kind toggle in the import picker.** Single picker dialog now has
  NPC / Creature radios at the top; selection drives the orchestrator.
  Both lists fetch concurrently when the picker opens; if one endpoint
  fails the other still renders.
- **`fetchActor`** API client function for the unified
  `/foundry/actor/{kind}/{slug}` endpoint (dm-assistant API contract 0.2.0+).
- **`listCreatures`** API client function for `/creature-generate/saved`.

### Changed

- **Status chip label now shows the bridge module version** instead of the
  API contract version (#18). The chip reads `DM Assistant Bridge v0.3.0`
  when connected — matching what the DM sees in Foundry's module list. The
  tooltip surfaces all three version sources explicitly: bridge module,
  dm-assistant package, API contract. Resolves the "what does `(v0.1.0)`
  mean?" confusion from the v0.22.x patch-storm smoke. Internal: the
  `StatusPayload.version` field was replaced with a richer
  `StatusPayload.versions` object (`{ bridge?, dmAssistant?, apiContract? }`).
  Version is injected at build time via Vite `define` (sidesteps Foundry
  v13's `game.modules.get(id).version` getter, which was returning "0.0.0"
  in some worlds where the manifest hadn't fully reconciled).
- **Drift identity now includes the entity kind.** Imported documents
  carry `flags.dm-assistant-bridge.kind` of `npc-actor` / `npc-dm-notes` /
  `creature-actor` / `creature-dm-notes`. An NPC and a Creature with the
  same slug don't collide on re-import.
- **`min-api-contract-version` bumped from 0.1.0 to 0.2.0** (#19, breaking
  for users on dm-assistant deployments older than 0.24.0). Required for
  the unified actor endpoint; old dm-assistant deployments keep the
  legacy `/foundry/npc/{slug}` route working through the 0.2.x line via
  a deprecation shim, but the bridge no longer calls it.
- **`importNpc.ts` renamed to `importActor.ts`** and parameterized by
  `kind`. The `importNpc` function survives as a thin back-compat shim
  for console macros / external callers.
- **Bridge calls `/foundry/actor/{kind}/{slug}`** for all actor imports
  (was `/foundry/npc/{slug}`).

## [0.2.0] — 2026-05-12

First-class structured NPC import for D&D 5e + modernised picker dialog.

### Added

- **D&D 5e stat-block translator** (#10). Consumes the structured
  `stats:` data dm-assistant v0.22.x emits in the `/foundry/npc/{slug}`
  response (sidecar YAML merged into `front_matter.stats`) and populates
  the imported actor's `system.attributes.ac.{flat,calc}`,
  `system.attributes.hp.{value,max,formula}`, `system.attributes.movement.*`,
  `system.attributes.senses.ranges.*`, `system.abilities.{str,...}.value`,
  `system.details.{cr,alignment,type.*}`, `system.traits.size`,
  `system.traits.languages.{value,custom}` (with automatic standard /
  invented language splitting), and `system.traits.{di,dr,dv,ci}.value`.
  Verified against the dnd5e v5.x actor schema (Solyrian Keeper export).
  CR normalisation handles fractional CRs ("1/4" → 0.25 etc.). Unknown
  rulesets log a warning + fall back to biography-only — no crashes.
- **`buildActorData` integration**: when `payload.front_matter.stats.ruleset
  === "dnd5e"`, the dnd5e fields merge into `actor.system` alongside the
  biography. Legacy markdown without `stats:` still imports
  biography-only (unchanged).

### Changed

- **Picker dialog ports from v1 `Dialog` → `foundry.applications.api.DialogV2`** (#11).
  Resolved via the same v13 namespace pattern used for `KeyboardManager` /
  `FilePicker`. Clears the last remaining
  "V1 Application framework is deprecated" warning from v0.1.0 smoke.
  Button shape changes to an array; icons take class strings;
  callback receives `(event, button, dialog)` with `dialog.element` as
  the raw HTMLElement. `unwrapHtml` helper retained for defence-in-depth.

### Dependencies

No `min-api-contract-version` bump — still `0.1.0`. The structured
`stats:` data ships under the same contract version (it's a payload-shape
addition, not a removal or rename). Older dm-assistant deployments that
don't emit `stats:` still produce valid imports (biography-only).

### Tests

- 29 new cases in `tests/dnd5e-statsBlock.test.ts` covering CR
  normalisation, language splitting, full + minimum payloads, and the
  ruleset guard.
- 3 new cases in `tests/buildActorData.test.ts` covering the dnd5e
  merge, the pf2e fallback, and legacy markdown.

114 tests pass total.

## [0.1.1] — 2026-05-11

### Changed

- **status indicator:** Mount the connection status chip as a list item inside
  `#players-active .players-list` instead of as a footer `<div>` appended to
  the outer `#players` aside. This keeps the chip visually integrated with the
  Players Online panel, matching the layout pattern used by ItemPiles. (#16)

## [0.1.0] — 2026-05-11

First releasable build. Ships the v1 MVP of the Foundry-integration
epic ([`kajecode/dm-assistant#450`](https://github.com/kajecode/dm-assistant/issues/450)):
a working "Import NPC from dm-assistant" flow inside Foundry v13.

**Minimum dm-assistant API contract version:** `0.1.0`. The bridge
probes `/foundry/health` on startup and surfaces a red status when
the running dm-assistant is older.

### Added — Module bootstrap (#3)

- TypeScript + Vite + Vitest + ESLint flat-config toolchain.
- Foundry v13 module manifest. CI runs lint + typecheck + test + build
  on every PR.
- Six world-scoped settings: dm-assistant base URL, API key, campaign
  ID, "use Campaign Codex when available", default actor folder,
  default journal folder.
- Bottom-right **connection status chip** mounted as a footer in the
  Foundry Players Online panel. Five states (unknown / probing /
  connected / unreachable / outdated) with coloured-dot indicator and
  detail tooltip.
- **Test Connection button** in the settings panel — runs the same
  health probe as the indicator and reports the result inline. Smart
  error categorisation: distinguishes CORS / network / HTTP /
  timeout / shape / config failures with state-specific guidance, and
  inlines the current Foundry origin when CORS is the likely cause
  so operators can copy-paste it into dm-assistant's
  `ALLOWED_ORIGINS` env var.
- Module API surface — `game.modules.get("dm-assistant-bridge").api`
  exposes `openImportPicker()` + `runProbe()` for macros and console
  use.

### Added — NPC import (#9)

- **Import picker** dialog (filterable list of NPCs from the
  configured campaign).
- **Sidebar button** on the Actor Directory header: *Import from
  dm-assistant*.
- **Keybind** — `Ctrl+Shift+D` opens the picker.
- **Image upload** — portrait + thumbnail bytes fetched from
  dm-assistant, uploaded via `FilePicker` into
  `Data/<prefix>/<campaign>/npc/<slug>.png` (prefix configurable).
- **Actor creation** — Foundry Actor of type `npc` with:
  - H1 → `name`
  - public sections concatenated into `system.details.biography.value` +
    `.public` (HTML-rendered from markdown with `<>` / `&` pre-escaped
    so any literal HTML from the generator renders as text)
  - race + occupation prose lead paragraph as the v1 fallback for
    structured fields deferred to S9
  - sensible NPC token defaults (`disposition: 0`,
    `actorLink: false`, `displayName: 0`, `bar1: attributes.hp`)
  - GM-default ownership
  - drift-tracking flags (`slug`, `campaign_id`, `source_path`,
    `modified_at`, `api_contract_version`) so re-import finds and
    overwrites the existing actor
- **DM-notes journal** — companion `JournalEntry` named
  `<NPC name> — DM Notes`, ownership locked to GM-only, one
  `JournalEntryPage` per DM-only section in the response.
- **Drift policy** — re-import overwrites the actor + replaces the
  journal's pages collection (via `deleteEmbeddedDocuments` +
  `createEmbeddedDocuments` — `update()` alone duplicates pages).
- **Foundry v13 deprecation hardening** — `KeyboardManager` and
  `FilePicker` resolved via their v13 namespaces
  (`foundry.helpers.interaction.KeyboardManager`,
  `foundry.applications.apps.FilePicker.implementation`) so console
  noise is minimal.

### Added — Settings

- `Foundry Data/ upload prefix` setting (default `dm-assistant`) —
  controls where portraits land under `Data/`.

### Documentation

- README updates: explicit Foundry v13 target, manual install /
  symlink instructions, **Campaign Codex v1 gap** callout, configuration
  table including all seven settings.
- Settings hint on dm-assistant's CORS section (via dm-assistant
  #464) explicitly mentions the bridge's CORS requirement.

### Known v1 gaps + follow-ups

- **Stat blocks** — actors import with default ability scores / AC / HP.
  Structured stat translation lands in S9
  ([`#10`](https://github.com/kajecode/dm-assistant-foundry-bridge/issues/10)) once
  dm-assistant emits structured `stats:` front-matter
  ([`kajecode/dm-assistant#466`](https://github.com/kajecode/dm-assistant/issues/466)).
- **Special abilities / features as Items** — actor's `items[]` is
  empty in v0.1.0; weapons, traits, spells stay as biography prose
  for now. SPIKE: [`#14`](https://github.com/kajecode/dm-assistant-foundry-bridge/issues/14).
- **Campaign Codex actor integration** — the "Use Campaign Codex
  when available" setting is a no-op for NPCs in v0.1.0. SPIKE:
  [`#13`](https://github.com/kajecode/dm-assistant-foundry-bridge/issues/13).
- **Campaign picker** — Campaign ID is a free-text field. Dropdown
  sourced from `/campaigns` lands in
  [`#12`](https://github.com/kajecode/dm-assistant-foundry-bridge/issues/12).
- **`V1 Application framework` deprecation** — the picker uses v1
  `Dialog`. Port to `DialogV2` tracked in
  [`#11`](https://github.com/kajecode/dm-assistant-foundry-bridge/issues/11).

### Build artefact

`dist/module.zip` is produced by `pnpm package` and ships flat:
`module.json` (with `esmodules: ["index.js"]`), `index.js`,
`index.js.map`, `languages/en.json`, README, LICENSE, CHANGELOG.
Extracts directly into `Data/modules/dm-assistant-bridge/`.
