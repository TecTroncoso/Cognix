/**
 * Process execution abstraction.
 *
 * Cognix delegates to Pi and npm; every external call goes through this
 * interface so tests can substitute a fake runner without executing or
 * installing anything real.
 */

import { spawn } from "node:child_process";
import { buildCmdLine, needsCmdShim, type Platform } from "./platform.js";

export interface CaptureResult {
  /** Exit code, or null when the process could not be spawned. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the spawn itself failed (e.g. ENOENT). */
  spawnError?: string;
}

export interface ProcessRunner {
  /** Run a command and capture its output. Never throws for a missing binary. */
  capture(command: string, args: string[]): Promise<CaptureResult>;
  /** Run a command connected to the user's terminal (TUI, installers). */
  interactive(command: string, args: string[]): Promise<number>;
}

interface SpawnTarget {
  file: string;
  args: string[];
  /** Run through the platform shell: the target is a full command line. */
  shell: boolean;
}

function toSpawnTarget(
  command: string,
  args: string[],
  platform: Platform,
): SpawnTarget {
  if (needsCmdShim(command, platform)) {
    // Node escapes embedded quotes in spawn() arguments as \", which cmd.exe
    // does not understand. Passing ONE pre-quoted command line through
    // shell:true (cmd.exe /d /s /c "<line>", verbatim arguments) preserves
    // it exactly.
    return { file: buildCmdLine(command, args), args: [], shell: true };
  }
  return { file: command, args, shell: false };
}

/**
 * Node's shell:true on Windows uses %ComSpec% (cmd.exe) with /d /s /c and
 * verbatim arguments, which is exactly the batch-shim behavior we need.
 */
export function createProcessRunner(platform: Platform = process.platform): ProcessRunner {
  return {
    capture(command, args) {
      const target = toSpawnTarget(command, args, platform);
      return new Promise((resolve) => {
        const child = spawn(target.file, target.args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          shell: target.shell,
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", (err) => {
          resolve({
            code: null,
            stdout: "",
            stderr: "",
            spawnError: err.message,
          });
        });
        child.on("close", (code) => {
          resolve({
            code,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
        });
      });
    },

    interactive(command, args) {
      const target = toSpawnTarget(command, args, platform);
      return new Promise((resolve) => {
        const child = spawn(target.file, target.args, {
          stdio: "inherit",
          shell: target.shell,
        });
        child.on("error", () => resolve(127));
        child.on("close", (code, signal) => {
          if (code !== null) return resolve(code);
          // The child died from a signal; report a conventional failing code.
          resolve(signal ? 128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 9) : 1);
        });
      });
    },
  };
}
