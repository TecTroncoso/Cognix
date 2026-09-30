/**
 * Cognix's own registration in Pi.
 *
 * Cognix is itself a Pi package (the npm package declares a `pi.extensions`
 * manifest). It is registered through the official local-path mechanism:
 *   pi install <absolute path to the cognix package>
 *
 * Pi loads local packages "from the resolved path without copying" and
 * identifies them by resolved absolute path, which gives us exactly the
 * desired properties: one copy of the code, no vendoring, and the loaded
 * extension always matches the installed CLI version.
 *
 * Verified behavior (Pi 0.87.1, isolated agent home):
 * - `pi install <abs path>` records the path (relativized from the
 *   settings file) and re-running it does not duplicate the entry.
 * - `pi remove <resolved path>` removes the declaration regardless of the
 *   recorded relative form.
 */

import { CognixError } from "./errors.js";
import type { FsLike } from "./fsLike.js";
import { COGNIX_PACKAGE_NAME } from "./info.js";
import {
  isPathSource,
  packageEntries,
  readPackageName,
  resolvePathSource,
  samePath,
  type PiSettings,
} from "./piConfig.js";
import type { OwnPackage } from "./meta.js";
import { ownExtensionEntrypoint } from "./meta.js";
import { runPiCommand } from "./piCommands.js";
import type { Platform } from "./platform.js";
import type { ProcessRunner } from "./process.js";

export interface CognixEntry {
  source: string;
  dir: string;
  exists: boolean;
}

export type CognixRegistration =
  | { kind: "registered"; source: string; dir: string; strays: CognixEntry[] }
  | { kind: "not-registered"; strays: CognixEntry[] };

export interface CognixInspectOptions {
  fs: FsLike;
  agentDir: string;
  env: NodeJS.ProcessEnv;
  platform: Platform;
}

function collectCognixEntries(
  settings: PiSettings,
  options: CognixInspectOptions,
): CognixEntry[] {
  const { fs, agentDir, env, platform } = options;
  const entries: CognixEntry[] = [];
  for (const source of packageEntries(settings)) {
    if (!isPathSource(source)) continue;
    const dir = resolvePathSource(source, agentDir, env, platform);
    const exists = fs.existsSync(dir);
    if (exists && readPackageName(fs, dir) === COGNIX_PACKAGE_NAME) {
      entries.push({ source, dir, exists });
    }
  }
  return entries;
}

/** Inspect how Cognix is registered with Pi relative to the running package. */
export function inspectCognix(
  settings: PiSettings,
  own: OwnPackage,
  options: CognixInspectOptions,
): CognixRegistration {
  const entries = collectCognixEntries(settings, options);
  const current = entries.find((entry) => samePath(entry.dir, own.rootDir, options.platform));
  const strays = entries.filter((entry) => !samePath(entry.dir, own.rootDir, options.platform));
  if (current) return { kind: "registered", source: current.source, dir: current.dir, strays };
  return { kind: "not-registered", strays };
}

export function describeCognixRegistration(registration: CognixRegistration): string {
  if (registration.kind === "registered") return `registered (${registration.dir})`;
  if (registration.strays.length > 0) {
    return `stale registration(s) pointing elsewhere: ${registration.strays.map((s) => s.source).join(", ")}`;
  }
  return "not registered";
}

export type CognixEnsureAction = "already-registered" | "registered" | "re-registered";

export interface CognixEnsureResult {
  action: CognixEnsureAction;
  registration: CognixRegistration;
}

/**
 * Register (or repair the registration of) the running Cognix package in
 * Pi. Idempotent: when the current package root is already declared and no
 * stale entries exist, nothing is executed.
 */
export async function ensureCognixRegistered(
  runner: ProcessRunner,
  piCommand: string,
  settings: PiSettings,
  own: OwnPackage,
  options: CognixInspectOptions,
): Promise<CognixEnsureResult> {
  const extensionEntry = ownExtensionEntrypoint(own.rootDir);
  if (!options.fs.existsSync(extensionEntry)) {
    throw new CognixError(
      `The Cognix extension build is missing at ${extensionEntry}.`,
      [
        "If this is a source checkout, run `npm install && npm run build` first.",
        "If cognix came from npm, reinstall it: npm install -g cognix",
      ],
    );
  }

  const registration = inspectCognix(settings, own, options);

  for (const stray of registration.strays) {
    // Remove by resolved absolute path; Pi matches local packages by identity.
    await runPiCommand(runner, piCommand, ["remove", stray.dir], "remove a stale cognix package");
  }

  if (registration.kind === "registered") {
    return { action: registration.strays.length > 0 ? "registered" : "already-registered", registration };
  }

  await runPiCommand(runner, piCommand, ["install", own.rootDir], "register cognix in Pi");
  return {
    action: registration.strays.length > 0 ? "re-registered" : "registered",
    registration,
  };
}

/**
 * Read-only verification used by `cognix update` and `cognix doctor`:
 * the running package is declared and its extension entry is on disk.
 */
export function verifyCognixRegistration(
  settings: PiSettings,
  own: OwnPackage,
  options: CognixInspectOptions,
): boolean {
  const registration = inspectCognix(settings, own, options);
  if (registration.kind !== "registered") return false;
  return options.fs.existsSync(ownExtensionEntrypoint(own.rootDir));
}
