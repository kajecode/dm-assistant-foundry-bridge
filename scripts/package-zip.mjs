#!/usr/bin/env node
/**
 * Bundles the built module into `dist/module.zip` for release attachment.
 *
 * Run via `pnpm package` (which builds first). After the build, `dist/`
 * is itself a complete Foundry-installable layout — manifest, esmodule
 * bundle, i18n, sidecars. This script just zips its contents flat:
 *
 *   module.zip
 *     ├── module.json
 *     ├── index.js
 *     ├── index.js.map
 *     ├── languages/en.json
 *     └── README.md, LICENSE.md, CHANGELOG.md  (best-effort)
 *
 * Result: extracting the zip into `Data/modules/dm-assistant-bridge/`
 * produces a working install. `module.json::download` in the manifest
 * points at this file on GitHub Releases.
 */

import { spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root  = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist  = resolve(root, "dist");
const out   = resolve(dist, "module.zip");

try {
  await stat(resolve(dist, "module.json"));
} catch {
  console.error("package-zip: dist/module.json missing — run 'pnpm build' first");
  process.exit(1);
}

const entries = await readdir(dist);
const files   = entries.filter((f) => f !== "module.zip");

// `cd dist && zip ... module.json index.js languages/ ...` keeps the
// zip's internal paths flat (no leading `dist/`), which is what
// Foundry's installer expects when extracting into the module dir.
const result = spawnSync("zip", ["-q", "-r", out, ...files], {
  cwd:    dist,
  stdio: "inherit",
});
if (result.status !== 0) {
  console.error(`package-zip: zip exited with ${result.status}`);
  process.exit(result.status ?? 1);
}

console.log(`package-zip: wrote ${out}`);
