/**
 * Pi executable resolution.
 *
 * Detection strategy, in order:
 *   1. COGNIX_PI env override (explicit path; development/testing hook).
 *   2. PATH scan with platform-aware executable names
 *      (win32: pi.cmd / pi.exe / pi.bat — pi.ps1 is never spawned).
 *   3. Well-known install locations, including the default npm global
 *      prefix on Windows and the usual Unix prefixes.
 *
 * Only spawning conventions and the npm distribution shape are assumed;
 * no Pi internals are relied upon.
 */

import { join } from "node:path";
import { findExecutable, type FindOptions } from "./finder.js";
import type { FsLike } from "./fsLike.js";
import { COGNIX_PI_ENV, PI_BIN } from "./info.js";
import { isWindows, resolveHome, type Platform } from "./platform.js";
import type { ProcessRunner } from "./process.js";

export type PiSource = "env-override" | "path" | "well-known";

export interface PiResolution {
  command: string;
  source: PiSource;
}

export interface ResolveOptions {
  env: NodeJS.ProcessEnv;
  platform: Platform;
  fs: FsLike;
  /** Extra directories to scan, e.g. the directory containing a resolved npm. */
  extraDirs?: string[];
}

function wellKnownPiDirs(env: NodeJS.ProcessEnv, platform: Platform): string[] {
  if (isWindows(platform)) {
    // Default npm global prefix on Windows.
    return env.APPDATA ? [join(env.APPDATA, "npm")] : [];
  }
  const dirs = ["/usr/local/bin", "/usr/bin"];
  try {
    const home = resolveHome(env, platform);
    dirs.push(join(home, ".local", "bin"), join(home, ".npm-global", "bin"));
  } catch {
    // No home directory: system prefixes remain the fallbacks.
  }
  return dirs;
}

/**
 * Locate the pi executable. Returns null when Pi is not installed (or not
 * on PATH and not in a well-known location).
 */
export function resolvePiExecutable(options: ResolveOptions): PiResolution | null {
  const { env, platform, fs } = options;

  const override = env[COGNIX_PI_ENV];
  if (override && override.trim() !== "" && fs.existsSync(override)) {
    return { command: override, source: "env-override" };
  }

  const findOptions: FindOptions = {
    env,
    platform,
    fs,
    extraDirs: options.extraDirs,
    wellKnownDirs: wellKnownPiDirs(env, platform),
  };
  return findExecutable(PI_BIN, findOptions);
}

/**
 * Extract a version number from `pi --version` output.
 * Handles plain versions ("0.99.2") and prefixed/decorated output.
 */
export function parseVersionProbe(output: string): string | null {
  const match = output.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0] : null;
}

export interface PiProbe {
  ok: boolean;
  version: string | null;
  rawOutput: string;
  error?: string;
}

/**
 * Run `pi --version` against a resolved command. This is the documented,
 * read-only way to verify an installation.
 */
export async function probePi(runner: ProcessRunner, command: string): Promise<PiProbe> {
  const result = await runner.capture(command, ["--version"]);
  if (result.spawnError) {
    return { ok: false, version: null, rawOutput: "", error: result.spawnError };
  }
  const combined = `${result.stdout}\n${result.stderr}`;
  const version = parseVersionProbe(combined);
  if (result.code !== 0 || version === null) {
    return {
      ok: false,
      version,
      rawOutput: combined.trim(),
      error: `exit code ${String(result.code)}`,
    };
  }
  return { ok: true, version, rawOutput: combined.trim() };
}
