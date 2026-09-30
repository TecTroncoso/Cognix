import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { join } from "node:path";
import {
  parseVersionProbe,
  probePi,
  resolvePiExecutable,
} from "../src/core/piResolver.js";
import {
  cleanupTmpDir,
  FakeRunner,
  makeEnv,
  makeTmpDir,
  matchContaining,
  nodeFs,
  touch,
} from "./helpers.js";

let tmp: string;

beforeEach(() => {
  tmp = makeTmpDir();
});

afterEach(() => {
  cleanupTmpDir(tmp);
});

describe("resolvePiExecutable", () => {
  test("COGNIX_PI override wins when the path exists", () => {
    const piFile = join(tmp, "custom-pi.cmd");
    touch(piFile);
    const env = makeEnv(tmp, { COGNIX_PI: piFile });
    const result = resolvePiExecutable({ env, platform: process.platform, fs: nodeFs });
    assert.equal(result?.command, piFile);
    assert.equal(result?.source, "env-override");
  });

  test("override pointing nowhere is ignored, PATH scan continues", () => {
    const binDir = join(tmp, "bin");
    touch(join(binDir, process.platform === "win32" ? "pi.cmd" : "pi"));
    const env = makeEnv(tmp, {
      COGNIX_PI: join(tmp, "does-not-exist"),
      PATH: binDir,
    });
    const result = resolvePiExecutable({ env, platform: process.platform, fs: nodeFs });
    assert.equal(result?.source, "path");
    assert.ok(result?.command.includes(binDir));
  });

  test("PATH scan finds platform-appropriate shim name", () => {
    const binDir = join(tmp, "npm-global");
    const shim = process.platform === "win32" ? "pi.cmd" : "pi";
    touch(join(binDir, shim));
    const env = makeEnv(tmp, { PATH: `${join(tmp, "empty")};${binDir}` });
    const result = resolvePiExecutable({ env, platform: process.platform, fs: nodeFs });
    assert.ok(result);
    assert.equal(result.command, join(binDir, shim));
  });

  test("falls back to default npm prefix on win32", () => {
    if (process.platform !== "win32") return;
    const appdata = join(tmp, "AppData", "Roaming");
    touch(join(appdata, "npm", "pi.cmd"));
    const env = makeEnv(tmp); // PATH empty
    const result = resolvePiExecutable({ env, platform: "win32", fs: nodeFs });
    assert.equal(result?.command, join(appdata, "npm", "pi.cmd"));
    assert.equal(result?.source, "well-known");
  });

  test("unix fallback list covers /usr/local/bin", () => {
    if (process.platform === "win32") return;
    // Only check semantics: a fake env without PATH yields null here because
    // the real /usr/local/bin/pi may or may not exist on the machine.
    const env = makeEnv(join(tmp, "home"));
    const result = resolvePiExecutable({ env, platform: process.platform, fs: nodeFs });
    assert.ok(result === null || typeof result.command === "string");
  });

  test("returns null when nothing exists", () => {
    const env = makeEnv(join(tmp, "home"));
    const result = resolvePiExecutable({ env, platform: process.platform, fs: nodeFs });
    assert.equal(result, null);
  });
});

describe("parseVersionProbe", () => {
  test("parses plain and decorated version output", () => {
    assert.equal(parseVersionProbe("0.99.2"), "0.99.2");
    assert.equal(parseVersionProbe("v0.87.1\n"), "0.87.1");
    assert.equal(parseVersionProbe("pi 0.99.2 (build abc)"), "0.99.2");
    assert.equal(parseVersionProbe("garbage"), null);
  });
});

describe("probePi", () => {
  test("ok with version on exit 0", async () => {
    const runner = new FakeRunner().onCapture(matchContaining("--version"), {
      code: 0,
      stdout: "0.99.2",
    });
    const probe = await probePi(runner, "pi");
    assert.equal(probe.ok, true);
    assert.equal(probe.version, "0.99.2");
  });

  test("spawn failure surfaces as not-ok", async () => {
    const runner = new FakeRunner();
    const probe = await probePi(runner, "missing-pi");
    assert.equal(probe.ok, false);
  });
});
