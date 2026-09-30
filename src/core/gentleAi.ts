/**
 * gentle-ai (binary) integration — the Gentle-AI CLI that owns managed
 * assets (skills, personas, MCP configs, review runtime) across agents.
 *
 * Official mechanisms used (docs/quickstart.md, docs/usage.md, README):
 *
 *   Install the binary:
 *     macOS:             brew install gentleman-programming/tap/gentle-ai
 *     macOS/Linux:       curl -fsSL <repo>/main/scripts/install.sh | bash
 *     Windows:           go install <module>/v4/cmd/gentle-ai@latest
 *                        (`@latest` on /v4 only resolves after v4.0.0 is
 *                        published; until then the stable tag line is /v3 —
 *                        verified against proxy.golang.org)
 *
 *   Update the binary:   gentle-ai upgrade   (its own self-updater; on
 *                        Windows it delegates to a checksum-verified
 *                        `go install` of the release tag and fails closed
 *                        without Go)
 *
 *   Refresh managed assets after any gentle-ai/gentle-pi update:
 *     gentle-ai sync                  (documented verbatim post-upgrade step;
 *                                      syncs agents recorded in state.json)
 *     gentle-ai sync --agent pi       (documented way to target pi outside
 *                                      the stored selection)
 *
 * Cognix deliberately does NOT run `gentle-ai install --agent pi`: that
 * command selects persona/components/RDD on the user's behalf. Detection of
 * the pi scope is read from gentle-ai's documented state file
 * (~/.gentle-ai/state.json -> installed_agents) and surfaced as guidance.
 *
 * gentle-ai is an enhancement layer over the core Pi+gentle-pi stack: when
 * it is missing or cannot be installed (e.g. Windows without Go, where no
 * official binary channel exists today), Cognix warns and continues rather
 * than blocking the Pi session.
 */

import { join } from "node:path";
import { findExecutable } from "./finder.js";
import type { FsLike } from "./fsLike.js";
import {
  COGNIX_GENTLE_AI_ENV,
  GENTLE_AI_BIN,
  GENTLE_AI_BREW_FORMULA,
  GENTLE_AI_DOCS,
  GENTLE_AI_GO_MODULE_V3,
  GENTLE_AI_GO_MODULE_V4,
  GENTLE_AI_INSTALL_SCRIPT_URL,
} from "./info.js";
import { parseVersionProbe } from "./piResolver.js";
import { isWindows, resolveHome, type Platform } from "./platform.js";
import type { ProcessRunner } from "./process.js";

export interface GentleAiDeps {
  runner: ProcessRunner;
  fs: FsLike;
  env: NodeJS.ProcessEnv;
  platform: Platform;
  log: (message: string) => void;
}

export type GentleAiState =
  | { kind: "installed"; command: string; version: string }
  | { kind: "missing" };

function wellKnownGentleAiDirs(env: NodeJS.ProcessEnv, platform: Platform): string[] {
  const dirs: string[] = [];
  try {
    const home = resolveHome(env, platform);
    // `go install` target (GOBIN default) and common package-manager bins.
    dirs.push(join(home, "go", "bin"));
    if (!isWindows(platform)) {
      dirs.push("/usr/local/bin", "/opt/homebrew/bin", join(home, ".local", "bin"));
    }
  } catch {
    // Without a home directory, PATH is the only discovery mechanism.
  }
  return dirs;
}

/** Locate the gentle-ai binary (override -> PATH -> well-known). */
export function resolveGentleAi(deps: Pick<GentleAiDeps, "env" | "platform" | "fs">): string | null {
  const { env, platform, fs } = deps;
  const override = env[COGNIX_GENTLE_AI_ENV];
  if (override && override.trim() !== "" && fs.existsSync(override)) return override;
  const found = findExecutable(GENTLE_AI_BIN, {
    env,
    platform,
    fs,
    wellKnownDirs: wellKnownGentleAiDirs(env, platform),
  });
  return found?.command ?? null;
}

/** Verify the binary by running its documented version command. */
export async function probeGentleAi(
  runner: ProcessRunner,
  command: string,
): Promise<{ ok: boolean; version: string | null }> {
  const result = await runner.capture(command, ["--version"]);
  if (result.spawnError || result.code !== 0) return { ok: false, version: null };
  const version = parseVersionProbe(`${result.stdout}\n${result.stderr}`);
  return version ? { ok: true, version } : { ok: false, version: null };
}

/** Detect gentle-ai, verifying it actually runs. A broken binary is staged for repair. */
export async function inspectGentleAi(deps: GentleAiDeps): Promise<GentleAiState> {
  const override = deps.env[COGNIX_GENTLE_AI_ENV];
  const command = resolveGentleAi(deps);
  if (!command) return { kind: "missing" };
  const probe = await probeGentleAi(deps.runner, command);
  if (probe.ok && probe.version) return { kind: "installed", command, version: probe.version };
  if (override && override.trim() !== "") {
    // An explicit override that does not run must not silently fall through.
    deps.log(`cognix: ${COGNIX_GENTLE_AI_ENV} points at ${command} but it failed to run — ignoring it`);
    return { kind: "missing" };
  }
  deps.log(`cognix: gentle-ai at ${command} failed \`--version\`; treating it as missing`);
  return { kind: "missing" };
}

/** Read gentle-ai's own state file (documented location) for guidance notes. */
export function piRegisteredInGentleAi(deps: GentleAiDeps): boolean | "unknown" {
  try {
    const home = resolveHome(deps.env, deps.platform);
    const statePath = join(home, ".gentle-ai", "state.json");
    if (!deps.fs.existsSync(statePath)) return "unknown";
    const parsed: unknown = JSON.parse(deps.fs.readFileSync(statePath, "utf8"));
    const agents = (parsed as Record<string, unknown>).installed_agents;
    if (!Array.isArray(agents)) return "unknown";
    return agents.includes("pi");
  } catch {
    return "unknown";
  }
}

function installHints(): string[] {
  return [
    `macOS: brew install ${GENTLE_AI_BREW_FORMULA}`,
    `macOS/Linux: curl -fsSL ${GENTLE_AI_INSTALL_SCRIPT_URL} | bash`,
    `Windows (needs Go 1.25.10+): go install ${GENTLE_AI_GO_MODULE_V4}`,
    `Docs: ${GENTLE_AI_DOCS}`,
  ];
}

/**
 * Install the gentle-ai binary through the official channel for this
 * platform. Returns the verified command on success; null with a warning
 * note when installation is impossible or failed (never fatal: the core
 * Pi+gentle-pi stack keeps working).
 */
export async function installGentleAi(
  deps: GentleAiDeps,
): Promise<{ command: string; version: string } | null> {
  const { runner, env, platform, fs, log } = deps;

  const verify = async (): Promise<{ command: string; version: string } | null> => {
    const command = resolveGentleAi({ env, platform, fs });
    if (!command) return null;
    const probe = await probeGentleAi(runner, command);
    return probe.ok && probe.version ? { command, version: probe.version } : null;
  };

  const run = async (command: string, args: string[]): Promise<boolean> =>
    (await runner.interactive(command, args)) === 0;

  const noteFailure = (extra: string): null => {
    log(`cognix: WARNING: could not install gentle-ai automatically: ${extra}`);
    return null;
  };

  if (isWindows(platform)) {
    const go = findExecutable("go", { env, platform, fs });
    if (!go) {
      return noteFailure(
        "on Windows gentle-ai installs from source (`go install`), and Go is not on PATH.",
      );
    }
    log("Installing gentle-ai via the official go-install channel…");
    // Official command (v4 line); while v4.0.0 is unpublished `@latest`
    // cannot resolve there, so fall back to the stable /v3 line.
    const installed =
      (await run(go.command, ["install", GENTLE_AI_GO_MODULE_V4])) ||
      (await run(go.command, ["install", GENTLE_AI_GO_MODULE_V3]));
    if (!installed) return noteFailure("both official go install channels failed.");
    return (await verify()) ?? noteFailure("installed but `gentle-ai --version` still fails.");
  }

  if (platform === "darwin" || platform === "linux") {
    const brew = findExecutable("brew", { env, platform, fs });
    if (brew) {
      log("Installing gentle-ai via Homebrew (official tap)…");
      if (await run(brew.command, ["install", GENTLE_AI_BREW_FORMULA])) {
        return (await verify()) ?? noteFailure("brew install succeeded but gentle-ai does not run.");
      }
    }
    const bash = findExecutable("bash", { env, platform, fs });
    if (bash) {
      log("Installing gentle-ai via the official installer script…");
      // Constant, documented command line — no user input is interpolated.
      const script = `curl -fsSL ${GENTLE_AI_INSTALL_SCRIPT_URL} | bash`;
      if (await run(bash.command, ["-c", script])) {
        return (await verify()) ?? noteFailure("installer finished but gentle-ai does not run.");
      }
    }
    return noteFailure("no supported channel available (brew, bash+curl).");
  }

  return noteFailure(`unsupported platform ${platform}.`);
}

/** gentle-ai's own self-updater (documented). Returns a user-facing note. */
export async function upgradeGentleAi(
  deps: GentleAiDeps,
  command: string,
): Promise<{ upgraded: boolean; notes: string[] }> {
  const { runner, log } = deps;
  log("Updating gentle-ai via its own updater (gentle-ai upgrade)…");
  const code = await runner.interactive(command, ["upgrade"]);
  if (code !== 0) {
    return {
      upgraded: false,
      notes: [
        `\`gentle-ai upgrade\` exited ${String(code)}.`,
        ...installHints(),
        "On Windows, gentle-ai upgrades itself via go install and needs Go on PATH.",
      ],
    };
  }
  return { upgraded: true, notes: [] };
}

/**
 * Run `gentle-ai sync`, the documented post-update refresh of managed
 * assets. Scope:
 *  - "all": plain sync (recorded agent selection) — the canonical step after
 *    upgrading/replacing the gentle-ai binary.
 *  - "pi":  sync --agent pi — the documented way to target pi explicitly,
 *    after gentle-pi installs/updates.
 *
 * A failed sync is reported, not fatal.
 */
export async function syncGentleAi(
  deps: GentleAiDeps,
  command: string,
  scope: "all" | "pi",
): Promise<string | null> {
  const args = scope === "pi" ? ["sync", "--agent", "pi"] : ["sync"];
  const code = await deps.runner.interactive(command, args);
  if (code !== 0) {
    return `\`gentle-ai ${args.join(" ")}\` exited ${String(code)} — run it manually to see why`;
  }
  return null;
}

/** Hints shown when gentle-ai is present but pi is not in its install scope. */
export function gentleAiScopeNote(scope: boolean | "unknown"): string | null {
  if (scope === true) return null;
  return (
    "gentle-ai does not record pi as a managed agent yet (state.json), or its state is unreadable. " +
    "Cognix syncs pi assets with `gentle-ai sync --agent pi`; to let gentle-ai fully manage Pi " +
    "(package stack, persona, components), run `gentle-ai install --agent pi` once yourself."
  );
}
