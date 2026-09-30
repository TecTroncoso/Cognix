import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { join } from "node:path";
import {
  ensureGentlePi,
  inspectGentlePi,
  updateGentlePi,
  type GentlePiInspectOptions,
} from "../src/core/gentlePi.js";
import { CognixError } from "../src/core/errors.js";
import type { PiSettings } from "../src/core/piConfig.js";
import {
  cleanupTmpDir,
  FakeRunner,
  makeEnv,
  makeTmpDir,
  matchContaining,
  nodeFs,
  writeJson,
} from "./helpers.js";

let tmp: string;

beforeEach(() => {
  tmp = makeTmpDir();
});

afterEach(() => {
  cleanupTmpDir(tmp);
});

function options(agentDir: string): GentlePiInspectOptions {
  return {
    fs: nodeFs,
    agentDir,
    env: makeEnv(tmp),
    platform: process.platform,
  };
}

describe("inspectGentlePi", () => {
  test("absent when no declaration exists", () => {
    assert.equal(inspectGentlePi({}, options(join(tmp, "agent"))).kind, "absent");
  });

  test("npm declaration, unpinned and pinned", () => {
    const unpinned = inspectGentlePi({ packages: ["npm:gentle-pi"] }, options(join(tmp, "agent")));
    assert.deepEqual(unpinned, { kind: "npm", source: "npm:gentle-pi", pin: null });

    const pinned = inspectGentlePi(
      { packages: ["npm:gentle-pi@3.7.0"] },
      options(join(tmp, "agent")),
    );
    assert.deepEqual(pinned, { kind: "npm", source: "npm:gentle-pi@3.7.0", pin: "3.7.0" });
  });

  test("path declaration recognized through its package.json name", () => {
    const pkgDir = join(tmp, "gentle-pi-checkout");
    writeJson(join(pkgDir, "package.json"), { name: "gentle-pi" });
    const settings: PiSettings = { packages: [pkgDir] };
    const state = inspectGentlePi(settings, options(join(tmp, "agent")));
    assert.equal(state.kind, "path");
    if (state.kind === "path") assert.equal(state.dir, pkgDir);
  });

  test("unrelated packages do not count", () => {
    const other = join(tmp, "other-pkg");
    writeJson(join(other, "package.json"), { name: "other-pkg" });
    const settings: PiSettings = {
      packages: ["npm:someone/else", other, join(tmp, "missing", "other-pkg")],
    };
    const state = inspectGentlePi(settings, options(join(tmp, "agent")));
    assert.equal(state.kind, "absent");
  });

  test("a missing gentle-pi dir is a broken-path; a missing unrelated dir is not", () => {
    const brokenGentle = join(tmp, "missing", "node_modules", "gentle-pi");
    const brokenOther = join(tmp, "missing", "node_modules", "someone-else");
    const withGentle = inspectGentlePi(
      { packages: [brokenOther, brokenGentle] },
      options(join(tmp, "agent")),
    );
    assert.equal(withGentle.kind, "broken-path");
    if (withGentle.kind === "broken-path") assert.equal(withGentle.dir, brokenGentle);

    const onlyOther = inspectGentlePi({ packages: [brokenOther] }, options(join(tmp, "agent")));
    assert.equal(onlyOther.kind, "absent");
  });
});

describe("ensureGentlePi", () => {
  test("noop when already installed via npm", async () => {
    const runner = new FakeRunner();
    const result = await ensureGentlePi(
      runner,
      "pi",
      { packages: ["npm:gentle-pi@3.7.0"] },
      options(join(tmp, "agent")),
    );
    assert.equal(result.action, "already-installed");
    assert.equal(runner.calls.length, 0);
  });

  test("installs via pi when absent", async () => {
    const runner = new FakeRunner().onInteractive(matchContaining("install", "npm:gentle-pi"), 0);
    const result = await ensureGentlePi(runner, "pi", {}, options(join(tmp, "agent")));
    assert.equal(result.action, "installed");
    assert.equal(runner.interactiveCalls().length, 1);
    assert.deepEqual(runner.interactiveCalls()[0]?.args, ["install", "npm:gentle-pi"]);
  });

  test("repairs a broken gentle-pi path declaration (remove + install)", async () => {
    const runner = new FakeRunner().onInteractive(matchContaining(), 0);
    const broken = join(tmp, "gone", "node_modules", "gentle-pi");
    const result = await ensureGentlePi(
      runner,
      "pi",
      { packages: [broken] },
      options(join(tmp, "agent")),
    );
    assert.equal(result.action, "repaired-broken-declaration");
    const calls = runner.interactiveCalls();
    assert.deepEqual(calls[0]?.args, ["remove", broken]);
    assert.deepEqual(calls[1]?.args, ["install", "npm:gentle-pi"]);
  });

  test("a failing pi install propagates as CognixError", async () => {
    const runner = new FakeRunner().onInteractive(matchContaining("install"), 1);
    await assert.rejects(
      () => ensureGentlePi(runner, "pi", {}, options(join(tmp, "agent"))),
      (error: unknown) => error instanceof CognixError,
    );
  });
});

describe("updateGentlePi", () => {
  test("absent -> installs through pi", async () => {
    const runner = new FakeRunner().onInteractive(matchContaining("install"), 0);
    const result = await updateGentlePi(runner, "pi", {}, options(join(tmp, "agent")));
    assert.equal(result.action, "installed");
    assert.deepEqual(runner.interactiveCalls()[0]?.args, ["install", "npm:gentle-pi"]);
  });

  test("unpinned npm declaration is updated with pi update", async () => {
    const runner = new FakeRunner().onInteractive(matchContaining("update"), 0);
    const result = await updateGentlePi(
      runner,
      "pi",
      { packages: ["npm:gentle-pi"] },
      options(join(tmp, "agent")),
    );
    assert.equal(result.action, "updated");
    assert.deepEqual(runner.interactiveCalls()[0]?.args, ["update", "npm:gentle-pi"]);
    assert.equal(result.notes.length, 0);
  });

  test("pinned declaration: pi update runs but the pin is reported, never overridden", async () => {
    const runner = new FakeRunner().onInteractive(matchContaining("update"), 0);
    const result = await updateGentlePi(
      runner,
      "pi",
      { packages: ["npm:gentle-pi@3.7.0"] },
      options(join(tmp, "agent")),
    );
    assert.equal(result.action, "pin-kept");
    assert.deepEqual(runner.interactiveCalls()[0]?.args, ["update", "npm:gentle-pi"]);
    assert.ok(result.notes.some((note) => note.includes("pinned to 3.7.0")));
    assert.ok(result.notes.some((note) => note.includes("pi install npm:gentle-pi")));
  });

  test("path declaration (dev checkout) is left untouched", async () => {
    const pkgDir = join(tmp, "gentle-pi");
    writeJson(join(pkgDir, "package.json"), { name: "gentle-pi" });
    const runner = new FakeRunner();
    const result = await updateGentlePi(
      runner,
      "pi",
      { packages: [pkgDir] },
      options(join(tmp, "agent")),
    );
    assert.equal(result.action, "external-checkout");
    assert.equal(runner.calls.length, 0);
  });
});
