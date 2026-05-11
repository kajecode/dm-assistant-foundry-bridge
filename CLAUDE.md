# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

**Pre-release.** As of this writing the repo contains only `README.md`, `module.json`, `CHANGELOG.md`, `LICENSE.md`, and `.gitignore` — no `src/`, no `package.json`, no build tooling yet. The README describes the **planned** structure; the upstream API it consumes (dm-assistant `/foundry/*`) is also still being built. Expect to bootstrap missing scaffolding rather than edit existing code.

When the toolchain lands, the README declares it as **pnpm + Vite + TypeScript**:

```bash
pnpm install
pnpm dev        # watch src/ → dist/
pnpm test
pnpm build && pnpm package   # produces dist/module.zip
```

Do not invent commands that aren't yet wired up — check `package.json` exists before claiming `pnpm test` will run.

## What this module is

A **Foundry VTT v13** module that imports content from a running [dm-assistant](https://github.com/kajecode/dm-assistant) instance — NPCs → Actors, shops/locations → Journal Entries. Two render paths:

- **With [Campaign Codex](https://github.com/xthesaintx/cc13) installed** → route through CC's API (`campaignCodexAPI.convertJournalToCCSheet`, `openTOCSheet`) for richer sheets.
- **Without CC** → fall back to native Foundry actors / journals.

Every translator must handle both paths. CC's API is only callable from inside the Foundry process, which is why this lives as a Foundry module rather than a dm-assistant-side feature.

## Architecture invariants

These are decisions, not preferences. Don't quietly revisit them.

1. **One-way pull, bridge → dm-assistant.** The Foundry module makes HTTP calls *out* to `GET /foundry/<kind>/{slug}`. dm-assistant makes **zero outbound network calls** to Foundry. Don't add a push channel, webhook receiver, or websocket from dm-assistant into Foundry.

2. **dm-assistant wins on drift.** Re-importing an entity **overwrites** the Foundry-side content. Direct Foundry edits are not preserved. Do not add merge logic, conflict prompts, or "preserve local changes" toggles without an explicit decision to reverse this policy (and an update to the rationale in the [dm-assistant integration plan](https://github.com/kajecode/dm-assistant/blob/develop/docs/plans/foundry-integration.md)).

3. **API contract is authoritative upstream.** Schemas live in [`dm-assistant/docs/foundry-templates/`](https://github.com/kajecode/dm-assistant/blob/develop/docs/foundry-templates/). The `src/api/` DTOs in this repo *mirror* them — they are not the source of truth. If a field shape is unclear, the upstream template wins; flag the divergence rather than invent a shape locally.

4. **Per-system translators are isolated.** `src/translators/dnd5e/` and `src/translators/pf2e/` should not import from each other. D&D 5e is v1; PF2e is stretch / v2.

## Versioning + compatibility

Two version numbers move independently — be careful which one you're touching:

- **Bridge version** = `module.json::version` = `package.json::version` = git tag `vX.Y.Z`. These three move together, one per release. See `CHANGELOG.md` for the cadence rule.
- **Minimum compatible API contract version** = `module.json::flags.dm-assistant-bridge.min-api-contract-version`. Bumping this field is a **breaking change** for users running older dm-assistant deployments. Call it out explicitly in the changelog entry. On startup the module probes `/foundry/health`; if the running dm-assistant is older than this minimum, the status indicator goes red and import is disabled.

Foundry compatibility window is also declared in `module.json::compatibility` (currently `minimum: "13", maximum: "13"`). v14 support is a probe-once-shipped item — don't widen this until tested.

## Tracking + related repos

- Parent epic for this work: [`kajecode/dm-assistant#450`](https://github.com/kajecode/dm-assistant/issues/450).
- Upstream API + design docs: [`kajecode/dm-assistant`](https://github.com/kajecode/dm-assistant), especially `docs/plans/foundry-integration.md` and `docs/foundry-templates/`.
- Optional peer module: [`xthesaintx/cc13`](https://github.com/xthesaintx/cc13) (Campaign Codex).
