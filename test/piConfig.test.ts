import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { join, resolve } from "node:path";
import {
  isPathSource,
  packageEntries,
  parseNpmSource,
  readPackageName,
  readPiSettings,
  resolveAgentDir,
  resolvePathSource,
  samePath,
} from "../src/core/piConfig.js";
import { cleanupTmpDir, makeEnv, makeTmpDir, nodeFs, touch, writeJson } from "./helpers.js";

let tmp: string;

beforeEach(() => {
  tmp = makeTmpDir();
});

afterEach(() => {
  cleanupTmpDir(tmp);
});

describe("resolveAgentDir", () => {
  test("defaults to ~/.pi/agent", () => {
    const env = makeEnv(join(tmp, "home"));
    assert.equal(
      resolveAgentDir(env, process.platform),
      join(join(tmp, "home"), ".pi", "agent"),
    );
  });

  test("honors PI_CODING_AGENT_DIR", () => {
    const env = makeEnv(tmp, { PI_CODING_AGENT_DIR: join(tmp, "custom-agent") });
    assert.equal(resolveAgentDir(env, process.platform), join(tmp, "custom-agent"));
  });
});

describe("readPiSettings", () => {
  test("missing file", () => {
    const state = readPiSettings(nodeFs, join(tmp, "agent"));
    assert.equal(state.kind, "missing");
  });

  test("malformed JSON is reported, never guessed", () => {
    const agentDir = join(tmp, "agent");
    touch(join(agentDir, "settings.json"), "{ not valid json ");
    const state = readPiSettings(nodeFs, agentDir);
    assert.equal(state.kind, "malformed");
  });

  test("ok object", () => {
    const agentDir = join(tmp, "agent");
    writeJson(join(agentDir, "settings.json"), { packages: ["npm:gentle-pi"] });
    const state = readPiSettings(nodeFs, agentDir);
    assert.equal(state.kind, "ok");
    if (state.kind === "ok") assert.deepEqual(state.settings.packages, ["npm:gentle-pi"]);
  });
});

describe("package declarations", () => {
  test("packageEntries accepts strings and {source} objects, drops junk", () => {
    const entries = packageEntries({
      packages: ["npm:gentle-pi", { source: "./local" }, { noSource: 1 }, 42, null],
    });
    assert.deepEqual(entries, ["npm:gentle-pi", "./local"]);
  });

  test("parseNpmSource handles unpinned, pinned and scoped names", () => {
    assert.deepEqual(parseNpmSource("npm:gentle-pi"), { name: "gentle-pi", pin: null });
    assert.deepEqual(parseNpmSource("npm:gentle-pi@3.7.0"), { name: "gentle-pi", pin: "3.7.0" });
    assert.deepEqual(parseNpmSource("npm:@scope/pkg@1.0.0"), { name: "@scope/pkg", pin: "1.0.0" });
    assert.deepEqual(parseNpmSource("npm:@scope/pkg"), { name: "@scope/pkg", pin: null });
    assert.equal(parseNpmSource("git:github.com/x/y"), null);
    assert.equal(parseNpmSource("npm:"), null);
  });

  test("isPathSource separates npm/git/url from local paths", () => {
    assert.equal(isPathSource("npm:gentle-pi"), false);
    assert.equal(isPathSource("git:github.com/x/y"), false);
    assert.equal(isPathSource("https://github.com/x/y"), false);
    assert.equal(isPathSource("./rel/path"), true);
    assert.equal(isPathSource(join(tmp, "abs", "path")), true);
  });

  test("resolvePathSource resolves relative paths from the agent dir", () => {
    const agentDir = join(tmp, "agent");
    const env = makeEnv(tmp);
    assert.equal(
      resolvePathSource(join("..", "pkg"), agentDir, env, process.platform),
      resolve(agentDir, join("..", "pkg")),
    );
    const absolute = resolve(join(tmp, "pkg"));
    assert.equal(resolvePathSource(absolute, agentDir, env, process.platform), absolute);
  });

  test("samePath compares normalized identities", () => {
    const a = join(tmp, "one");
    assert.equal(samePath(a, resolve(a), process.platform), true);
    if (process.platform === "win32") {
      assert.equal(samePath(a.toUpperCase(), a.toLowerCase(), "win32"), true);
    }
  });

  test("readPackageName reads the manifest name", () => {
    const dir = join(tmp, "pkg");
    writeJson(join(dir, "package.json"), { name: "gentle-pi" });
    assert.equal(readPackageName(nodeFs, dir), "gentle-pi");
    assert.equal(readPackageName(nodeFs, join(tmp, "missing")), null);
  });
});
