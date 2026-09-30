/**
 * Error type used for expected, user-actionable failures.
 * `hints` are rendered as follow-up suggestions by the CLI.
 */
export class CognixError extends Error {
  readonly hints: string[];

  constructor(message: string, hints: string[] = []) {
    super(message);
    this.name = "CognixError";
    this.hints = hints;
  }
}

/** Extract a printable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
