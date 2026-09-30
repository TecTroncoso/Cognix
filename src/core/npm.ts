/**
 * npm detection and the official global installation of Pi.
 *
 * Cognix never downloads or copies Pi itself; it runs the documented
 * npm command and lets npm/Pi own the installation.
 */

import { dirname, join } from "node:path";
import { CognixError } from "./errors.js";
import { findExecutable } from "./finder.js";
import type { FsLike } from "./fsLike.js";
import { PI_INSTALL_ARGS, PI_INSTALLER_HINT, PI_NPM_PACKAGE } from "./info.js";
import { isWindows, type Platform } from "./platform.js";
import type { ProcessRunner } from "./process.js";

export interface NpmResolution {
  command: string;
}

/** Locate npm with the same platform rules used for pi. */
export function resolveNpmExecutable(options: {
  env: NodeJS.ProcessEnv;
  platform: Platform;
  fs: FsLike;
}): NpmResolution | null {
  const { env, platform, fs } = options;
  const wellKnownDirs = isWindows(platform)
    ? env.APPDATA
      ? [join(env.APPDATA, "npm")]
      : []
    : ["/usr/local/bin", "/usr/bin", "/opt/homebrew/bin"];
  return findExecutable("npm", { env, platform, fs, wellKnownDirs });
}

/**
 * Install Pi globally through the official documented mechanism:
 *   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
 *
 * Streams to the user's terminal. Throws CognixError on failure.
 */
export async function installPiGlobally(
  runner: ProcessRunner,
  npmCommand: string,
): Promise<void> {
  const code = await runner.interactive(npmCommand, [...PI_INSTALL_ARGS]);
  if (code !== 0) {
    throw new CognixError(
      `npm failed to install ${PI_NPM_PACKAGE} (exit ${String(code)}).`,
      [
        "Check your network connection and npm registry access.",
        `You can install Pi manually: npm ${PI_INSTALL_ARGS.join(" ")}`,
        `macOS/Linux alternative: ${PI_INSTALLER_HINT}`,
        "Then run cognix again.",
      ],
    );
  }
}

/** Directory that contains a resolved npm, used as an extra pi scan dir. */
export function npmSiblingDir(npmCommand: string): string {
  return dirname(npmCommand);
}
