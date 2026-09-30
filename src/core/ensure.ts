/**
 * Boot orchestration shared by `cognix` and `cognix update`.
 *
 * Responsibility split:
 * - detection  : piResolver / npm / piConfig (what exists, where)
 * - install    : npm (Pi), gentlePi.ensure, cognixPackage.ensure
 * - everything durable goes through Pi's or npm's official commands
 */

import { CognixError } from "./errors.js";
import type { FsLike } from "./fsLike.js";
import {
  gentleAiScopeNote,
  inspectGentleAi,
  installGentleAi,
  piRegisteredInGentleAi,
  syncGentleAi,
} from "./gentleAi.js";
import { ensureGentlePi, type GentlePiActionResult, type GentlePiInspectOptions } from "./gentlePi.js";
import { COGNIX_PI_ENV, PI_INSTALLER_HINT, PI_NPM_PACKAGE } from "./info.js";
import {
  ensureCognixRegistered,
  type CognixEnsureResult,
  type CognixInspectOptions,
} from "./cognixPackage.js";
import type { OwnPackage } from "./meta.js";
import { installPiGlobally, npmSiblingDir, resolveNpmExecutable } from "./npm.js";
import { readPiSettings, resolveAgentDir, type PiSettings } from "./piConfig.js";
import {
  probePi,
  resolvePiExecutable,
  type PiResolution,
} from "./piResolver.js";
import type { Platform } from "./platform.js";
import type { ProcessRunner } from "./process.js";

export interface CoreDeps {
  runner: ProcessRunner;
  fs: FsLike;
  env: NodeJS.ProcessEnv;
  platform: Platform;
  /** Progress output; MUST be stderr in production so pi's stdout stays clean. */
  log: (message: string) => void;
}

export interface PiReady {
  resolution: PiResolution;
  version: string;
  installedNow: boolean;
}

/**
 * Resolve a working Pi, installing it globally through npm when absent.
 * Re-resolution after install scans the npm directory as an extra
 * candidate so freshly installed shims are found even before PATH changes
 * propagate.
 */
export async function ensurePiPresent(deps: CoreDeps): Promise<PiReady> {
  const { runner, fs, env, platform, log } = deps;

  const existing = resolvePiExecutable({ env, platform, fs });
  if (existing) {
    const probe = await probePi(runner, existing.command);
    if (probe.ok && probe.version) {
      return { resolution: existing, version: probe.version, installedNow: false };
    }
    const overrideNote = env[COGNIX_PI_ENV]
      ? `${COGNIX_PI_ENV} is set to "${env[COGNIX_PI_ENV]}". Fix or unset it.`
      : "If this installation is broken, reinstall it, then run cognix again.";
    throw new CognixError(
      `Found pi at ${existing.command} but it failed to run (${probe.error ?? "unknown error"}).`,
      [
        `Probe output: ${probe.rawOutput || "(empty)"}`,
        overrideNote,
        `Reinstall with: npm install -g --ignore-scripts ${PI_NPM_PACKAGE}`,
      ],
    );
  }

  log(`Pi was not found. Installing ${PI_NPM_PACKAGE} globally with npm…`);
  const npm = resolveNpmExecutable({ env, platform, fs });
  if (!npm) {
    throw new CognixError(
      "npm is required to install Pi, but npm was not found on this system.",
      [
        "Install Node.js 22.19 or newer (npm ships with it).",
        `macOS/Linux alternative: ${PI_INSTALLER_HINT}`,
        "Then run cognix again.",
      ],
    );
  }
  await installPiGlobally(runner, npm.command);

  const installed = resolvePiExecutable({
    env,
    platform,
    fs,
    extraDirs: [npmSiblingDir(npm.command)],
  });
  if (!installed) {
    throw new CognixError(
      "npm reported a successful install, but the pi executable could not be found afterwards.",
      [
        "Open a new terminal (PATH changes need it) and run cognix again.",
        `Or point cognix at it explicitly with ${COGNIX_PI_ENV}.`,
      ],
    );
  }
  const probe = await probePi(runner, installed.command);
  if (!probe.ok || !probe.version) {
    throw new CognixError(
      `Pi was installed at ${installed.command} but \`pi --version\` failed (${probe.error ?? "unknown error"}).`,
      ["Try running `pi --version` yourself to see the underlying error."],
    );
  }
  return { resolution: installed, version: probe.version, installedNow: true };
}

/** Agent dir + settings, with a hard stop on malformed configuration. */
export function loadPiConfig(deps: CoreDeps): {
  agentDir: string;
  settings: PiSettings;
  settingsPath: string;
} {
  const { fs, env, platform } = deps;
  const agentDir = resolveAgentDir(env, platform);
  const state = readPiSettings(fs, agentDir);
  if (state.kind === "malformed") {
    throw new CognixError(`Pi settings at ${state.path} are not valid JSON: ${state.error}`, [
      "Pi will refuse a malformed settings file, so Cognix stops here instead of guessing.",
      "Fix or remove that file (it is safe to keep a backup), then run cognix again.",
    ]);
  }
  return {
    agentDir,
    settings: state.kind === "ok" ? state.settings : {},
    settingsPath: state.path,
  };
}

export interface GentleAiOutcome {
  action: "already-installed" | "installed" | "unavailable";
  command: string | null;
  version: string | null;
  /** "pi" scope sync after gentle-pi installs/repairs; full sync after gentle-ai installs. */
  syncs: { scope: "pi" | "all"; ok: boolean }[];
}

export interface EnsureOutcome {
  pi: PiReady;
  agentDir: string;
  settingsPath: string;
  gentlePi: GentlePiActionResult;
  cognix: CognixEnsureResult;
  gentleAi: GentleAiOutcome;
  /** Notes the CLI should surface, e.g. follow-up guidance. */
  notes: string[];
}

export function inspectOptions(
  deps: CoreDeps,
  agentDir: string,
): GentlePiInspectOptions & CognixInspectOptions {
  return { fs: deps.fs, agentDir, env: deps.env, platform: deps.platform };
}

/**
 * Full `cognix` bootstrap: Pi present, gentle-pi declared, cognix
 * registered. Safe to run on every invocation: every step is delegated to
 * Pi/npm and idempotent, and no state is written when nothing is missing.
 */
export async function ensureReady(deps: CoreDeps, own: OwnPackage | null): Promise<EnsureOutcome> {
  if (!own) {
    throw new CognixError("Cognix could not locate its own installed package.", [
      "This usually means a broken installation.",
      "Reinstall with: npm install -g cognix",
    ]);
  }

  const pi = await ensurePiPresent(deps);
  const { agentDir, settings, settingsPath } = loadPiConfig(deps);
  const options = inspectOptions(deps, agentDir);

  const gentlePi = await ensureGentlePi(deps.runner, pi.resolution.command, settings, options);
  const cognix = await ensureCognixRegistered(
    deps.runner,
    pi.resolution.command,
    settings,
    own,
    options,
  );

  // gentle-ai: optional-but-managed layer. Never blocks the core stack.
  const notes: string[] = [];
  const gentleAi = await ensureGentleAiLayer(deps, gentlePi.action, notes);

  return { pi, agentDir, settingsPath, gentlePi, cognix, gentleAi, notes };
}

/**
 * Ensure the gentle-ai binary (official channels only) and run the
 * documented sync after gentle-pi installs/repairs or a fresh binary
 * install. gentle-ai problems degrade to notes — Pi + gentle-pi remain
 * usable without it.
 */
export async function ensureGentleAiLayer(
  deps: CoreDeps,
  gentlePiAction: string,
  notes: string[],
): Promise<GentleAiOutcome> {
  const { log } = deps;
  const syncs: GentleAiOutcome["syncs"] = [];

  let state = await inspectGentleAi(deps);
  let action: GentleAiOutcome["action"] = "already-installed";

  if (state.kind === "missing") {
    log("cognix: gentle-ai not found — installing it via the official channel…");
    const installed = await installGentleAi(deps);
    if (installed) {
      action = "installed";
      state = { kind: "installed", ...installed };
    } else {
      notes.push("gentle-ai could not be installed automatically; see the hints above. Continuing without it.");
      return { action: "unavailable", command: null, version: null, syncs };
    }
  }

  const command = state.command;
  const scopeNote = gentleAiScopeNote(piRegisteredInGentleAi(deps));
  if (scopeNote) notes.push(scopeNote);

  // Documented sync triggers (both idempotent):
  const gentlePiChanged = gentlePiAction === "installed" || gentlePiAction === "repaired-broken-declaration";
  if (action === "installed") {
    const failure = await syncGentleAi(deps, command, "all");
    syncs.push({ scope: "all", ok: failure === null });
    if (failure) notes.push(failure);
  }
  if (gentlePiChanged) {
    const failure = await syncGentleAi(deps, command, "pi");
    syncs.push({ scope: "pi", ok: failure === null });
    if (failure) notes.push(failure);
  }

  return { action, command, version: state.kind === "installed" ? state.version : null, syncs };
}
