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


## [Unreleased]

### Added

- Initial repo bootstrap: README, MIT license, Foundry module manifest
  skeleton (`module.json`), `.gitignore`.

### Notes

This release stub exists so the repo has a CHANGELOG file from day one.
The first real release will land here once Slice S2 (module skeleton with
a working settings panel + connection probe) ships.

Tracking parent epic: [`kajecode/dm-assistant#450`](https://github.com/kajecode/dm-assistant/issues/450).
