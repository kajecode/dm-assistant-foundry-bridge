# dm-assistant-foundry-bridge

> Draft README for the new repo `kajecode/dm-assistant-foundry-bridge` (or the
> upstream equivalent matching `mcdaddytalk/dm-assistant`'s split). Living
> here in the dm-assistant repo for review before the new repo is bootstrapped;
> moves over verbatim once the split is approved.

---

A Foundry VTT module that imports content from a running [dm-assistant](https://github.com/kajecode/dm-assistant) instance into your Foundry world — NPCs as Actors, shops and locations as Journal Entries, with first-class support for the [Campaign Codex](https://github.com/xthesaintx/cc13) module when installed.

**Status:** pre-release. The dm-assistant side of the integration is still being built; expect breaking changes until the API contract hits v1.0.

## What it does

- **Import NPCs** generated in dm-assistant as Foundry Actors (NPC type for NPCs / Creatures; Character type for PCs). Portrait survives the jump; biography lands in the actor sheet.
- **Import shops** as Foundry Journal Entries with inventory and proprietor pages. If Campaign Codex is installed, the journal is converted to a CC `shop` sheet.
- **Import locations** as Journal Entries linked to matching Scenes (when a scene with the same name exists). CC `location` sheet when CC is installed.
- **Drift policy: dm-assistant wins.** Re-importing an entity overwrites the Foundry-side content. Direct edits in Foundry are not preserved — the system of record is dm-assistant. (See [the integration plan](https://github.com/kajecode/dm-assistant/blob/develop/docs/plans/foundry-integration.md) for rationale.)
- **Future:** stat-block translation per game system (D&D 5e first, then Pathfinder 2e), faction imports, player handout sync.

## Requirements

- **Foundry VTT v12+** (target; older versions untested).
- **A reachable dm-assistant instance** with the `/foundry/*` API endpoints enabled. The bridge talks to dm-assistant over HTTP; running both on the same host is the common case but they can be separated.
- **Optional: Campaign Codex** ([`xthesaintx/cc13`](https://github.com/xthesaintx/cc13)). When installed, the bridge uses CC's API for richer sheet types; when absent, the bridge falls back to native Foundry actors / journals.

## Installation

### From the Foundry module marketplace _(post-1.0)_

1. In Foundry's **Setup → Add-on Modules → Install Module**
2. Search for "dm-assistant bridge"
3. Click Install

### Manual install (current, pre-1.0)

1. Download the latest release zip from the [Releases page](#).
2. In Foundry's **Setup → Add-on Modules → Install Module**, paste the manifest URL from that release.
3. Enable the module in your world's **Game Settings → Manage Modules**.

## Configuration

After enabling the module, open **Game Settings → Configure Settings → Module Settings → dm-assistant-bridge**:

| Setting | Description | Default |
| --- | --- | --- |
| **dm-assistant base URL** | The dm-assistant HTTP endpoint. Use `http://localhost:5000` when running on the same Pi as Foundry. | `http://localhost:5000` |
| **dm-assistant API key** | Optional; required if your dm-assistant instance is exposed beyond localhost. Set the corresponding key in the dm-assistant settings overlay (`PUT /settings/foundry`). | empty |
| **Campaign ID** | The dm-assistant campaign to pull from. Visible in the dm-assistant sidebar. | (none — must be set) |
| **Use Campaign Codex when available** | When checked + CC is installed, route imports through CC's sheet types. Uncheck to always use native Foundry documents. | checked |
| **Default actor folder** | Foundry folder name for newly-imported actors. | `dm-assistant Imports` |
| **Default journal folder** | Foundry folder name for newly-imported journals. | `dm-assistant Imports` |

A **Test Connection** button next to the base URL pings `/health` to verify reachability before you try an actual import.

## Using the bridge

Once configured, the module adds:

1. **A sidebar button** ("Import from dm-assistant") that opens a picker — browse NPCs / Shops / Locations from your linked campaign, select what to import.
2. **A `Ctrl+Shift+D` keybind** to open the same picker.
3. **Right-click → Import dm-assistant counterpart** on any actor / journal that was previously imported — refreshes from the latest dm-assistant content.
4. **A status indicator** in the bottom-right of the Foundry UI showing connection state (✓ connected / ✗ unreachable / ⚠ outdated bridge version).

## Architecture

The bridge **pulls** from dm-assistant rather than dm-assistant pushing into Foundry. The integration runs as a Foundry-side module because:

- Campaign Codex's API is only callable from inside the Foundry process — `campaignCodexAPI.convertJournalToCCSheet`, `openTOCSheet`, etc. don't exist as HTTP endpoints.
- Foundry's own document creation APIs are easier to reach from inside the module than from outside.
- The DM-facing UI ("Import this NPC") fits Foundry's existing mental model better than asking the DM to context-switch back to dm-assistant.

dm-assistant exposes a small JSON HTTP contract (`GET /foundry/<kind>/{slug}`); this module consumes it and writes the result into Foundry. dm-assistant makes **zero outbound network calls** to Foundry.

Full design docs (kept in the dm-assistant repo since they define the API contract):

- [Integration plan](https://github.com/kajecode/dm-assistant/blob/develop/docs/plans/foundry-integration.md) — phased delivery, use cases, decisions
- [Templates](https://github.com/kajecode/dm-assistant/blob/develop/docs/foundry-templates/) — actor / object / journal schemas with field mappings + open questions

## Compatibility matrix

| Foundry version | Game system | CC installed | Status |
| --- | --- | --- | --- |
| v12 | D&D 5e | yes | Target for v1 |
| v12 | D&D 5e | no | Target for v1 (native fallback) |
| v12 | PF2e | yes | Stretch — v2 |
| v12 | PF2e | no | Stretch — v2 |
| v13 | any | any | Probe once Foundry v13 ships |
| Older Foundry | any | any | Not targeted |

## Development

```bash
# Clone
git clone https://github.com/<owner>/dm-assistant-foundry-bridge
cd dm-assistant-foundry-bridge

# Install dependencies
pnpm install        # or npm install

# Build for dev — watches src/ and outputs to dist/
pnpm dev

# Run tests
pnpm test

# Link the dist/ output into your local Foundry data directory:
ln -s "$(pwd)/dist" ~/Library/Application\ Support/FoundryVTT/Data/modules/dm-assistant-bridge
# (Foundry on Mac default; adjust for Linux / Windows / Pi)

# Then enable the module in your dev world.
```

### Project structure

```
.
├── src/
│   ├── index.ts                 # Foundry module entrypoint (Hooks.on('init'))
│   ├── settings/                # Module settings registration
│   ├── api/                     # dm-assistant HTTP client + Pydantic-ish DTOs
│   ├── translators/             # per-system actor / item / journal builders
│   │   ├── dnd5e/
│   │   └── pf2e/
│   ├── cc/                      # Campaign Codex integration glue
│   ├── ui/                      # ImportPicker dialog, settings panel, status indicator
│   └── lib/                     # shared utilities (slugify, hex-colour validator, etc.)
├── languages/                   # i18n
├── styles/
├── module.json                  # Foundry module manifest
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### API contract

The bridge consumes a small set of HTTP endpoints from dm-assistant. The contract is defined in dm-assistant; this repo's `src/api/` mirrors the schemas.

**v1 contract endpoints** (subject to change until v1.0):

| Endpoint | Returns |
| --- | --- |
| `GET /foundry/health` | Health probe — bridge version compatibility |
| `GET /foundry/campaigns` | List of importable campaign ids + names |
| `GET /foundry/npc/{slug}` | NPC payload — common fields + per-system stat block source |
| `GET /foundry/shop/{slug}` | Shop payload — sections + inventory + proprietor reference |
| `GET /foundry/location/{slug}` | Location payload — sections + optional scene-name hint |

Schemas authoritative in [`docs/foundry-templates/`](https://github.com/kajecode/dm-assistant/blob/develop/docs/foundry-templates/) over in the dm-assistant repo.

### Release process

1. Bump `version` in `module.json` and `package.json` (semver).
2. Update `CHANGELOG.md`.
3. `pnpm build && pnpm package` produces `dist/module.zip`.
4. Tag `vX.Y.Z`, push, create a GitHub Release attaching `module.zip` and the URL of the raw `module.json`.
5. _(Post-1.0)_ Submit to the Foundry module marketplace for distribution updates.

### Versioning + compatibility

- **Bridge version** (this repo) is the published artefact users install in Foundry.
- **dm-assistant API contract version** is independent — declared in dm-assistant's `/foundry/health` response.
- The bridge ships with a **minimum compatible API contract version** in `module.json`. On startup it probes `/foundry/health`; if the running dm-assistant is too old, the status indicator goes red and import is disabled until upgrade.

## License

MIT. (Same as dm-assistant.)

## Related

- [dm-assistant](https://github.com/kajecode/dm-assistant) — the upstream that this bridge imports from
- [Campaign Codex](https://github.com/xthesaintx/cc13) — Foundry module providing richer sheets for NPCs / shops / locations
- [Foundry VTT](https://foundryvtt.com/) — the virtual tabletop this module plugs into
