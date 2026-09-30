/**
 * Platform helpers: PATH scanning conventions and Windows batch-shim handling.
 *
 * Node refuses to spawn `.cmd`/`.bat` files directly on win32. npm-installed
 * global CLIs (`pi`, `npm`, ...) therefore have to run through cmd.exe, the
 * same approach documented by other Pi launchers. Everything here is pure
 * and unit-tested.
 */

export type Platform = NodeJS.Platform;

export function isWindows(platform: Platform): boolean {
  return platform === "win32";
}

/** Whether a command must run through cmd.exe on the given platform. */
export function needsCmdShim(command: string, platform: Platform): boolean {
  return isWindows(platform) && /\.(cmd|bat)$/i.test(command);
}

/**
 * Quote one argument for a cmd.exe command line, following the C-runtime
 * argument rules (the same scheme Node's own spawning uses): quotes are
 * backslash-escaped, and backslashes are doubled when they precede a quote
 * or trail the argument (so the closing quote cannot be swallowed as `\"`).
 * Inside a quoted region, `& | < > ^ %` are not cmd special characters.
 */
export function quoteForCmd(arg: string): string {
  const escapedQuotes = arg.replace(/(\\*)"/g, '$1$1\\"');
  const escapedTrailing = escapedQuotes.replace(/(\\+)$/, "$1$1");
  return `"${escapedTrailing}"`;
}

/** Build the single command line handed to `cmd.exe /d /s /c`. */
export function buildCmdLine(executable: string, args: string[]): string {
  return [executable, ...args].map(quoteForCmd).join(" ");
}

/** PATH entry separator for the platform. */
export function pathDelimiter(platform: Platform): string {
  return isWindows(platform) ? ";" : ":";
}

/** Candidate executable file names for a CLI, in preference order. */
export function executableNames(bin: string, platform: Platform): string[] {
  // cmd first: it is the reliable npm shim; .ps1 is never spawnable.
  return isWindows(platform) ? [`${bin}.cmd`, `${bin}.exe`, `${bin}.bat`] : [bin];
}

/** Resolve the home directory without touching `os.homedir()` (testable). */
export function resolveHome(env: NodeJS.ProcessEnv, platform: Platform): string {
  const home = env.HOME ?? (isWindows(platform) ? env.USERPROFILE : undefined);
  if (home && home.trim() !== "") return home;
  throw new Error("Could not resolve the home directory (HOME/USERPROFILE are unset)");
}
