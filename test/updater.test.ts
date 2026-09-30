import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { join, relative } from "node:path";
import type { CoreDeps } from "../src/core/ensure.js";
import { CognixError } from "../src/core/errors.js";
import { runUpdate } from "../src/core/updater.js";
import {
  cleanupTmpDir,
  FakeRunner,
  makeEnv,
  makeFakeOwnPackage,
  makeTmpDir,
  matchContaining,
  nodeFs,
  touch,
  writeJson,
} from "./helpers.js";

let tmp: string;

beforeEach(() => {
  tmp = makeTmpDir();
});

afterEach(() => {
  cleanupTmpDir(tmp);
});

function makeDeps(runner: FakeRunner) {
  const home = join(tmp, "home");
  const agentDir = join(tmp, "agent");
  const env = makeEnv(home, { PI_CODING_AGENT_DIR: agentDir });
  const piFile = join(tmp, "shim", process.platform === "win32" ? "pi.cmd" : "pi");
  touch(piFile);
  env.COGNIX_PI = piFile;
  const logs: string[] = [];
  const deps: CoreDeps = {
    runner,
    fs: nodeFs,
    env,
    platform: process.platform,
    log: (m) => void logs.push(m),
  };
  return { deps, agentDir, piFile, logs };
}

/** Version probes answer 0.99.1 first (pre-update) and 0.99.2 after. */
function versionProbesAscending(runner: FakeRunner): void {
  let count = 0;
  runner.addHandler({
    when: matchContaining("--version"),
    capture: () => ({ code: 0, stdout: count++ === 0 ? "0.99.1" : "0.99.2", stderr: "" }),
  });
}

describe("runUpdate", () => {
  test("happy path: pi self-update, gentle-pi update, cognix re-verified", async () => {
    const runner = new FakeRunner();
    const { deps, agentDir } = makeDeps(runner);
    const own = makeFakeOwnPackage(tmp);
    writeJson(join(agentDir, "settings.json"), {
      packages: ["npm:gentle-pi", relative(agentDir, own.rootDir)],
    });
    versionProbesAscending(runner);
    runner.onInteractive(matchContaining(), 0);

    const outcome = await runUpdate(deps, own);

    assert.equal(outcome.piBefore.version, "0.99.1");
    assert.equal(outcome.piAfterVersion, "0.99.2");
    assert.deepEqual(
      runner.callsMatching(matchContaining("update", "--self"))[0]?.args,
      ["update", "--self"],
    );
    assert.deepEqual(
      runner.callsMatching(matchContaining("update", "npm:gentle-pi"))[0]?.args,
      ["update", "npm:gentle-pi"],
    );
    assert.equal(outcome.gentlePi.action, "updated");
    assert.equal(outcome.cognix.action, "already-registered");
    assert.equal(outcome.verified.cognixRegistered, true);
  });

  test("pinned gentle-pi keeps its pin and reports it", async () => {
    const runner = new FakeRunner();
    const { deps, agentDir } = makeDeps(runner);
    const own = makeFakeOwnPackage(tmp);
    writeJson(join(agentDir, "settings.json"), {
      packages: ["npm:gentle-pi@3.7.0", relative(agentDir, own.rootDir)],
    });
    versionProbesAscending(runner);
    runner.onInteractive(matchContaining(), 0);

    const outcome = await runUpdate(deps, own);

    assert.equal(outcome.gentlePi.action, "pin-kept");
    assert.ok(outcome.notes.some((n) => n.includes("pinned to 3.7.0")));
    // no install call: the pin is respected, never silently replaced
    assert.equal(runner.callsMatching(matchContaining("install")).length, 0);
  });

  test("gentle-pi missing during update -> installed through pi", async () => {
    const runner = new FakeRunner();
    const { deps, agentDir } = makeDeps(runner);
    const own = makeFakeOwnPackage(tmp);
    const settingsPath = join(agentDir, "settings.json");
    writeJson(settingsPath, { packages: [relative(agentDir, own.rootDir)] });
    versionProbesAscending(runner);
    runner.onInteractive(matchContaining("npm:gentle-pi"), (command, args) => {
      assert.deepEqual(args, ["install", "npm:gentle-pi"]);
      return 0;
    });
    runner.onInteractive(matchContaining("update", "--self"), 0);

    const outcome = await runUpdate(deps, own);
    assert.equal(outcome.gentlePi.action, "installed");
  });

  test("gentle-ai present: upgrade via its own updater, then documented syncs", async () => {
    const runner = new FakeRunner();
    const { deps, agentDir } = makeDeps(runner);
    const own = makeFakeOwnPackage(tmp);
    writeJson(join(agentDir, "settings.json"), {
      packages: ["npm:gentle-pi", relative(agentDir, own.rootDir)],
    });
    const aiBin = join(tmp, "bin", process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai");
    touch(aiBin);
    deps.env.COGNIX_GENTLE_AI = aiBin;
    // Specific handler first: FakeRunner dispatches on the first match.
    runner.onCapture((command) => command === aiBin, { code: 0, stdout: "gentle-ai 3.7.0" });
    versionProbesAscending(runner);
    runner.onInteractive(matchContaining(), 0);

    const outcome = await runUpdate(deps, own);

    assert.equal(outcome.gentleAi.action, "upgraded");
    assert.deepEqual(outcome.gentleAi.beforeVersion, "3.7.0");
    const aiCalls = runner.interactiveCalls().filter((c) => c.command === aiBin);
    assert.deepEqual(aiCalls.map((c) => c.args), [["upgrade"], ["sync"], ["sync", "--agent", "pi"]]);
    assert.equal(outcome.gentleAi.syncAll, "ok");
    assert.equal(outcome.gentleAi.syncPi, "ok");
  });

  test("pin-kept gentle-pi: pi-scoped sync is not run (nothing changed)", async () => {
    const runner = new FakeRunner();
    const { deps, agentDir } = makeDeps(runner);
    const own = makeFakeOwnPackage(tmp);
    writeJson(join(agentDir, "settings.json"), {
      packages: ["npm:gentle-pi@3.7.0", relative(agentDir, own.rootDir)],
    });
    const aiBin = join(tmp, "bin", process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai");
    touch(aiBin);
    deps.env.COGNIX_GENTLE_AI = aiBin;
    runner.onCapture((command) => command === aiBin, { code: 0, stdout: "gentle-ai 3.7.0" });
    versionProbesAscending(runner);
    runner.onInteractive(matchContaining(), 0);

    const outcome = await runUpdate(deps, own);

    assert.equal(outcome.gentlePi.action, "pin-kept");
    const aiCalls = runner.interactiveCalls().filter((c) => c.command === aiBin);
    assert.deepEqual(aiCalls.map((c) => c.args), [["upgrade"], ["sync"]]);
  });

  test("gentle-ai upgrade failure degrades to notes, sync still attempted for pi changes", async () => {
    const runner = new FakeRunner();
    const { deps, agentDir } = makeDeps(runner);
    const own = makeFakeOwnPackage(tmp);
    writeJson(join(agentDir, "settings.json"), {
      packages: ["npm:gentle-pi", relative(agentDir, own.rootDir)],
    });
    const aiBin = join(tmp, "bin", process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai");
    touch(aiBin);
    deps.env.COGNIX_GENTLE_AI = aiBin;
    runner.onCapture((command) => command === aiBin, { code: 0, stdout: "gentle-ai 3.7.0" });
    versionProbesAscending(runner);
    runner.onInteractive((command, args) => command === aiBin && args[0] === "upgrade", 1);
    runner.onInteractive(matchContaining(), 0);

    const outcome = await runUpdate(deps, own);

    assert.equal(outcome.gentleAi.action, "upgrade-failed");
    assert.equal(outcome.gentleAi.syncAll, "skipped");
    assert.equal(outcome.gentleAi.syncPi, "ok");
    assert.ok(outcome.notes.some((n) => n.includes("gentle-ai upgrade")));
  });

  test("pi update --self failure aborts before touching packages", async () => {
    const runner = new FakeRunner();
    const { deps } = makeDeps(runner);
    const own = makeFakeOwnPackage(tmp);
    versionProbesAscending(runner);
    runner.onInteractive(matchContaining("update", "--self"), 1);

    await assert.rejects(
      () => runUpdate(deps, own),
      (error: unknown) => error instanceof CognixError && /pi update --self/.test(error.message),
    );
    assert.equal(runner.callsMatching(matchContaining("npm:gentle-pi")).length, 0);
  });

  test("stale cognix registration is repaired during update", async () => {
    const runner = new FakeRunner();
    const { deps, agentDir } = makeDeps(runner);
    const own = makeFakeOwnPackage(tmp);
    const oldRoot = join(tmp, "elsewhere", "cognix");
    writeJson(join(oldRoot, "package.json"), { name: "cognix" });
    versionProbesAscending(runner);
    const settingsPath = join(agentDir, "settings.json");
    writeJson(settingsPath, { packages: ["npm:gentle-pi", oldRoot] });
    runner.onInteractive(matchContaining("remove"), 0);
    runner.onInteractive(matchContaining("update"), 0);
    runner.onInteractive(matchContaining("install", own.rootDir), () => {
      // pi install rewrites settings; emulate it.
      writeJson(settingsPath, { packages: ["npm:gentle-pi", relative(agentDir, own.rootDir)] });
      return 0;
    });

    const outcome = await runUpdate(deps, own);

    assert.equal(outcome.cognix.action, "re-registered");
    assert.equal(outcome.verified.cognixRegistered, true);
  });
});
