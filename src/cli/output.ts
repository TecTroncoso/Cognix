/**
 * Output channels for the CLI. Everything Cognix prints goes to stderr:
 * Pi's stdout is a protocol channel in print/JSON/RPC modes, and Cognix
 * must never pollute it.
 */

export interface Io {
  /** Status/progress lines (stderr in production). */
  log: (message: string) => void;
  /** Errors and fatal diagnostics (stderr in production). */
  error: (message: string) => void;
  /** Primary answers for read-only commands like --version/doctor (stdout in production). */
  out: (message: string) => void;
}

export function createStdIo(): Io {
  return {
    log: (message) => process.stderr.write(`${message}\n`),
    error: (message) => process.stderr.write(`${message}\n`),
    out: (message) => process.stdout.write(`${message}\n`),
  };
}
