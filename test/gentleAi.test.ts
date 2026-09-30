import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { join } from "node:path";
import {
  gentleAiScopeNote,
  inspectGentleAi,
  installGentleAi,
  piRegisteredInGentleAi,
  probeGentleAi,
  resolveGentleAi,
  syncGentleAi,
  upgradeGentleAi,
  type GentleAiDeps,
} from "../src/core/gentleAi.js";
import {
  cleanupTmpDir,
  FakeRunner,
  makeEnv,
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

function makeDeps(runner: FakeRunner, envExtra: Record<string, string> = {}): GentleAiDeps & { logs: string[] } {
  const home = join(tmp, "home");
  touch(join(home, ".keep"));
  const env = makeEnv(home, envExtra);
  const logs: string[] = [];
  return { runner, fs: nodeFs, env, platform: process.platform, log: (m) => void logs.push(m), logs };
}

/** A fake gentle-ai executable on disk plus a working --version probe. */
function fakeGentleAiBinary(runner: FakeRunner, version = "3.7.0"): string {
  const bin = join(tmp, "bin", process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai");
  touch(bin);
  runner.onCapture((command) => command === bin, { code: 0, stdout: `gentle-ai ${version}` });
  return bin;
}

describe("resolveGentleAi", () => {
  test("COGNIX_GENTLE_AI override wins when it exists", () => {
    const runner = new FakeRunner();
    const deps = makeDeps(runner);
    const bin = fakeGentleAiBinary(runner);
    deps.env.COGNIX_GENTLE_AI = bin;
    assert.equal(resolveGentleAi(deps), bin);
  });

  test("override pointing nowhere is ignored; PATH scan applies", () => {
    const runner = new FakeRunner();
    const deps = makeDeps(runner, { COGNIX_GENTLE_AI: join(tmp, "gone") });
    const dir = join(tmp, "somebin");
    touch(join(dir, process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai"));
    deps.env.PATH = dir;
    assert.equal(resolveGentleAi(deps), join(dir, process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai"));
  });

  test("well-known go bin is consulted", () => {
    const runner = new FakeRunner();
    const deps = makeDeps(runner);
    const home = deps.env.HOME!;
    const name = process.platform === "win32" ? "gentle-ai.exe" : "gentle-ai";
    const expected = join(home, "go", "bin", name);
    touch(expected);
    assert.equal(resolveGentleAi(deps), expected);
  });

  test("missing everywhere -> null", () => {
    const runner = new FakeRunner();
    const deps = makeDeps(runner);
    assert.equal(resolveGentleAi(deps), null);
  });
});

describe("probeGentleAi / inspectGentleAi", () => {
  test("parses 'gentle-ai X.Y.Z' output", async () => {
    const runner = new FakeRunner().onCapture(matchContaining("--version"), {
      code: 0,
      stdout: "gentle-ai 2.9.1",
    });
    const probe = await probeGentleAi(runner, "gentle-ai");
    assert.deepEqual(probe, { ok: true, version: "2.9.1" });
  });

  test("present and working", async () => {
    const runner = new FakeRunner();
    const deps = makeDeps(runner);
    const bin = fakeGentleAiBinary(runner, "3.7.0");
    deps.env.COGNIX_GENTLE_AI = bin;
    const state = await inspectGentleAi(deps);
    assert.deepEqual(state, { kind: "installed", command: bin, version: "3.7.0" });
  });

  test("broken binary counts as missing (with a warning), override included", async () => {
    const runner = new FakeRunner().onCapture(matchContaining("--version"), { code: 1 });
    const deps = makeDeps(runner);
    const bin = fakeGentleAiBinary(runner);
    deps.env.COGNIX_GENTLE_AI = bin;
    const state = await inspectGentleAi(deps);
    assert.equal(state.kind, "missing");
    assert.ok(deps.logs.some((l) => l.includes("failed to run")));
  });

  test("absent binary -> missing, no crash", async () => {
    const runner = new FakeRunner();
    const deps = makeDeps(runner);
    assert.equal((await inspectGentleAi(deps)).kind, "missing");
  });
});

describe("installGentleAi", () => {
  test("win32: uses the official v4 go-install, falls back to v3 stable line", { skip: process.platform !== "win32" }, async () => {
    const runner = new FakeRunner();
    const deps = makeDeps(runner);
    const goBin = join(tmp, "gobin", "go.exe");
    touch(goBin);
    deps.env.PATH = join(tmp, "gobin");
    let attempts = 0;
    runner.onInteractive(
      (command, args) => command === goBin && args.includes("install"),
      () => {
        attempts += 1;
        // First attempt (v4, @latest pre-4.0.0) fails, second (v3 stable) succeeds.
        if (attempts === 1) return 1;
        const bin = fakeGentleAiBinary(runner);
        deps.env.COGNIX_GENTLE_AI = bin;
        deps.env.PATH = `${join(tmp, "gobin")};${join(tmp, "bin")}`;
        return 0;
      },
    );
    const result = await installGentleAi(deps);
    assert.ok(result);
    assert.equal(attempts, 2);
    // command content verified in order: v4 first, then v3
    const goCalls = runner.interactiveCalls().filter((c) => c.command === goBin);
    assert.ok(goCalls[0]?.args.some((a) => a.includes("/v4/cmd/gentle-ai@latest")));
    assert.ok(goCalls[1]?.args.some((a) => a.includes("/v3/cmd/gentle-ai@latest")));
  });

  test("win32 without Go reports the official guidance and never throws", { skip: process.platform !== "win32" }, async () => {
    const runner = new FakeRunner();
    const deps = makeDeps(runner); // PATH empty -> no go
    const result = await installGentleAi(deps);
    assert.equal(result, null);
    assert.equal(runner.interactiveCalls().length, 0);
    assert.ok(deps.logs.some((l) => l.includes("could not install gentle-ai")));
  });

  test("darwin: prefers the official brew tap", { skip: process.platform !== "darwin" }, async () => {
    const runner = new FakeRunner();
    const deps = makeDeps(runner);
    const brew = join(tmp, "brewbin", "brew");
    touch(brew);
    deps.env.PATH = join(tmp, "brewbin");
    runner.onInteractive(matchContaining("brew", "install"), () => {
      const bin = fakeGentleAiBinary(runner);
      deps.env.PATH = `${join(tmp, "brewbin")};${join(tmp, "bin")}`;
      return 0;
    });
    const result = await installGentleAi(deps);
    assert.ok(result);
    const call = runner.interactiveCalls().find((c) => c.command === brew);
    assert.deepEqual(call?.args, ["install", "gentleman-programming/tap/gentle-ai"]);
  });
});

describe("upgradeGentleAi", () => {
  test("delegates to gentle-ai's own updater", async () => {
    const runner = new FakeRunner().onInteractive(matchContaining("upgrade"), 0);
    const deps = makeDeps(runner);
    const result = await upgradeGentleAi(deps, "gentle-ai");
    assert.equal(result.upgraded, true);
    assert.deepEqual(runner.interactiveCalls()[0]?.args, ["upgrade"]);
  });

  test("failure returns notes instead of throwing", async () => {
    const runner = new FakeRunner().onInteractive(matchContaining("upgrade"), 1);
    const deps = makeDeps(runner);
    const result = await upgradeGentleAi(deps, "gentle-ai");
    assert.equal(result.upgraded, false);
    assert.ok(result.notes.some((n) => n.includes("gentle-ai upgrade")));
  });
});

describe("syncGentleAi", () => {
  test("pi scope passes the documented flag", async () => {
    const runner = new FakeRunner().onInteractive(matchContaining("sync"), 0);
    const deps = makeDeps(runner);
    const failure = await syncGentleAi(deps, "gentle-ai", "pi");
    assert.equal(failure, null);
    assert.deepEqual(runner.interactiveCalls()[0]?.args, ["sync", "--agent", "pi"]);
  });

  test("failure yields a note, never a throw", async () => {
    const runner = new FakeRunner().onInteractive(matchContaining("sync"), 2);
    const deps = makeDeps(runner);
    const failure = await syncGentleAi(deps, "gentle-ai", "all");
    assert.ok(failure?.includes("exited 2"));
  });
});

describe("piRegisteredInGentleAi + scope note", () => {
  test("reads installed_agents from ~/.gentle-ai/state.json", () => {
    const runner = new FakeRunner();
    const deps = makeDeps(runner);
    const statePath = join(deps.env.HOME!, ".gentle-ai", "state.json");
    writeJson(statePath, { installed_agents: ["opencode", "pi"] });
    assert.equal(piRegisteredInGentleAi(deps), true);
    writeJson(statePath, { installed_agents: ["opencode"] });
    assert.equal(piRegisteredInGentleAi(deps), false);
    assert.equal(gentleAiScopeNote(false)?.includes("gentle-ai install --agent pi"), true);
  });

  test("unreadable or missing state -> unknown", () => {
    const runner = new FakeRunner();
    const deps = makeDeps(runner);
    assert.equal(piRegisteredInGentleAi(deps), "unknown");
    const statePath = join(deps.env.HOME!, ".gentle-ai", "state.json");
    touch(statePath, "{ nope");
    assert.equal(piRegisteredInGentleAi(deps), "unknown");
  });
});
