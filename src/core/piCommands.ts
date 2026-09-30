/**
 * Delegation to Pi's own subcommands.
 *
 * Every state-changing or read operation on Pi packages goes through the
 * real `pi` binary: Pi decides HOW, Cognix only decides WHEN.
 */

import { CognixError } from "./errors.js";
import type { ProcessRunner } from "./process.js";

/**
 * Run one pi subcommand attached to the user's terminal and throw a
 * CognixError with a retry hint on failure.
 */
export async function runPiCommand(
  runner: ProcessRunner,
  piCommand: string,
  args: string[],
  what: string,
  hints: string[] = [],
): Promise<void> {
  const code = await runner.interactive(piCommand, args);
  if (code !== 0) {
    throw new CognixError(`Pi could not ${what} (exit ${String(code)}).`, [
      `Retry manually: pi ${args.join(" ")}`,
      ...hints,
    ]);
  }
}
