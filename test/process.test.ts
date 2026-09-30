/**
 * Real local process tests for the ProcessRunner.
 *
 * These spawn only the local Node runtime (and, on Windows, a throwaway
 * .cmd shim in a temp directory). Nothing is installed, no network is
 * touched, and no global state changes.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { join } from "node:path";
import { createProcessRunner } from "../src/core/process.js";
import { cleanupTmpDir, makeTmpDir, touch } from "./helpers.js";

let tmp: string;

beforeEach(() => {
  tmp = makeTmpDir();
});

afterEach(() => {
  cleanupTmpDir(tmp);
});

const runner = createProcessRunner(process.platform);
const NODE = process.execPath;

describe("ProcessRunner.capture", () => {
  test("captures stdout/stderr and propagates the exit code", async () => {
    const result = await runner.capture(NODE, [
      "-e",
      "process.stdout.write('to-out'); process.stderr.write('to-err'); process.exit(3)",
    ]);
    assert.equal(result.code, 3);
    assert.equal(result.stdout, "to-out");
    assert.equal(result.stderr, "to-err");
  });

  test("missing executable resolves with spawnError instead of throwing", async () => {
    const result = await runner.capture(join(tmp, "no-such-binary"), []);
    assert.equal(result.code, null);
    assert.ok(result.spawnError && result.spawnError.length > 0);
  });

  test("space-containing arguments reach the child verbatim", async () => {
    const result = await runner.capture(NODE, [
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      "arg with spaces",
      'quote "inside" arg',
    ]);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), ["arg with spaces", 'quote "inside" arg']);
  });
});

describe("ProcessRunner.interactive", () => {
  test("propagates the child exit code", async () => {
    const code = await runner.interactive(NODE, ["-e", "process.exit(42)"]);
    assert.equal(code, 42);
  });

  test("missing executable reports 127", async () => {
    const code = await runner.interactive(join(tmp, "no-such-binary"), []);
    assert.equal(code, 127);
  });
});

describe("Windows .cmd shim handling", () => {
  test("runs a .cmd shim through cmd.exe, preserving tricky arguments", { skip: process.platform !== "win32" }, async () => {
    // A minimal shim mimicking an npm global bin: forwards to a node script.
    const scriptPath = join(tmp, "shim-target.js");
    touch(
      scriptPath,
      "process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exit(7);",
    );
    const cmdPath = join(tmp, "directory with spaces", "fake-pi.cmd");
    touch(cmdPath, `@ECHO off\r\n"${NODE.replace(/\\/g, "\\\\")}" "${scriptPath}" %*\r\n`);

    const result = await runner.capture(cmdPath, ["--version", "path with\\trailing\\"]);
    assert.equal(result.code, 7);
    assert.deepEqual(JSON.parse(result.stdout), ["--version", "path with\\trailing\\"]);
  });
});
