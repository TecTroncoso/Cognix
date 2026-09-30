#!/usr/bin/env node
/**
 * Cognix isolated end-to-end check — opt-in, real, and self-cleaning.
 *
 *   npm run e2e
 *
 * What it does (all reversible):
 *   - points PI_CODING_AGENT_DIR at a fresh temporary agent home
 *   - neutralizes the real gentle-ai binary via a fake shim (scenario A) or
 *     a masked PATH + fake HOME (scenario B), so gentle-ai never mutates the
 *     real machine
 *   - runs the REAL bootstrap:  node dist/src/cli/bin.js -- --version
 *     (Pi itself installs/registers packages inside the temp home only)
 *   - runs it a second time to prove idempotency (zero installs, zero syncs)
 *   - verifies temp settings.json declarations and pass-through exit codes
 *   - removes every temporary artifact afterwards
 *
 * What it deliberately does NOT do:
 *   - touch your real ~/.pi or ~/.gentle-ai
 *   - run `cognix update` (that would update your global Pi)
 *   - install anything globally
 *
 * Skips cleanly when pi/npm or the npm registry are unavailable.
 */

import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const binJs = join(root, "dist", "src", "cli", "bin.js");
const isWin = process.platform === "win32";

const workDir = mkdtempSync(join(tmpdir(), "cognix-e2e-"));

function fail(message) {
  console.error(`e2e: FAIL: ${message}`);
  cleanup();
  process.exit(1);
}

function ok(message) {
  console.log(`e2e: ok: ${message}`);
}

function skip(message) {
  console.log(`e2e: SKIP: ${message}`);
  cleanup();
  process.exit(0);
}

function cleanup() {
  rmSync(workDir, { recursive: true, force: true });
  console.log("e2e: ok: temporary directories removed");
}

process.on("uncaughtException", (error) => {
  console.error(`e2e: FAIL: unexpected ${error.message}`);
  cleanup();
  process.exit(1);
});

/** Launch the built cognix CLI with node (a real binary; no shell needed). */
function runBin(args, env) {
  return spawnSync(process.execPath, [binJs, ...args], {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 600_000,
  });
}

/** Probe a CLI shim with a constant command line (never user input). */
function runProbe(commandLine, env) {
  return spawnSync(commandLine, {
    env,
    encoding: "utf8",
    shell: true, // resolves npm global .cmd shims on Windows
    windowsHide: true,
    timeout: 60_000,
  });
}

function readPackages(agentDir) {
  const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  return packages.map((p) => (typeof p === "string" ? p : p?.source)).filter(Boolean);
}

// --- preconditions -------------------------------------------------------------

if (!existsSync(binJs)) fail("dist build not found; run `npm run build` first");

const baseEnv = {
  ...process.env,
  GENTLE_PI_SKIP_GENTLE_AI_INSTALL: "1", // documented gentle-pi switch
};

const piProbe = runProbe("pi --version", baseEnv);
if (piProbe.error || piProbe.status !== 0) {
  skip("pi is not installed or not on PATH — nothing to verify against");
}
const piVersion = (piProbe.stdout || "").match(/\d+\.\d+\.\d+/)?.[0] ?? "unknown";
ok(`real pi found (${piVersion})`);

const npmProbe = runProbe("npm view gentle-pi version", baseEnv);
if (npmProbe.error || npmProbe.status !== 0) {
  skip("npm registry unreachable — network is required for this e2e");
}
const npmPrefix = runProbe("npm prefix -g", baseEnv);
if (npmProbe.status !== 0 || !npmPrefix.stdout?.trim()) {
  skip("cannot resolve the npm global prefix");
}
const npmBinDir = isWin ? npmPrefix.stdout.trim() : join(npmPrefix.stdout.trim(), "bin");

/**
 * A PATH that exposes pi + node only: the real gentle-ai binary (and Go,
 * which would really install it on Windows) must not leak into the child.
 */
function sandboxEnv(agentDir, extra = {}) {
  const fakeHome = join(workDir, "home");
  mkdirSync(fakeHome, { recursive: true });
  return {
    PATH: `${dirname(process.execPath)};${npmBinDir}`,
    COMSPEC: process.env.ComSpec ?? process.env.COMSPEC,
    SystemRoot: process.env.SystemRoot,
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    APPDATA: join(fakeHome, "AppData", "Roaming"),
    PI_CODING_AGENT_DIR: agentDir,
    GENTLE_PI_SKIP_GENTLE_AI_INSTALL: "1",
    ...extra,
  };
}

/** A throwaway gentle-ai shim that records invocations instead of running them. */
function makeFakeGentleAi(dir) {
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, "calls.log");
  let bin;
  if (isWin) {
    bin = join(dir, "gentle-ai.cmd");
    writeFileSync(
      bin,
      `@echo off\r\nif "%~1"=="--version" (\r\n  echo gentle-ai 9.9.9\r\n) else (\r\n  echo %*>> "${logFile}"\r\n)\r\nexit /b 0\r\n`,
    );
  } else {
    bin = join(dir, "gentle-ai");
    writeFileSync(
      bin,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "gentle-ai 9.9.9"\nelse\n  echo "$*" >> "${logFile}"\nfi\nexit 0\n`,
    );
    chmodSync(bin, 0o755);
  }
  return { bin, logFile };
}

// --- scenario A: full stack with a fake gentle-ai present ----------------------

const agentDirA = join(workDir, "agent-a");
const fakeAi = makeFakeGentleAi(join(workDir, "fake-ai"));
const envA = sandboxEnv(agentDirA, {
  COGNIX_GENTLE_AI: fakeAi.bin,
  COGNIX_E2E_FAKE_AI_LOG: fakeAi.logFile,
});

const first = runBin(["--", "--version"], envA);
if (first.status !== 0) {
  fail(`first run exited ${String(first.status)}\n${first.stderr}`);
}
const sourcesA = readPackages(agentDirA);
if (!sourcesA.some((s) => String(s) === "npm:gentle-pi" || String(s).startsWith("npm:gentle-pi@"))) {
  fail(`gentle-pi was not declared by Pi: ${JSON.stringify(sourcesA)}`);
}
if (!sourcesA.some((s) => resolve(agentDirA, String(s)) === root || String(s).includes("cognix"))) {
  fail(`cognix was not registered by Pi: ${JSON.stringify(sourcesA)}`);
}
if (!String(first.stdout).match(/\d+\.\d+\.\d+/)) {
  fail(`pi --version did not print a version via cognix: ${first.stdout}`);
}
ok(`bootstrap run completed; declarations: ${sourcesA.join(", ")}`);

// Windows batch %* forwards the quoted token stream; normalize before matching.
const syncLog = existsSync(fakeAi.logFile)
  ? readFileSync(fakeAi.logFile, "utf8").replace(/"/g, "")
  : "";
if (!syncLog.includes("sync --agent pi")) {
  fail(`gentle-pi install did not trigger the documented \`gentle-ai sync --agent pi\` (log: ${syncLog})`);
}
ok("gentle-ai sync --agent pi ran after the gentle-pi install");

const second = runBin(["--", "--version"], envA);
if (second.status !== 0) fail(`second run exited ${String(second.status)}\n${second.stderr}`);
if (/(^|\n)Installing /i.test(second.stderr || "") || /Installed npm:/i.test(second.stderr || "")) {
  fail("second run installed packages again — not idempotent");
}
const syncCalls = readFileSync(fakeAi.logFile, "utf8").split(/\r?\n/).filter(Boolean);
if (syncCalls.length !== 1) {
  fail(`idempotent re-run triggered ${syncCalls.length} syncs instead of 0 (log: ${syncCalls.join(" | ")})`);
}
const settingsA2 = readPackages(agentDirA);
if (JSON.stringify(settingsA2) !== JSON.stringify(sourcesA)) {
  fail("settings.json changed between identical runs — not idempotent");
}
ok("second run reused everything with zero installs and zero syncs");

const bogus = runBin(["--", "--definitely-not-a-pi-flag"], envA);
if (bogus.status === 0) fail("pi accepted a bogus flag — passthrough/exit-code check failed");
ok(`exit codes propagate (bogus pi flag -> exit ${String(bogus.status)})`);

// --- scenario B: no gentle-ai available anywhere -> degrade gracefully ---------

const agentDirB = join(workDir, "agent-b");
const envB = sandboxEnv(agentDirB); // no COGNIX_GENTLE_AI; masked PATH+HOME
const runB = runBin(["--", "--version"], envB);
if (runB.status !== 0) fail(`gentle-ai-less run exited ${String(runB.status)}\n${runB.stderr}`);
if (!(runB.stderr || "").includes("gentle-ai could not be installed")) {
  fail("missing gentle-ai was not surfaced as a clear warning");
}
const sourcesB = readPackages(agentDirB);
if (!sourcesB.some((s) => String(s).startsWith("npm:gentle-pi"))) {
  fail("core stack failed without gentle-ai");
}
ok("without gentle-ai the core Pi+gentle-pi stack still bootstraps and launches");

console.log("e2e: PASS");
cleanup();
