/**
 * cognix CLI entry point.
 *
 * Routing:
 *   cognix [args…]      ensure Pi + gentle-pi + cognix, then run `pi <args>`
 *   cognix update       update Pi and gentle-pi via Pi's own mechanisms
 *   cognix doctor       read-only diagnostics of the whole integration
 *   cognix --help/-h    this help
 *   cognix --version/-v versions
 *   cognix -- [args…]   forward everything to pi verbatim
 *
 * Every unknown argument is forwarded to Pi unchanged: cognix is a thin
 * launcher, not a reimplementation.
 */

import { CognixError, errorMessage } from "../core/errors.js";
import { ensureReady, loadPiConfig, type CoreDeps } from "../core/ensure.js";
import {
  gentleAiScopeNote,
  inspectGentleAi,
  piRegisteredInGentleAi,
} from "../core/gentleAi.js";
import { describeGentlePiState, inspectGentlePi } from "../core/gentlePi.js";
import {
  COGNIX_GENTLE_AI_ENV,
  COGNIX_PI_ENV,
  PI_AGENT_DIR_ENV,
  PI_NPM_PACKAGE,
} from "../core/info.js";
import {
  describeCognixRegistration,
  inspectCognix,
} from "../core/cognixPackage.js";
import { ownExtensionEntrypoint, type OwnPackage } from "../core/meta.js";
import { runUpdate } from "../core/updater.js";
import { probePi, resolvePiExecutable } from "../core/piResolver.js";
import type { Io } from "./output.js";

export interface CliDeps extends CoreDeps {
  io: Io;
  own: OwnPackage | null;
}

const HELP_TEXT = `cognix — a Pi session with the Cognix layer and gentle-pi, managed end to end.

Usage:
  cognix [pi args…]        Start Pi (installs Pi and gentle-pi on first run)
  cognix update            Update Pi and gentle-pi via Pi's own mechanisms
  cognix doctor            Inspect the integration without changing anything
  cognix --help, -h        Show this help
  cognix --version, -v     Show cognix / pi / gentle-pi versions

Pass-through:
  Any argument cognix does not recognize is forwarded to pi unchanged
  (e.g. \`cognix --mode rpc\`, \`cognix -p "review src"\`, \`cognix -c\`).
  Use \`cognix -- <args…>\` to forward everything verbatim, including pi's
  own subcommands (\`cognix -- list\`, \`cognix -- update --extensions\`).

Environment:
  ${COGNIX_PI_ENV}              Explicit path to a pi executable
  ${COGNIX_GENTLE_AI_ENV}        Explicit path to a gentle-ai executable
  ${PI_AGENT_DIR_ENV}    Pi agent directory override (default: ~/.pi/agent)

Pi stays the runtime. Cognix only uses official mechanisms:
  npm install -g --ignore-scripts ${PI_NPM_PACKAGE}
  pi install npm:gentle-pi · pi update --self · pi update npm:gentle-pi
  gentle-ai install/upgrade/sync (only the documented gentle-ai channels)

Docs: https://pi.dev · https://github.com/Gentleman-Programming/gentle-shell
      https://github.com/Gentleman-Programming/gentle-ai`;

const UPDATE_HELP = `cognix update

Update the Cognix-managed stack using each project's own official mechanism:
  1. pi update --self            Pi updates itself
  2. pi update npm:gentle-pi     gentle-pi via Pi's package manager
     (a pinned npm:gentle-pi@x.y.z declaration is kept; installed if absent)
  3. gentle-ai upgrade           the gentle-ai binary updates itself
     (installed via its official channel when missing; Windows needs Go)
  4. gentle-ai sync              documented refresh of managed assets after
     upgrades, plus \`sync --agent pi\` when gentle-pi changed
  5. re-verify cognix is registered and loadable by Pi

Note: cognix itself updates via npm (npm install -g cognix); the Pi
registration follows automatically because it points at that package.`;

function isHelpFlag(arg: string): boolean {
  return arg === "-h" || arg === "--help" || arg === "help";
}

function isVersionFlag(arg: string): boolean {
  return arg === "-v" || arg === "--version";
}

async function printVersion(deps: CliDeps): Promise<number> {
  const { io } = deps;
  io.out(`cognix ${deps.own?.version ?? "unknown"}`);

  const resolution = resolvePiExecutable(deps);
  if (!resolution) {
    io.out("pi: not found");
  } else {
    const probe = await probePi(deps.runner, resolution.command);
    io.out(
      probe.ok && probe.version
        ? `pi: ${probe.version} (${resolution.command})`
        : `pi: found at ${resolution.command} but failed to run (${probe.error ?? "unknown"})`,
    );
  }

  try {
    const config = loadPiConfig(deps);
    const gentle = inspectGentlePi(config.settings, {
      fs: deps.fs,
      agentDir: config.agentDir,
      env: deps.env,
      platform: deps.platform,
    });
    io.out(`gentle-pi: ${describeGentlePiState(gentle)}`);
  } catch (error) {
    // --version must stay a harmless read-only command even with broken settings.
    io.out(`gentle-pi: unknown (settings unreadable: ${errorMessage(error)})`);
  }

  const gentleAi = await inspectGentleAi(deps);
  io.out(
    gentleAi.kind === "installed"
      ? `gentle-ai: ${gentleAi.version} (${gentleAi.command})`
      : "gentle-ai: not found (cognix installs it via its official channel on first run)",
  );
  return 0;
}

async function runDoctor(deps: CliDeps): Promise<number> {
  const { io } = deps;
  const lines: string[] = ["cognix doctor (read-only)", ""];

  lines.push(`platform: ${deps.platform} (${process.arch ?? "unknown arch"})`);
  lines.push(`node: ${process.version}`);
  lines.push(
    `cognix: ${deps.own ? `${deps.own.version} at ${deps.own.rootDir}` : "package root not found"}`,
  );
  if (deps.own) {
    lines.push(
      `cognix extension build: ${
        deps.fs.existsSync(ownExtensionEntrypoint(deps.own.rootDir)) ? "present" : "MISSING (run npm run build)"
      }`,
    );
  }

  const resolution = resolvePiExecutable(deps);
  if (!resolution) {
    lines.push("pi: not found (cognix would install it via npm on first run)");
  } else {
    const probe = await probePi(deps.runner, resolution.command);
    lines.push(
      probe.ok && probe.version
        ? `pi: ${probe.version} at ${resolution.command} (${resolution.source})`
        : `pi: found at ${resolution.command} but failed to run (${probe.error ?? "unknown"})`,
    );
  }

  const gentleAi = await inspectGentleAi(deps);
  lines.push(
    gentleAi.kind === "installed"
      ? `gentle-ai: ${gentleAi.version} at ${gentleAi.command}`
      : "gentle-ai: not found (see https://github.com/Gentleman-Programming/gentle-ai)",
  );
  if (gentleAi.kind === "installed") {
    lines.push(
      `gentle-ai pi scope: ${piRegisteredInGentleAi(deps) === true ? "recorded" : (gentleAiScopeNote(piRegisteredInGentleAi(deps)) ?? "unknown")}`,
    );
  } else {
    lines.push("gentle-ai sync: skipped (no binary)");
  }

  let settingsOk = true;
  try {
    const config = loadPiConfig(deps);
    lines.push(`agent dir: ${config.agentDir}`);
    lines.push(`settings: ${config.settingsPath}`);
    const gentle = inspectGentlePi(config.settings, {
      fs: deps.fs,
      agentDir: config.agentDir,
      env: deps.env,
      platform: deps.platform,
    });
    lines.push(`gentle-pi: ${describeGentlePiState(gentle)}`);
    if (deps.own) {
      const registration = inspectCognix(config.settings, deps.own, {
        fs: deps.fs,
        agentDir: config.agentDir,
        env: deps.env,
        platform: deps.platform,
      });
      lines.push(`cognix package: ${describeCognixRegistration(registration)}`);
    }
  } catch (error) {
    settingsOk = false;
    lines.push(`settings: ${errorMessage(error)}`);
  }

  for (const line of lines) io.out(line);
  return settingsOk ? 0 : 1;
}

function describeEnsureOutcome(deps: CliDeps, outcome: Awaited<ReturnType<typeof ensureReady>>): void {
  const { io } = deps;
  const parts: string[] = [];
  parts.push(`pi ${outcome.pi.version}${outcome.pi.installedNow ? " (installed just now)" : ""}`);
  parts.push(
    `gentle-pi ${outcome.gentlePi.action === "already-installed" ? "ok" : outcome.gentlePi.action}`,
  );
  parts.push(
    `cognix ${outcome.cognix.action === "already-registered" ? "ok" : outcome.cognix.action}`,
  );
  const ai = outcome.gentleAi;
  if (ai.action === "unavailable") {
    parts.push("gentle-ai unavailable");
  } else {
    const version = ai.version ?? "?";
    parts.push(`gentle-ai ${version}${ai.action === "installed" ? " (installed just now)" : " ok"}`);
  }
  io.log(`cognix: ${parts.join(" · ")} — starting pi`);
  for (const sync of ai.syncs) {
    if (!sync.ok) io.log(`cognix: gentle-ai sync (${sync.scope}) failed`);
    else io.log(`cognix: gentle-ai sync (${sync.scope}) ok`);
  }
  for (const note of outcome.notes) io.log(`cognix: note: ${note}`);
}

async function runPi(deps: CliDeps, forwardArgs: string[]): Promise<number> {
  const outcome = await ensureReady(deps, deps.own);
  describeEnsureOutcome(deps, outcome);
  return deps.runner.interactive(outcome.pi.resolution.command, forwardArgs);
}

function renderUpdateOutcome(deps: CliDeps, outcome: Awaited<ReturnType<typeof runUpdate>>): void {
  const { io } = deps;
  const { piBefore } = outcome;
  const same = piBefore.version === outcome.piAfterVersion;
  io.log(
    same
      ? `cognix: pi ${outcome.piAfterVersion} (already current)`
      : `cognix: pi ${piBefore.version} -> ${outcome.piAfterVersion}`,
  );
  io.log(`cognix: gentle-pi: ${describeGentlePiState(outcome.gentlePi.state)} (${outcome.gentlePi.action})`);
  const ai = outcome.gentleAi;
  const aiVersions = ai.beforeVersion
    ? ai.afterVersion && ai.beforeVersion !== ai.afterVersion
      ? `${ai.beforeVersion} -> ${ai.afterVersion}`
      : `${ai.beforeVersion}`
    : (ai.afterVersion ?? "not installed");
  io.log(
    `cognix: gentle-ai ${aiVersions} (${ai.action}; sync all: ${ai.syncAll}, sync pi: ${ai.syncPi})`,
  );
  io.log(`cognix: registration ${outcome.cognix.action}`);
  for (const note of outcome.notes) io.log(`cognix: note: ${note}`);
  if (!outcome.verified.cognixRegistered) {
    io.log("cognix: WARNING: post-update verification could not confirm the cognix registration.");
    io.log("cognix: run `cognix doctor` for details, or `cognix` to re-register.");
  }
}

/**
 * Parsed CLI entry. Returns the exit code; never calls process.exit so it
 * stays fully testable.
 */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const { io } = deps;
  const [first, ...rest] = argv;

  try {
    if (first === undefined) {
      return await runPi(deps, []);
    }
    if (isHelpFlag(first)) {
      io.out(HELP_TEXT);
      return 0;
    }
    if (isVersionFlag(first)) {
      return await printVersion(deps);
    }
    if (first === "doctor") {
      return await runDoctor(deps);
    }
    if (first === "update") {
      if (rest.some(isHelpFlag)) {
        io.out(UPDATE_HELP);
        return 0;
      }
      if (rest.length > 0) {
        throw new CognixError(`\`cognix update\` takes no arguments, got: ${rest.join(" ")}`, [
          "To reach pi's own update command directly: cognix -- update",
        ]);
      }
      const outcome = await runUpdate(deps, deps.own);
      renderUpdateOutcome(deps, outcome);
      return 0;
    }
    if (first === "--") {
      return await runPi(deps, rest);
    }
    // Unknown to cognix: forward everything to pi unchanged.
    return await runPi(deps, argv);
  } catch (error) {
    if (error instanceof CognixError) {
      io.error(`cognix: ${error.message}`);
      for (const hint of error.hints) io.error(`  - ${hint}`);
      return 1;
    }
    io.error(`cognix: unexpected error: ${errorMessage(error)}`);
    return 1;
  }
}
