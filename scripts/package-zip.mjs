#!/usr/bin/env node
/**
 * Bundles the built module into `dist/module.zip` for release attachment.
 *
 * Run via `pnpm package` (which builds first). The release flow uploads
 * the resulting zip as the GitHub Release asset; `module.json::download`
 * points at exactly this filename.
 *
 * The zip's top-level structure is what Foundry expects when a user
 * installs by manifest URL:
 *
 *   module.zip
 *     ├── module.json
 *     ├── languages/
 *     │   └── en.json
 *     ├── dist/
 *     │   └── index.js
 *     └── README.md, LICENSE.md, CHANGELOG.md
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out  = resolve(root, "dist", "module.zip");

await mkdir(dirname(out), { recursive: true });

const files = [
  "module.json",
  "README.md",
  "LICENSE.md",
  "CHANGELOG.md",
  "languages/en.json",
  "dist/index.js",
];

// Validate that everything we plan to ship exists before invoking zip.
for (const f of files) {
  try {
    await readFile(resolve(root, f));
  } catch {
    console.error(`package-zip: missing input file ${f} — did 'pnpm build' run?`);
    process.exit(1);
  }
}

// Spawn the system `zip` (macOS + Linux ship it). Windows users build
// in CI under Linux runners so this is acceptable for v1.
const args = ["-q", "-r", out, ...files];
const result = spawnSync("zip", args, { cwd: root, stdio: "inherit" });
if (result.status !== 0) {
  console.error(`package-zip: zip exited with ${result.status}`);
  process.exit(result.status ?? 1);
}

const _ = createWriteStream;  // tree-shake guard — kept so future Node-only zip impl can swap in
console.log(`package-zip: wrote ${out}`);
