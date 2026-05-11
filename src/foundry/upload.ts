/**
 * Foundry FilePicker.upload wrapper.
 *
 * Uploads a Blob into `Data/<prefix>/<campaign>/<kind>/<filename>`
 * and returns the Foundry-relative path that the actor can use as
 * `img` / `prototypeToken.texture.src`.
 *
 * Intentionally thin — one Foundry call per function so the surface
 * is easy to mock in tests if/when we ship Foundry-runtime test
 * coverage. Today this module isn't unit-tested; smoke gate covers it.
 */

import { log } from "../lib/log.js";

declare const FilePicker: {
  upload: (
    source: "data" | "public",
    target: string,
    file:   File,
    opts?:  { notify?: boolean },
  ) => Promise<{ path: string } | string>;
  createDirectory: (source: string, target: string) => Promise<unknown>;
};

export interface UploadOptions {
  /** Foundry `Data/` subfolder root — comes from module config. */
  dataPrefix:    string;
  /** Campaign id — second path segment for tidy organisation. */
  campaignId:    string;
  /** Entity kind (`"npc"`, `"shop"`, …) — third path segment. */
  kind:          string;
  /** File name including extension (e.g. `"aldric-harwick.png"`). */
  filename:      string;
  /** The bytes to upload. */
  blob:          Blob;
}

/**
 * Uploads via Foundry's `FilePicker.upload`. Result: the path the
 * actor's `img` field should reference. Creates the target directory
 * tree if missing (best-effort — FilePicker.upload itself sometimes
 * needs the parent to exist).
 */
export async function uploadToFoundry(opts: UploadOptions): Promise<string> {
  const target = `${opts.dataPrefix}/${opts.campaignId}/${opts.kind}`;
  await ensureDirectory(target);

  const file = new File([opts.blob], opts.filename, { type: opts.blob.type || "image/png" });

  // FilePicker.upload returns `{path}` in modern Foundry, but older
  // versions returned the string directly. Handle both.
  const result = await FilePicker.upload("data", target, file, { notify: false });
  const path   = typeof result === "string" ? result : result.path;
  log.debug("uploaded image", path);
  return path;
}

/**
 * Walk the `<prefix>/<campaign>/<kind>` path creating any missing
 * directories. Foundry's createDirectory throws if the dir already
 * exists; we swallow that case.
 */
async function ensureDirectory(fullPath: string): Promise<void> {
  const parts = fullPath.split("/").filter(Boolean);
  let acc = "";
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p;
    try {
      await FilePicker.createDirectory("data", acc);
    } catch (e) {
      // "EEXIST" / "already exists" / similar — non-fatal.
      log.debug("createDirectory non-fatal", acc, e);
    }
  }
}
