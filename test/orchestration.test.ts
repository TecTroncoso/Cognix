import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { join, relative } from "node:path";
import { ensureReady, loadPiConfig, type CoreDeps } from "../src/core/ensure.js";
import { CognixError } from "../src/core/errors.js";
import { PI_NPM_PACKAGE } from "../src/core/info.js";
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

interface World {
  deps: CoreDeps;
  agentDir: string;
  home: string;
  logs: string[];
}

function makeWorld(runner: FakeRunner, envExtra: Record<string, string> = {}): World {
  const home = join(tmp, "home");
  const agentDir = join(tmp, "agent");
  const env = makeEnv(home, { PI_CODING_AGENT_DIR: agentDir, ...envExtra });
  const logs: string[] = [];
  const deps: CoreDeps = {
    runner,
    fs: nodeFs,
    env,
    platform: process.platform,
    log: (message) => {
      logs.push(message);
    },
  };
  return { deps, agentDir, home, logs };
}

/** Wire a fake pi shim on disk plus a successful `--version` probe. */
function fakeInstalledPi(runner: FakeRunner, world: World, version = "0.99.2"): string {
  const piFile = join(tmp, "shim", process.platform === "win32" ? "pi.cmd" : "pi");
  touch(piFile);
  world.deps.env.COGNIX_PI = piFile;
  runner.onCapture(matchContaining("--version"), { code: 0, stdout: version });
  return piFile;
}

describe("ensureReady", () => {
  test("everything already in place: zero external mutations", async () => {
    const runner = new FakeRunner();
    const world = makeWorld(runner);
    const piFile = fakeInstalledPi(runner, world);
    const own = makeFakeOwnPackage(tmp);
    writeJson(join(world.agentDir, "settings.json"), {
      packages: ["npm:gentle-pi", relative(world.agentDir, own.rootDir)],
    });

    const outcome = await ensureReady(world.deps, own);

    assert.equal(outcome.pi.installedNow, false);
    assert.equal(outcome.pi.version, "0.99.2");
    assert.equal(outcome.pi.resolution.command, piFile);
    assert.equal(outcome.gentlePi.action, "already-installed");
    assert.equal(outcome.cognix.action, "already-registered");
    assert.equal(runner.interactiveCalls().length, 0);
  });

  test("fresh machine: installs pi via npm, then gentle-pi, then registers cognix", async () => {
    const npmDir = join(tmp, "npm-prefix");
    touch(join(npmDir, process.platform === "win32" ? "npm.cmd" : "npm"));
    const runner = new FakeRunner();
    // pi is NOT on disk until the fake npm install drops it there.
    const piFile = join(npmDir, process.platform === "win32" ? "pi.cmd" : "pi");
    runner.onInteractive(
      (command, args) => /npm(\.cmd|\.exe)?$/i.test(command) && args.includes(PI_NPM_PACKAGE),
      () => {
        touch(piFile);
        return 0;
      },
    );
    runner.onCapture(matchContaining("--version"), { code: 0, stdout: "0.99.2" });
    runner.onInteractive(matchContaining("npm:gentle-pi"), 0);
    runner.onInteractive(matchContaining("install"), 0);

    const world = makeWorld(runner, { PATH: npmDir });
    const own = makeFakeOwnPackage(tmp);

    const outcome = await ensureReady(world.deps, own);

    assert.equal(outcome.pi.installedNow, true);
    assert.equal(outcome.gentlePi.action, "installed");
    assert.equal(outcome.cognix.action, "registered");
    const calls = runner.interactiveCalls();
    assert.ok(calls[0] !== undefined && /npm(\.cmd|\.exe)?$/i.test(calls[0].command));
    assert.ok(calls[0] !== undefined && calls[0].args.includes("--ignore-scripts"));
    assert.deepEqual(calls[1]?.args, ["install", "npm:gentle-pi"]);
    assert.deepEqual(calls[2]?.args, ["install", own.rootDir]);
    // No Go in the fake env -> gentle-ai is reported unavailable, not fatal.
    assert.equal(outcome.gentleAi.action, "unavailable");
    assert.ok(outcome.notes.some((n) => n.includes("gentle-ai could not be installed")));
  });

  test("gentle-pi install triggers the documented pi-scoped gentle-ai sync", async () => {
    const runner = new FakeRunner();
    const world = makeWorld(runner);
    fakeInstalledPi(runner, world);
    const aiBin = join(tmp, "bin", process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai");
    touch(aiBin);
    world.deps.env.COGNIX_GENTLE_AI = aiBin;
    runner.onCapture(matchContaining("--version"), { code: 0, stdout: "gentle-ai 3.7.0" });
    runner.onInteractive(matchContaining(), 0);
    const own = makeFakeOwnPackage(tmp);

    const outcome = await ensureReady(world.deps, own);

    assert.equal(outcome.gentleAi.action, "already-installed");
    assert.deepEqual(outcome.gentleAi.syncs, [{ scope: "pi", ok: true }]);
    const syncCall = runner.interactiveCalls().find((c) => c.command === aiBin);
    assert.deepEqual(syncCall?.args, ["sync", "--agent", "pi"]);
  });

  test("when nothing changed, no sync runs and gentle-ai is untouched", async () => {
    const runner = new FakeRunner();
    const world = makeWorld(runner);
    fakeInstalledPi(runner, world);
    const aiBin = join(tmp, "bin", process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai");
    touch(aiBin);
    world.deps.env.COGNIX_GENTLE_AI = aiBin;
    runner.onCapture(matchContaining("--version"), { code: 0, stdout: "gentle-ai 3.7.0" });
    const own = makeFakeOwnPackage(tmp);
    writeJson(join(world.agentDir, "settings.json"), {
      packages: ["npm:gentle-pi", relative(world.agentDir, own.rootDir)],
    });

    const outcome = await ensureReady(world.deps, own);

    assert.equal(outcome.gentleAi.action, "already-installed");
    assert.deepEqual(outcome.gentleAi.syncs, []);
    assert.equal(runner.interactiveCalls().length, 0);
  });

  test("pi found but broken probe: hard error, nothing installed", async () => {
    const runner = new FakeRunner();
    const world = makeWorld(runner);
    const piFile = join(tmp, "shim", process.platform === "win32" ? "pi.cmd" : "pi");
    touch(piFile);
    world.deps.env.COGNIX_PI = piFile;
    runner.onCapture(matchContaining("--version"), { code: 1, stderr: "boom" });
    await assert.rejects(
      () => ensureReady(world.deps, makeFakeOwnPackage(tmp)),
      (error: unknown) =>
        error instanceof CognixError &&
        /failed to run/.test(error.message) &&
        error.message.includes(piFile),
    );
    assert.equal(runner.interactiveCalls().length, 0);
  });

  test("pi missing and npm missing: actionable error", async () => {
    const runner = new FakeRunner();
    const world = makeWorld(runner); // PATH empty, APPDATA has no npm
    await assert.rejects(
      () => ensureReady(world.deps, makeFakeOwnPackage(tmp)),
      (error: unknown) =>
        error instanceof CognixError && /npm is required/.test(error.message),
    );
  });

  test("malformed settings.json stops the flow with a precise error", async () => {
    const runner = new FakeRunner();
    const world = makeWorld(runner);
    fakeInstalledPi(runner, world);
    touch(join(world.agentDir, "settings.json"), "{ this is not json ");
    await assert.rejects(
      () => ensureReady(world.deps, makeFakeOwnPackage(tmp)),
      (error: unknown) =>
        error instanceof CognixError && /not valid JSON/.test(error.message),
    );
  });

  test("missing settings.json is fine (fresh agent home)", async () => {
    const runner = new FakeRunner();
    const world = makeWorld(runner);
    fakeInstalledPi(runner, world);
    runner.onInteractive(matchContaining(), 0);
    const own = makeFakeOwnPackage(tmp);
    const outcome = await ensureReady(world.deps, own);
    assert.equal(outcome.settingsPath, join(world.agentDir, "settings.json"));
    assert.equal(outcome.gentlePi.action, "installed");
  });

  test("loadPiConfig honors PI_CODING_AGENT_DIR", () => {
    const runner = new FakeRunner();
    const world = makeWorld(runner);
    const config = loadPiConfig(world.deps);
    assert.equal(config.agentDir, world.agentDir);
  });
});
