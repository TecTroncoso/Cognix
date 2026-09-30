/**
 * `cognix update` orchestration.
 *
 * Delegation contract:
 * - Pi updates itself:           pi update --self     (official mechanism;
 *   npm- or installer-managed internally — Cognix does not care which).
 * - gentle-pi updates:           pi update npm:gentle-pi, or install when
 *                                missing. Pins and path checkouts respected.
 * - Cognix's Pi registration:    re-verified after the update; path
 *   registrations are not managed by `pi update`, but a relocated npm
 *   prefix or a stale entry is repaired here.
 *
 * Cognix never downloads or copies Pi into its own repo, and never runs a
 * parallel update mechanism.
 */

import { CognixError } from "./errors.js";
import {
  ensurePiPresent,
  inspectOptions,
  loadPiConfig,
  type CoreDeps,
  type PiReady,
} from "./ensure.js";
import {
  describeGentlePiState,
  updateGentlePi,
  type GentlePiUpdateResult,
} from "./gentlePi.js";
import {
  ensureCognixRegistered,
  verifyCognixRegistration,
  type CognixEnsureResult,
} from "./cognixPackage.js";
import {
  gentleAiScopeNote,
  inspectGentleAi,
  installGentleAi,
  piRegisteredInGentleAi,
  probeGentleAi,
  syncGentleAi,
  upgradeGentleAi,
} from "./gentleAi.js";
import type { OwnPackage } from "./meta.js";
import { probePi } from "./piResolver.js";

export interface GentleAiUpdateOutcome {
  action: "upgraded" | "installed" | "upgrade-failed" | "unavailable";
  beforeVersion: string | null;
  afterVersion: string | null;
  syncAll: "ok" | "failed" | "skipped";
  syncPi: "ok" | "failed" | "skipped";
}

export interface UpdateOutcome {
  piBefore: PiReady;
  piAfterVersion: string;
  gentlePi: GentlePiUpdateResult;
  gentleAi: GentleAiUpdateOutcome;
  cognix: CognixEnsureResult;
  verified: {
    piRuns: boolean;
    cognixRegistered: boolean;
    gentlePiState: string;
  };
  notes: string[];
}

export async function runUpdate(deps: CoreDeps, own: OwnPackage | null): Promise<UpdateOutcome> {
  const { runner, log } = deps;
  if (!own) {
    throw new CognixError("Cognix could not locate its own installed package.", [
      "Reinstall with: npm install -g cognix",
    ]);
  }

  // 1. Pi must exist; if it does not, installing it is the honest update.
  const piBefore = await ensurePiPresent(deps);

  // 2. Pi's official self-update.
  log(`Updating Pi (pi update --self)…  current: ${piBefore.version}`);
  const selfUpdateCode = await runner.interactive(piBefore.resolution.command, [
    "update",
    "--self",
  ]);
  if (selfUpdateCode !== 0) {
    throw new CognixError(`\`pi update --self\` failed (exit ${String(selfUpdateCode)}).`, [
      "Run `pi update --self` directly to see Pi's own diagnostics.",
      "Network or npm prefix permission problems are the usual cause.",
    ]);
  }

  const probe = await probePi(runner, piBefore.resolution.command);
  if (!probe.ok || !probe.version) {
    throw new CognixError(
      `"pi update --self" completed, but \`pi --version\` fails now (${probe.error ?? "unknown"}).`,
      [
        "Check the installation with `pi --version`.",
        "Worst case, reinstall: npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
      ],
    );
  }

  // 3. gentle-pi via Pi's package mechanism (settings re-read first, since
  //    Pi may have rewritten the file during the self-update).
  const configBeforeGentle = loadPiConfig(deps);
  const { agentDir } = configBeforeGentle;
  const options = inspectOptions(deps, agentDir);
  log("Checking gentle-pi via Pi's package manager…");
  const gentlePi = await updateGentlePi(
    runner,
    piBefore.resolution.command,
    configBeforeGentle.settings,
    options,
  );

  // 4. gentle-ai: ensure its binary, upgrade it through its own updater,
  //    then run the documented sync steps.
  const gentlePiChanged =
    gentlePi.action === "installed" ||
    gentlePi.action === "updated" ||
    gentlePi.action === "repaired-broken-declaration";
  const gentleAi = await updateGentleAiLayer(deps, gentlePiChanged);

  // 5. Cognix registration must still be valid after all updates.
  const configBeforeCognix = loadPiConfig(deps);
  const cognix = await ensureCognixRegistered(
    runner,
    piBefore.resolution.command,
    configBeforeCognix.settings,
    own,
    options,
  );

  // 6. Post-update verification, read-only, against the current settings.
  const configAfter = loadPiConfig(deps);
  const cognixRegistered = verifyCognixRegistration(configAfter.settings, own, options);

  return {
    piBefore,
    piAfterVersion: probe.version,
    gentlePi,
    gentleAi,
    cognix,
    verified: {
      piRuns: true,
      cognixRegistered,
      gentlePiState: describeGentlePiState(gentlePi.state),
    },
    notes: [...gentlePi.notes, ...gentleAi.notes],
  };
}

/**
 * gentle-ai side of `cognix update`: upgrade the binary through its own
 * updater (or install it via its official channel when missing) and then
 * sync — plain sync after binary changes (documented post-upgrade step),
 * plus the pi-scoped sync when gentle-pi changed. Every gentle-ai failure
 * degrades to a note: the Pi+gentle-pi core stays usable.
 */
async function updateGentleAiLayer(
  deps: CoreDeps,
  gentlePiChanged: boolean,
): Promise<{ action: GentleAiUpdateOutcome["action"]; beforeVersion: string | null; afterVersion: string | null; syncAll: "ok" | "failed" | "skipped"; syncPi: "ok" | "failed" | "skipped"; notes: string[] }> {
  const notes: string[] = [];
  let syncAll: GentleAiUpdateOutcome["syncAll"] = "skipped";
  let syncPi: GentleAiUpdateOutcome["syncPi"] = "skipped";

  const before = await inspectGentleAi(deps);
  let command: string | null = before.kind === "installed" ? before.command : null;
  let action: GentleAiUpdateOutcome["action"];
  const beforeVersion = before.kind === "installed" ? before.version : null;

  if (before.kind === "missing") {
    deps.log("cognix: gentle-ai not found — installing it via the official channel…");
    const installed = await installGentleAi(deps);
    if (!installed) {
      notes.push("gentle-ai could not be installed automatically; see the hints above.");
      return { action: "unavailable", beforeVersion: null, afterVersion: null, syncAll, syncPi, notes };
    }
    action = "installed";
    command = installed.command;
  } else {
    const upgrade = await upgradeGentleAi(deps, before.command);
    notes.push(...upgrade.notes);
    action = upgrade.upgraded ? "upgraded" : "upgrade-failed";
  }

  // Final state of the binary after install/upgrade.
  const probe = command ? await probeGentleAi(deps.runner, command) : { ok: false, version: null };
  const afterVersion = probe.version;
  const usable = command !== null && (probe.ok || action === "upgraded" || action === "installed");

  if (usable && command) {
    if (action === "upgraded" || action === "installed") {
      // Documented: after any upgrade or binary replacement, run plain sync.
      const failure = await syncGentleAi(deps, command, "all");
      syncAll = failure === null ? "ok" : "failed";
      if (failure) notes.push(failure);
    }
    if (gentlePiChanged) {
      // Documented pi-scoped sync after gentle-pi installs/updates.
      const failure = await syncGentleAi(deps, command, "pi");
      syncPi = failure === null ? "ok" : "failed";
      if (failure) notes.push(failure);
    }
    const scopeNote = gentleAiScopeNote(piRegisteredInGentleAi(deps));
    if (scopeNote) notes.push(scopeNote);
  }

  return { action, beforeVersion, afterVersion, syncAll, syncPi, notes };
}
