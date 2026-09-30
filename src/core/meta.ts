/**
 * Locating Cognix itself: the installed npm package (or dev checkout) that
 * contains this code and the Pi extension entrypoint.
 *
 * Cognix registers itself with Pi through the official local-path package
 * mechanism (`pi install <absolute path>`), so knowing the real on-disk
 * package root is what makes registration idempotent and always in sync
 * with the running CLI.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COGNIX_PACKAGE_NAME } from "./info.js";

export interface OwnPackage {
  rootDir: string;
  name: string;
  version: string;
}

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Find the nearest ancestor package.json named "cognix". Covers both the
 * source layout (src/core) and the built layout (dist/src/core).
 */
export function findOwnPackage(fromDir: string = moduleDir()): OwnPackage | null {
  let dir = resolve(fromDir);
  for (let depth = 0; depth < 6; depth += 1) {
    const manifestPath = join(dir, "package.json");
    try {
      if (existsSync(manifestPath)) {
        const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
        const record = parsed as Record<string, unknown>;
        if (record.name === COGNIX_PACKAGE_NAME) {
          return {
            rootDir: dir,
            name: COGNIX_PACKAGE_NAME,
            version: typeof record.version === "string" ? record.version : "0.0.0",
          };
        }
      }
    } catch {
      // Keep walking up; an unreadable manifest is not fatal.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The compiled Pi extension entrypoint declared in the cognix manifest. */
export function ownExtensionEntrypoint(rootDir: string): string {
  return join(rootDir, "dist", "src", "extension", "index.js");
}

/** The sdk entry to detect when a dev checkout has not been built yet. */
export function isBuildPresent(rootDir: string): boolean {
  return existsSync(ownExtensionEntrypoint(rootDir));
}
