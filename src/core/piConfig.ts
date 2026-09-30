/**
 * Reading of Pi's user-level configuration.
 *
 * Documented surface used here:
 * - The agent directory defaults to ~/.pi/agent and can be overridden with
 *   PI_CODING_AGENT_DIR (environment-variables.md, configuration.md).
 * - `settings.json` holds a `packages` array of npm/git/local Pi package
 *   sources; relative local paths resolve from the settings file
 *   (packages.md, settings.md).
 *
 * Cognix reads this file to detect what Pi will load. It never writes it;
 * all writes go through `pi install` / `pi remove`.
 */

import { isAbsolute, join, resolve } from "node:path";
import { errorMessage } from "./errors.js";
import type { FsLike } from "./fsLike.js";
import { PI_AGENT_DIR_ENV } from "./info.js";
import { resolveHome, type Platform } from "./platform.js";

export interface PiSettings {
  packages?: unknown;
  [key: string]: unknown;
}

export type SettingsState =
  | { kind: "ok"; path: string; settings: PiSettings }
  | { kind: "missing"; path: string }
  | { kind: "malformed"; path: string; error: string };

/** Agent directory Pi will use for user-level configuration. */
export function resolveAgentDir(env: NodeJS.ProcessEnv, platform: Platform): string {
  const override = env[PI_AGENT_DIR_ENV];
  if (override && override.trim() !== "") return override;
  return join(resolveHome(env, platform), ".pi", "agent");
}

/** Read and parse <agent-dir>/settings.json without modifying it. */
export function readPiSettings(fs: FsLike, agentDir: string): SettingsState {
  const path = join(agentDir, "settings.json");
  if (!fs.existsSync(path)) return { kind: "missing", path };
  try {
    const raw = fs.readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("settings.json must contain a JSON object");
    }
    return { kind: "ok", path, settings: parsed as PiSettings };
  } catch (error) {
    return { kind: "malformed", path, error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Package declarations
// ---------------------------------------------------------------------------

/** A `packages` entry can be a plain source string or an object with filters. */
export function packageEntrySource(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null) {
    const source = (entry as Record<string, unknown>).source;
    if (typeof source === "string" && source.trim() !== "") return source;
  }
  return null;
}

export function packageEntries(settings: PiSettings): string[] {
  const list = settings.packages;
  if (!Array.isArray(list)) return [];
  return list.map(packageEntrySource).filter((s): s is string => s !== null);
}

export interface NpmSource {
  name: string;
  /** Exact version pin, when the declaration carries one (`npm:pkg@1.2.3`). */
  pin: string | null;
}

/** Parse an `npm:<name>[@version]` source. Returns null for other sources. */
export function parseNpmSource(source: string): NpmSource | null {
  if (!source.startsWith("npm:")) return null;
  const spec = source.slice("npm:".length);
  if (spec.trim() === "") return null;
  // Scoped packages: "npm:@scope/name@1.0.0" — the pin separator must come
  // after the package name, never the scope-leading "@".
  const at = spec.lastIndexOf("@");
  if (at > 0) {
    const name = spec.slice(0, at);
    const pin = spec.slice(at + 1);
    if (name !== "" && pin !== "") return { name, pin };
  }
  return { name: spec, pin: null };
}

/** Is this source a local-path package (anything that is not npm/git/url)? */
export function isPathSource(source: string): boolean {
  return (
    !source.startsWith("npm:") &&
    !source.startsWith("git:") &&
    !/^https?:\/\//.test(source) &&
    !source.startsWith("ssh://")
  );
}

/**
 * Resolve a local-path package source the way Pi does: relative paths are
 * resolved from the settings file's directory; absolute paths are used
 * verbatim; `~` expands to the home directory.
 */
export function resolvePathSource(
  source: string,
  agentDir: string,
  env: NodeJS.ProcessEnv,
  platform: Platform,
): string {
  let value = source;
  if (value === "~" || value.startsWith("~/") || /^~[\\/]/.test(value)) {
    value = join(resolveHome(env, platform), value.slice(1));
  }
  return isAbsolute(value) ? resolve(value) : resolve(agentDir, value);
}

/** Normalize a path for identity comparison (case-insensitive on Windows). */
export function normalizePathIdentity(path: string, platform: Platform): string {
  const normalized = resolve(path).replace(/[\\/]+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function samePath(a: string, b: string, platform: Platform): boolean {
  return normalizePathIdentity(a, platform) === normalizePathIdentity(b, platform);
}

/** Read the `name` field of a package.json, tolerating any failure. */
export function readPackageName(fs: FsLike, packageDir: string): string | null {
  try {
    const manifestPath = join(packageDir, "package.json");
    if (!fs.existsSync(manifestPath)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const name = (parsed as Record<string, unknown>).name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}
