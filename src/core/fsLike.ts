/**
 * Minimal filesystem surface used by the core modules. Production code
 * adapts node:fs; tests can point the same functions at temporary
 * directories while keeping real I/O semantics.
 */

import { existsSync, readFileSync } from "node:fs";

export interface FsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf8"): string;
}

/** Narrow adapter over node:fs. */
export function createNodeFs(): FsLike {
  return { existsSync, readFileSync: (path) => readFileSync(path, "utf8") };
}
