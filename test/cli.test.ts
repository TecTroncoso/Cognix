import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { join, relative } from "node:path";
import { runCli, type CliDeps } from "../src/cli/main.js";
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

interface CapturedIo {
  logs: string[];
  errors: string[];
  outs: string[];
}

function makeCliDeps(runner: FakeRunner, opts: { settings?: unknown } = {}) {
  const home = join(tmp, "home");
  const agentDir = join(tmp, "agent");
  const env = makeEnv(home, { PI_CODING_AGENT_DIR: agentDir });
  const piFile = join(tmp, "shim", process.platform === "win32" ? "pi.cmd" : "pi");
  touch(piFile);
  env.COGNIX_PI = piFile;
  if (opts.settings !== undefined) {
    writeJson(join(agentDir, "settings.json"), opts.settings);
  }
  const captured: CapturedIo = { logs: [], errors: [], outs: [] };
  const own = makeFakeOwnPackage(tmp);
  const deps: CliDeps = {
    runner,
    fs: nodeFs,
    env,
    platform: process.platform,
    log: (m) => captured.logs.push(m),
    io: {
      log: (m) => captured.logs.push(m),
      error: (m) => captured.errors.push(m),
      out: (m) => captured.outs.push(m),
    },
    own,
  };
  return { deps, captured, agentDir, piFile, own };
}

function registeringWorld() {
  const runner = new FakeRunner();
  const world = makeCliDeps(runner);
  writeJson(join(world.agentDir, "settings.json"), {
    packages: ["npm:gentle-pi@3.7.0", relative(world.agentDir, world.own.rootDir)],
  });
  runner.onCapture(matchContaining("--version"), { code: 0, stdout: "0.99.2" });
  runner.onInteractive(matchContaining(), 0);
  return { runner, ...world };
}

describe("cognix CLI", () => {
  test("--help prints usage and exits 0", async () => {
    const runner = new FakeRunner();
    const { deps, captured } = makeCliDeps(runner);
    const code = await runCli(["--help"], deps);
    assert.equal(code, 0);
    assert.ok(captured.outs[0]?.includes("Usage:"));
    assert.ok(captured.outs[0]?.includes("cognix update"));
    assert.equal(runner.calls.length, 0);
  });

  test("--version reports cognix, pi and gentle-pi without mutating anything", async () => {
    const { runner, captured, deps } = registeringWorld();
    const code = await runCli(["--version"], deps);
    assert.equal(code, 0);
    assert.equal(captured.outs[0], "cognix 9.9.9");
    assert.ok(captured.outs[1]?.startsWith("pi: 0.99.2"));
    assert.equal(captured.outs[2], "gentle-pi: npm:gentle-pi@3.7.0 (pinned)");
    assert.equal(runner.interactiveCalls().length, 0);
  });

  test("unknown args are forwarded to pi verbatim", async () => {
    const { runner, deps, piFile } = registeringWorld();
    const code = await runCli(["--mode", "rpc", "--no-session"], deps);
    assert.equal(code, 0);
    const piCalls = runner.callsMatching((c) => c === piFile);
    const lastCall = piCalls[piCalls.length - 1];
    assert.ok(lastCall);
    assert.deepEqual(lastCall.args, ["--mode", "rpc", "--no-session"]);
    assert.equal(lastCall.interactive, true);
  });

  test("`cognix -- <args>` forwards everything including pi subcommands", async () => {
    const { runner, deps, piFile } = registeringWorld();
    const code = await runCli(["--", "list"], deps);
    assert.equal(code, 0);
    const piCalls = runner.callsMatching((c) => c === piFile);
    assert.deepEqual(piCalls[piCalls.length - 1]?.args, ["list"]);
  });

  test("pi's exit code is propagated", async () => {
    const runner = new FakeRunner();
    const world = makeCliDeps(runner);
    writeJson(join(world.agentDir, "settings.json"), {
      packages: ["npm:gentle-pi", relative(world.agentDir, world.own.rootDir)],
    });
    runner.onCapture(matchContaining("--version"), { code: 0, stdout: "0.99.2" });
    runner.onInteractive(matchContaining(), 42);
    const code = await runCli([], world.deps);
    assert.equal(code, 42);
  });

  test("cognix update rejects extra arguments", async () => {
    const runner = new FakeRunner();
    const { deps, captured } = makeCliDeps(runner);
    const code = await runCli(["update", "--extensions"], deps);
    assert.equal(code, 1);
    assert.ok(captured.errors.some((line) => line.includes("takes no arguments")));
    assert.equal(runner.calls.length, 0);
  });

  test("cognix update runs the full delegated flow", async () => {
    const runner = new FakeRunner();
    const { deps, captured, agentDir, own } = makeCliDeps(runner);
    writeJson(join(agentDir, "settings.json"), {
      packages: ["npm:gentle-pi", relative(agentDir, own.rootDir)],
    });
    let probeCount = 0;
    runner.addHandler({
      when: matchContaining("--version"),
      capture: () => ({ code: 0, stdout: probeCount++ === 0 ? "0.99.1" : "0.99.2", stderr: "" }),
    });
    runner.onInteractive(matchContaining(), 0);

    const code = await runCli(["update"], deps);
    assert.equal(code, 0);
    assert.deepEqual(
      runner.callsMatching(matchContaining("update", "--self"))[0]?.args,
      ["update", "--self"],
    );
    assert.ok(captured.logs.some((line) => line.includes("0.99.1 -> 0.99.2")));
    assert.ok(captured.logs.some((line) => line.includes("gentle-pi")));
  });

  test("doctor reports a healthy setup with exit 0", async () => {
    const { runner, deps, captured } = registeringWorld();
    const code = await runCli(["doctor"], deps);
    assert.equal(code, 0);
    const report = captured.outs.join("\n");
    assert.ok(report.includes("cognix doctor"));
    assert.ok(report.includes("pi: 0.99.2"));
    assert.ok(report.includes("npm:gentle-pi@3.7.0 (pinned)"));
    assert.ok(report.includes("cognix package: registered"));
  });

  test("doctor flags malformed settings with exit 1", async () => {
    const runner = new FakeRunner();
    const { deps, captured, agentDir } = makeCliDeps(runner);
    touch(join(agentDir, "settings.json"), "{ nope ");
    runner.onCapture(matchContaining("--version"), { code: 0, stdout: "0.99.2" });
    const code = await runCli(["doctor"], deps);
    assert.equal(code, 1);
    assert.ok(captured.outs.join("\n").includes("not valid JSON"));
  });
});
