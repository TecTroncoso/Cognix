/**
 * Generic executable discovery shared by the pi/npm/gentle-ai/go resolvers.
 *
 * Order: explicit env override (handled by callers) -> PATH scan with
 * platform-aware names (win32: .cmd/.exe/.bat) -> caller-provided well-known
 * directories.
 */

import { join } from "node:path";
import type { FsLike } from "./fsLike.js";
import { executableNames, pathDelimiter, type Platform } from "./platform.js";

export interface FindOptions {
  env: NodeJS.ProcessEnv;
  platform: Platform;
  fs: FsLike;
  /** Extra directories scanned right after PATH (e.g. sibling dir of npm). */
  extraDirs?: string[];
  /** Directories scanned last (install-location fallbacks). */
  wellKnownDirs?: string[];
}

export interface FoundExecutable {
  command: string;
  source: "path" | "well-known";
}

export function findExecutable(bin: string, options: FindOptions): FoundExecutable | null {
  const { env, platform, fs } = options;
  const names = executableNames(bin, platform);

  const dirs: string[] = [];
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  for (const dir of pathValue.split(pathDelimiter(platform))) {
    if (dir.trim() !== "") dirs.push(dir);
  }
  for (const dir of options.extraDirs ?? []) dirs.push(dir);

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (fs.existsSync(candidate)) return { command: candidate, source: "path" };
    }
  }
  for (const dir of options.wellKnownDirs ?? []) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (fs.existsSync(candidate)) return { command: candidate, source: "well-known" };
    }
  }
  return null;
}
