import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildCmdLine,
  executableNames,
  isWindows,
  needsCmdShim,
  pathDelimiter,
  quoteForCmd,
  resolveHome,
} from "../src/core/platform.js";

describe("platform", () => {
  test("win32 detection", () => {
    assert.equal(isWindows("win32"), true);
    assert.equal(isWindows("linux"), false);
    assert.equal(isWindows("darwin"), false);
  });

  test("cmd shim only for .cmd/.bat on win32", () => {
    assert.equal(needsCmdShim("C:\\npm\\pi.cmd", "win32"), true);
    assert.equal(needsCmdShim("C:\\npm\\pi.bat", "win32"), true);
    assert.equal(needsCmdShim("C:\\npm\\pi.CMD", "win32"), true);
    assert.equal(needsCmdShim("C:\\npm\\pi.exe", "win32"), false);
    assert.equal(needsCmdShim("/usr/local/bin/pi", "linux"), false);
    assert.equal(needsCmdShim("pi.cmd", "linux"), false);
  });

  test("quoteForCmd wraps in double quotes and escapes embedded quotes", () => {
    assert.equal(quoteForCmd("simple"), "\"simple\"");
    assert.equal(quoteForCmd("with space"), "\"with space\"");
    assert.equal(quoteForCmd("say \"hi\""), "\"say \\\"hi\\\"\"");
  });

  test("quoteForCmd doubles backslashes before quotes and at the end (C-runtime rules)", () => {
    // A trailing backslash before the closing quote would otherwise be read
    // as \" -> an escaped quote, breaking the argument boundary.
    assert.equal(quoteForCmd("trailing\\"), "\"trailing\\\\\"");
    assert.equal(quoteForCmd("C:\\Program Files\\npm\\"), "\"C:\\Program Files\\npm\\\\\"");
    // backslash immediately before an embedded quote is doubled too
    assert.equal(quoteForCmd("a\\\"b"), "\"a\\\\\\\"b\"");
  });

  test("buildCmdLine quotes executable and args", () => {
    assert.equal(
      buildCmdLine("C:\\Program Files\\npm\\pi.cmd", ["--mode", "rpc"]),
      "\"C:\\Program Files\\npm\\pi.cmd\" \"--mode\" \"rpc\"",
    );
  });

  test("executable names per platform (ps1 never used)", () => {
    assert.deepEqual(executableNames("pi", "win32"), ["pi.cmd", "pi.exe", "pi.bat"]);
    assert.deepEqual(executableNames("pi", "linux"), ["pi"]);
  });

  test("path delimiter per platform", () => {
    assert.equal(pathDelimiter("win32"), ";");
    assert.equal(pathDelimiter("darwin"), ":");
  });

  test("resolveHome uses HOME on unix and USERPROFILE on windows", () => {
    assert.equal(resolveHome({ HOME: "/home/u" } as NodeJS.ProcessEnv, "linux"), "/home/u");
    assert.equal(
      resolveHome({ USERPROFILE: "C:\\Users\\u" } as NodeJS.ProcessEnv, "win32"),
      "C:\\Users\\u",
    );
    assert.throws(() => resolveHome({} as NodeJS.ProcessEnv, "win32"), /home directory/);
  });
});
