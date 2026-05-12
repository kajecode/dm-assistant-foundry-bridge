import { defineConfig, type Plugin } from "vitest/config";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Bridge module version read from `module.json` at config-eval time
 * (Foundry's source of truth for the artefact version). Injected
 * into the bundle as `__BRIDGE_VERSION__` via Vite's `define` so
 * the runtime status chip never has to query Foundry's module
 * registry — `game.modules.get(id).version` was returning "0.0.0"
 * in v13 worlds where Foundry's data layer hadn't fully reconciled
 * the manifest. Build-time injection sidesteps that entirely.
 */
const moduleManifestPath = resolve(__dirname, "module.json");
const moduleManifest     = JSON.parse(readFileSync(moduleManifestPath, "utf-8")) as { version: string };
const BRIDGE_VERSION_LITERAL: string = JSON.stringify(moduleManifest.version);

/**
 * Vite plugin that produces a Foundry-ready `dist/` directory.
 *
 * Foundry expects a module's `dist/` (or whatever folder you symlink
 * into `Data/modules/<id>/`) to contain *everything* the manifest
 * references — the manifest itself included. We build to `dist/`,
 * then copy in `module.json` (with `esmodules` rewritten to flat
 * paths) + `languages/` + a few text files. Result: `dist/` is a
 * drop-in module install.
 *
 * The flat-path rewrite means `module.json` in the repo still
 * documents the dev-source layout (`src/index.ts` → `dist/index.js`)
 * while the shipped `dist/module.json` correctly references the
 * install layout (`index.js` next to it).
 */
function foundryDistAssets(): Plugin {
  const ROOT = __dirname;
  const DIST = resolve(ROOT, "dist");

  async function copyDir(from: string, to: string): Promise<void> {
    await mkdir(to, { recursive: true });
    const entries = await readdir(from, { withFileTypes: true });
    for (const e of entries) {
      const src = resolve(from, e.name);
      const dst = resolve(to, e.name);
      if (e.isDirectory()) await copyDir(src, dst);
      else                 await copyFile(src, dst);
    }
  }

  async function rewriteManifest(): Promise<void> {
    const raw      = await readFile(resolve(ROOT, "module.json"), "utf-8");
    const manifest = JSON.parse(raw) as { esmodules?: string[]; styles?: string[] };
    manifest.esmodules = (manifest.esmodules ?? []).map((p) => p.replace(/^dist\//, ""));
    manifest.styles    = (manifest.styles ?? []).map((p) => p.replace(/^dist\//, ""));
    await writeFile(resolve(DIST, "module.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  }

  return {
    name:    "foundry-dist-assets",
    apply:   "build",
    async closeBundle() {
      // module.json with esmodules paths flattened.
      await rewriteManifest();

      // i18n folder — referenced by module.json directly.
      await copyDir(resolve(ROOT, "languages"), resolve(DIST, "languages"));

      // Optional sidecars. Best-effort: skip silently if missing so
      // a future repo reorg doesn't snap the build.
      for (const f of ["README.md", "LICENSE.md", "CHANGELOG.md"]) {
        try {
          await copyFile(resolve(ROOT, f), resolve(DIST, f));
        } catch {
          // Not fatal — these are nice-to-haves in the install dir.
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [foundryDistAssets()],
  define: {
    __BRIDGE_VERSION__: BRIDGE_VERSION_LITERAL,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    minify: false,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
    },
  },
});
