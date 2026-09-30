#!/usr/bin/env node
/**
 * Thin executable wrapper around the testable runCli().
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createNodeFs } from "../core/fsLike.js";
import { findOwnPackage } from "../core/meta.js";
import { createProcessRunner } from "../core/process.js";
import { runCli } from "./main.js";
import { createStdIo } from "./output.js";

export async function main(argv: string[]): Promise<number> {
  const io = createStdIo();
  const own = findOwnPackage();
  const deps = {
    runner: createProcessRunner(process.platform),
    fs: createNodeFs(),
    env: process.env,
    platform: process.platform,
    log: io.log,
    io,
    own,
  };
  return runCli(argv, deps);
}

function isInvokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`cognix: fatal: ${message}\n`);
      process.exitCode = 1;
    });
}
