import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { join, relative } from "node:path";
import {
  ensureCognixRegistered,
  inspectCognix,
  verifyCognixRegistration,
  type CognixInspectOptions,
} from "../src/core/cognixPackage.js";
import { CognixError } from "../src/core/errors.js";
import {
  cleanupTmpDir,
  FakeRunner,
  makeEnv,
  makeFakeOwnPackage,
  makeTmpDir,
  matchContaining,
  nodeFs,
  rmSyncSafe,
  writeJson,
} from "./helpers.js";

let tmp: string;

beforeEach(() => {
  tmp = makeTmpDir();
});

afterEach(() => {
  cleanupTmpDir(tmp);
});

function options(agentDir: string): CognixInspectOptions {
  return { fs: nodeFs, agentDir, env: makeEnv(tmp), platform: process.platform };
}

describe("inspectCognix", () => {
  test("not-registered when no cognix path package is declared", () => {
    const own = makeFakeOwnPackage(tmp);
    const agentDir = join(tmp, "agent");
    const result = inspectCognix({ packages: ["npm:gentle-pi"] }, own, options(agentDir));
    assert.equal(result.kind, "not-registered");
  });

  test("registered when an entry resolves to the current package root", () => {
    const own = makeFakeOwnPackage(tmp);
    const agentDir = join(tmp, "agent");
    // Pi records local paths relative to the settings file (verified behavior).
    const recorded = relative(agentDir, own.rootDir);
    const result = inspectCognix({ packages: [recorded] }, own, options(agentDir));
    assert.equal(result.kind, "registered");
  });

  test("a declaration pointing at another cognix location is a stray", () => {
    const own = makeFakeOwnPackage(tmp);
    const agentDir = join(tmp, "agent");
    const oldRoot = join(tmp, "old-location", "cognix");
    writeJson(join(oldRoot, "package.json"), { name: "cognix", version: "9.0.0" });
    const result = inspectCognix({ packages: [oldRoot] }, own, options(agentDir));
    assert.equal(result.kind, "not-registered");
    assert.equal(result.strays.length, 1);
  });
});

describe("ensureCognixRegistered", () => {
  test("throws a clear error when the extension build is missing (unbuilt checkout)", async () => {
    const own = makeFakeOwnPackage(tmp);
    // Remove the built entrypoint.
    rmSyncSafe(join(own.rootDir, "dist"));
    const runner = new FakeRunner();
    await assert.rejects(
      () => ensureCognixRegistered(runner, "pi", {}, own, options(join(tmp, "agent"))),
      (error: unknown) =>
        error instanceof CognixError && /extension build is missing/.test(error.message),
    );
    assert.equal(runner.calls.length, 0);
  });

  test("registers the current package root via pi install (idempotent when present)", async () => {
    const own = makeFakeOwnPackage(tmp);
    const agentDir = join(tmp, "agent");
    const runner = new FakeRunner().onInteractive(matchContaining("install"), 0);

    const first = await ensureCognixRegistered(runner, "pi", {}, own, options(agentDir));
    assert.equal(first.action, "registered");
    assert.deepEqual(runner.interactiveCalls()[0]?.args, ["install", own.rootDir]);

    // Second run with the declaration already in place: no calls at all.
    const recorded = relative(agentDir, own.rootDir);
    const calm = await ensureCognixRegistered(
      runner,
      "pi",
      { packages: [recorded] },
      own,
      options(agentDir),
    );
    assert.equal(calm.action, "already-registered");
    assert.equal(runner.interactiveCalls().length, 1);
  });

  test("stale registrations are removed before re-registering", async () => {
    const own = makeFakeOwnPackage(tmp);
    const agentDir = join(tmp, "agent");
    const oldRoot = join(tmp, "old", "cognix");
    writeJson(join(oldRoot, "package.json"), { name: "cognix" });

    const runner = new FakeRunner().onInteractive(matchContaining(), 0);
    const result = await ensureCognixRegistered(
      runner,
      "pi",
      { packages: [oldRoot] },
      own,
      options(agentDir),
    );
    assert.equal(result.action, "re-registered");
    const calls = runner.interactiveCalls();
    assert.deepEqual(calls[0]?.args, ["remove", oldRoot]);
    assert.deepEqual(calls[1]?.args, ["install", own.rootDir]);
  });
});

describe("verifyCognixRegistration", () => {
  test("true only when registered and the extension entry exists", () => {
    const own = makeFakeOwnPackage(tmp);
    const agentDir = join(tmp, "agent");
    const recorded = relative(agentDir, own.rootDir);
    assert.equal(
      verifyCognixRegistration({ packages: [recorded] }, own, options(agentDir)),
      true,
    );
    assert.equal(verifyCognixRegistration({ packages: [] }, own, options(agentDir)), false);

    rmSyncSafe(join(own.rootDir, "dist"));
    assert.equal(
      verifyCognixRegistration({ packages: [recorded] }, own, options(agentDir)),
      false,
    );
  });
});
