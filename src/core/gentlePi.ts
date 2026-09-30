/**
 * gentle-pi integration.
 *
 * Official mechanism (gentle-shell "Path B" documentation): gentle-pi is a
 * Pi package, installed and updated through Pi's own package commands:
 *   pi install npm:gentle-pi
 *   pi update  npm:gentle-pi
 *
 * Pi identifies an npm package by its name, so detection matches the
 * `npm:gentle-pi[@version]` declaration shape. Development checkouts
 * installed by path are recognized by the package.json name, matching how
 * the official ecosystem recognizes them.
 *
 * Verified behavior (Pi 0.87.1, isolated agent home):
 * - `pi install npm:gentle-pi` records the unpinned declaration and
 *   installs the current release.
 * - A pinned declaration (`npm:gentle-pi@x.y.z`) is respected by
 *   `pi update npm:gentle-pi`: the pin is not moved. Cognix reports the
 *   pin instead of silently overriding it.
 */

import type { FsLike } from "./fsLike.js";
import { GENTLE_PI_NPM_SOURCE, GENTLE_PI_PACKAGE_NAME } from "./info.js";
import {
  isPathSource,
  packageEntries,
  parseNpmSource,
  readPackageName,
  resolvePathSource,
  type PiSettings,
} from "./piConfig.js";
import { runPiCommand } from "./piCommands.js";
import type { Platform } from "./platform.js";
import type { ProcessRunner } from "./process.js";

export type GentlePiState =
  | { kind: "absent" }
  | { kind: "npm"; source: string; pin: string | null }
  | { kind: "path"; source: string; dir: string }
  | { kind: "broken-path"; source: string; dir: string };

export interface GentlePiInspectOptions {
  fs: FsLike;
  agentDir: string;
  env: NodeJS.ProcessEnv;
  platform: Platform;
}

/**
 * A missing path declaration cannot be attributed by reading its
 * package.json (the directory is gone). Only treat it as a stale gentle-pi
 * entry when the resolved path is unambiguous: its own directory name must
 * be `gentle-pi`/`gentle-shell` (pnpm/npm-managed installs and the usual
 * checkout folder names). Anything else belongs to another package and is
 * left untouched.
 */
function looksLikeGentlePiPath(dir: string): boolean {
  const hints = new Set([GENTLE_PI_PACKAGE_NAME, "gentle-shell"]);
  return dir
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => hints.has(segment.toLowerCase()));
}

/** Determine which gentle-pi declaration, if any, Pi will load. */
export function inspectGentlePi(
  settings: PiSettings,
  options: GentlePiInspectOptions,
): GentlePiState {
  const { fs, agentDir, env, platform } = options;
  let broken: GentlePiState | null = null;

  for (const source of packageEntries(settings)) {
    const npm = parseNpmSource(source);
    if (npm) {
      if (npm.name === GENTLE_PI_PACKAGE_NAME) return { kind: "npm", source, pin: npm.pin };
      continue;
    }
    if (!isPathSource(source)) continue;
    const dir = resolvePathSource(source, agentDir, env, platform);
    if (fs.existsSync(dir)) {
      if (readPackageName(fs, dir) === GENTLE_PI_PACKAGE_NAME) {
        return { kind: "path", source, dir };
      }
    } else if (broken === null && looksLikeGentlePiPath(dir)) {
      broken = { kind: "broken-path", source, dir };
    }
  }
  return broken ?? { kind: "absent" };
}

export function describeGentlePiState(state: GentlePiState): string {
  switch (state.kind) {
    case "absent":
      return "not installed";
    case "npm":
      return state.pin ? `${state.source} (pinned)` : `${state.source} (latest)`;
    case "path":
      return `path package at ${state.dir}`;
    case "broken-path":
      return `broken path declaration ${state.source} -> ${state.dir} (missing)`;
  }
}

export type GentlePiEnsureAction = "already-installed" | "installed" | "repaired-broken-declaration";

export interface GentlePiActionResult {
  action: GentlePiEnsureAction;
  state: GentlePiState;
}

const GENTLE_PI_HINTS = [
  "See https://github.com/Gentleman-Programming/gentle-shell for gentle-pi details.",
];

/**
 * Make sure Pi has a gentle-pi declaration, installing it through Pi's
 * official package manager when missing. Idempotent by design.
 */
export async function ensureGentlePi(
  runner: ProcessRunner,
  piCommand: string,
  settings: PiSettings,
  options: GentlePiInspectOptions,
): Promise<GentlePiActionResult> {
  const state = inspectGentlePi(settings, options);

  switch (state.kind) {
    case "npm":
    case "path":
      return { action: "already-installed", state };
    case "broken-path":
      await runPiCommand(runner, piCommand, ["remove", state.dir], "remove a stale package", GENTLE_PI_HINTS);
      await runPiCommand(runner, piCommand, ["install", GENTLE_PI_NPM_SOURCE], "install gentle-pi", GENTLE_PI_HINTS);
      return { action: "repaired-broken-declaration", state };
    case "absent":
      await runPiCommand(runner, piCommand, ["install", GENTLE_PI_NPM_SOURCE], "install gentle-pi", GENTLE_PI_HINTS);
      return { action: "installed", state };
  }
}

export type GentlePiUpdateAction =
  | "not-installed"
  | "updated"
  | "installed"
  | "pin-kept"
  | "external-checkout"
  | "repaired-broken-declaration";

export interface GentlePiUpdateResult {
  action: GentlePiUpdateAction;
  state: GentlePiState;
  /** Extra user-facing notes, e.g. pin information. */
  notes: string[];
}

/**
 * Update gentle-pi through Pi's official mechanisms:
 * - npm declarations: `pi update npm:gentle-pi`.
 * - pins are respected (documented + verified); Cognix informs instead of
 *   overriding another tool's reproducibility decision.
 * - path declarations are development checkouts, left untouched.
 * - absence: `pi install npm:gentle-pi` (same "install if missing" policy
 *   as the main flow).
 */
export async function updateGentlePi(
  runner: ProcessRunner,
  piCommand: string,
  settings: PiSettings,
  options: GentlePiInspectOptions,
): Promise<GentlePiUpdateResult> {
  const state = inspectGentlePi(settings, options);
  const notes: string[] = [];

  switch (state.kind) {
    case "absent":
      await runPiCommand(runner, piCommand, ["install", GENTLE_PI_NPM_SOURCE], "install gentle-pi", GENTLE_PI_HINTS);
      return { action: "installed", state, notes };

    case "broken-path":
      await runPiCommand(runner, piCommand, ["remove", state.dir], "remove a stale package", GENTLE_PI_HINTS);
      await runPiCommand(runner, piCommand, ["install", GENTLE_PI_NPM_SOURCE], "install gentle-pi", GENTLE_PI_HINTS);
      return { action: "repaired-broken-declaration", state, notes };

    case "path":
      notes.push(
        `gentle-pi is a path package (${state.dir}); Pi does not manage path packages.`,
        "Update that checkout directly if you own it.",
      );
      return { action: "external-checkout", state, notes };

    case "npm": {
      await runPiCommand(runner, piCommand, ["update", GENTLE_PI_NPM_SOURCE], "update gentle-pi", GENTLE_PI_HINTS);
      if (state.pin) {
        notes.push(
          `gentle-pi is pinned to ${state.pin} in Pi settings; Pi respected the pin and did not move it.`,
          `To move to the latest release, run: pi install ${GENTLE_PI_NPM_SOURCE}`,
        );
        return { action: "pin-kept", state, notes };
      }
      return { action: "updated", state, notes };
    }
  }
}
