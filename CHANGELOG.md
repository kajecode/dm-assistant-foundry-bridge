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
