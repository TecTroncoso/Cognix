# Cognix — Investigation & Architecture Report (2026-09-30)

Cognix is a CLI layer on top of Pi. Pi is the runtime; gentle-pi is a Pi
package; Cognix is a Pi package. Nothing is forked, vendored, copied, or
patched. This document records the evidence behind every delegation decision.

## Sources consulted

| Source | What it established |
|---|---|
| `pi.dev/docs/latest/` (quickstart, cli, packages, extensions, settings, configuration, environment-variables, windows) | Pi's official install, package manager, config layout, update semantics |
| `github.com/earendil-works/pi` | npm package identity; `@mariozechner/pi-coding-agent` is deprecated in favor of `@earendil-works/pi-coding-agent` |
| `github.com/Gentleman-Programming/gentle-shell` (README + `docs/readme-reference.md`) | gentle-pi's official install ("Path B": `pi install npm:gentle-pi`), compatibility statement, launcher behavior |
| npm registry | `@earendil-works/pi-coding-agent@0.99.2`, `gentle-pi@3.7.0`; `cognix` and `cognix-cli` names are free |
| Reference machine (Windows 11, Node 24, npm 11, Pi 0.87.1 global) | Real `~/.pi/agent/settings.json` contains `"packages": ["npm:gentle-pi@3.7.0"]` |
| Isolated experiments (`PI_CODING_AGENT_DIR` pointed at a temp dir, `GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1`; deleted afterwards) | Empirical behavior of `pi install` / `pi update` / `pi remove` / `pi list` |

All experiments were reversible and never touched the user's real agent home.

## Empirically verified Pi behaviors (Pi 0.87.1)

1. `pi install npm:gentle-pi` records the declaration **unpinned**
   (`"npm:gentle-pi"`) and installs the current release.
2. A pinned declaration `npm:gentle-pi@3.5.1` is **respected**:
   `pi update npm:gentle-pi` and `pi update --extensions` print success but
   do not move the version (docs: "Versioned npm specifications are pinned").
   Re-running `pi install npm:gentle-pi` moves it to latest and rewrites the
   declaration unpinned.
3. `pi install` is idempotent by identity (npm → package name; local →
   resolved absolute path). Re-running never duplicates entries.
4. `pi install <abs-local-path>` records the path relativized from the
   settings file; `pi remove <abs-local-path>` removes it regardless.
5. npm-sourced packages land in `<agent-dir>/npm/node_modules/<name>`
   (observed on disk). Cognix does not depend on this layout.

## A. Architecture

```
user -> cognix CLI (Node 22.19+, TS)
        1. resolve pi (COGNIX_PI -> PATH -> well-known prefixes)
        2. missing?   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
        3. read <agent-dir>/settings.json (PI_CODING_AGENT_DIR || ~/.pi/agent)
        4. missing gentle-pi?  pi install npm:gentle-pi
        5. missing cognix?     pi install <absolute path of the cognix package>
        6. exec pi <args> (stdio inherited, exit code propagated)
```

Cognix ships both its CLI and its Pi extension in one npm package; the
extension is registered through Pi's official **local-path package**
mechanism (`pi.extensions` manifest key). The loaded extension therefore
always matches the installed CLI, with exactly one on-disk copy.

## B. Flow of `cognix`

Detection -> (install Pi if absent) -> (install/repair gentle-pi if needed)
-> (register/repair cognix) -> launch real `pi` with forwarded args.
Unknown arguments are forwarded verbatim; `cognix -- <args>` forwards
everything including Pi subcommands. Cognix chatter goes to stderr only —
Pi's stdout stays a clean protocol channel (print/JSON/RPC modes).

## C. Flow of `cognix update`

1. Ensure Pi exists (install if missing).
2. `pi update --self` (official self-update; npm- or installer-managed
   internally — not our business).
3. Re-probe `pi --version`; re-read settings.
4. gentle-pi: `pi update npm:gentle-pi`; install if absent; pinned
   declarations are kept and reported with the official way to move them
   (`pi install npm:gentle-pi`); path checkouts are left untouched.
5. Ensure + repair the Cognix registration.
6. Read-only post-verify: version probe, settings parse, registration and
   extension-file existence. No model calls.

## D. How Pi is installed

- Cross-platform official npm path (used by Cognix):
  `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
  (requires Node >= 22.19). On Windows this creates `pi.cmd`/`pi.ps1` in the
  global npm prefix.
- Official macOS/Linux alternative (`curl -fsSL https://pi.dev/install.sh | sh`)
  is only printed as guidance when npm is unavailable; Cognix does not run it.
- Uninstall is documented; `~/.pi/agent` survives uninstalling Pi.

## E. How gentle-pi is installed

- Official in-Pi mechanism ("Path B" in gentle-shell docs):
  `pi install npm:gentle-pi`. Unpinned, by policy — the gentle-shell README
  pins a version only for reproducibility of a specific release.
- Pi detects/loads it from the `packages` declaration in the effective agent
  home's `settings.json`; identity is the npm package name. Path-installed
  development checkouts are recognized by their package.json name — the same
  recognition rule the official launcher documents.
- Post-install note: gentle-shell docs recommend `gentle-ai sync` for the
  wider Gentle-AI asset set. Cognix surfaces the hint but does not implement
  it (gentle-ai is a separate product; Cognix does not build a parallel
  provisioner).
- We deliberately do **not** use "Path A" (the standalone `gentle-shell`
  launcher with its own home): Cognix's product is Pi + gentle-pi inside the
  user's own Pi home.

## E2. gentle-ai (binary) — official mechanisms (researched 2026-09-30)

gentle-ai (`Gentleman-Programming/gentle-ai`) is a Go CLI that owns the
*managed assets* (skills, personas, MCP configs, native review runtime).
Cognix integrates it like this:

- **Install the binary** (no npm package exists — verified 404):
  - macOS: `brew install gentleman-programming/tap/gentle-ai`
  - macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/scripts/install.sh | bash`
  - Windows: `go install github.com/gentleman-programming/gentle-ai/v4/cmd/gentle-ai@latest`
    (Quickstart: "`@latest` on `/v4` cannot resolve before v4.0.0 is
    published"; the latest stable tag lives on `/v3` — verified against
    proxy.golang.org: `/v3` → v3.7.0, `/v4` → pseudo-version from main.
    Cognix tries the documented `/v4` first, then falls back to `/v3`.
    Not a pin: `@latest` always tracks the newest published release line.)
- **Update the binary**: `gentle-ai upgrade` — its own self-updater
  (on Windows it runs a checksum-verified `go install` of the release tag
  and fails closed without Go). Interactive prompt stays under user control
  (TTY prompt; `GENTLE_AI_YES=1` auto-accepts in scripts — their documented
  switch).
- **Sync after updates (requested behavior, documented in their usage.md):**
  - `gentle-ai sync` — "Run it after replacing or upgrading the gentle-ai
    binary" (plain sync uses the recorded agent selection in
    `~/.gentle-ai/state.json`).
  - `gentle-ai sync --agent pi` — documented way to sync agents outside the
    stored selection; Cognix runs it after gentle-pi installs/updates
    (verified: `sync --agent pi --dry-run` works even when pi is not in
    `installed_agents`).
- **Scope consent.** Cognix never runs `gentle-ai install --agent pi` — that
  selects persona/components/RDD, which is the user's call (their TUI).
  Cognix reads the documented state file only to print guidance when pi is
  not recorded.
- **Failure mode.** gentle-ai is an enhancement layer over the Pi+gentle-pi
  core: when the binary is missing (e.g. Windows without Go), Cognix warns
  with exact guidance and continues. Sync failures are warnings, never fatal.

## F. How Cognix registers/loads in Pi

- `package.json` declares `"pi": { "extensions": ["./dist/src/extension/index.js"] }`
  and the `pi-package` keyword (official manifest format).
- Registration: `pi install <absolute path of the cognix package>` — the
  documented local-path source ("loaded from the resolved path without
  copying"). Idempotent by resolved-path identity; stale registrations that
  still resolve to another cognix directory are removed first.
- The extension is compiled JS with zero runtime dependencies (Pi supplies
  the extension API as a host peer).

## G. What stays global on the system

- The `pi` executable (npm global prefix), installed only when absent.
- `~/.pi/agent/` (or `$PI_CODING_AGENT_DIR`): Pi's own directory —
  `settings.json` with the `npm:gentle-pi` and cognix path declarations,
  Pi-managed package installs, sessions, credentials, and whatever gentle-pi's
  own postinstall persists there.
- Nothing else. Cognix holds no runtime state of its own.

## H. What stays inside the Cognix repo

Only Cognix code, tests, docs, and tooling
(`package.json`, `tsconfig.json`, `src/cli`, `src/core`, `src/extension`,
`test`, `docs`). No Pi sources, no gentle-pi sources, no forks.

## I. Official Pi commands Cognix delegates

| Action | Command |
|---|---|
| Install Pi | `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` |
| Probe Pi | `pi --version` |
| Install gentle-pi | `pi install npm:gentle-pi` |
| Update Pi | `pi update --self` |
| Update gentle-pi | `pi update npm:gentle-pi` |
| Install gentle-ai (binary) | brew / official install.sh / `go install …/v4`→`…/v3` (per platform docs) |
| Update gentle-ai | `gentle-ai upgrade` (its own updater) |
| Sync managed assets | `gentle-ai sync`, `gentle-ai sync --agent pi` |
| Register/unregister Cognix | `pi install <abs path>` / `pi remove <abs path>` |
| Diagnostics | `pi list` (display only; truth source is settings.json) |
| Run | `pi [forwarded args]` |

Public surfaces relied on: npm package name, `pi` bin, documented subcommands
and source formats, `~/.pi/agent` + `PI_CODING_AGENT_DIR`, `settings.json`'s
`packages` array, the `pi.extensions` manifest.

Internal details deliberately NOT relied on: `<agent-dir>/npm/node_modules`
layout, `pi update`'s internal self-update strategy, `pi list` output format,
Pi's lock files.

## J. Risks & decisions

1. **Pins are respected, never moved.** The reference machine's
   `npm:gentle-pi@3.7.0` pin was written by gentle-ai tooling; silently
   unpinning it would fight that tool's release pairing. `cognix update`
   reports the pin and prints the official command to move it.
2. **No hardcoded version floors.** gentle-pi 3.7.0's npm manifest declares
   peer `@earendil-works/pi-coding-agent >=0.85.1` while its docs state
   "requires Pi 0.99.1 or newer" — a documentation/manifest discrepancy.
   Cognix installs/upgrades to latest of both (which satisfies the pairing)
   and lets gentle-pi's own runtime gate report incompatibility. Nothing is
   hardcoded.
3. **Cognix self-update is via npm (`npm install -g cognix`), not via
   `cognix update`** (scope decision; the Pi registration follows the path).
4. **Unattributable stale entries**: if the global npm prefix moves so that
   an old cognix path entry no longer exists, its package name cannot be read
   back, so it cannot be safely identified as cognix. `doctor` reports it;
   removal is manual (`pi remove <path>`). Accepted limitation.
5. **Windows shims**: `.cmd`/`.bat` run through `cmd.exe /d /s /c` with the
   whole invocation as one pre-quoted verbatim command line (Node cannot
   spawn batch files directly; per-arg quoting breaks cmd's `/c` parser —
   verified empirically and fixed during development).
6. **Extension runtime-load check is manual**: the isolated E2E proved
   registration + `pi --help`/`--version` with the package declared; the
   in-session `/cognix:status` execution is verified by the user on first
   real run. The reference machine's Pi 0.87.1 vs gentle-pi's documented
   0.99.1 floor: `cognix update` brings Pi current first.

## Decisions pending user confirmation

- Package/name `cognix` on npm (free at research time).
- English CLI output, Spanish/whatever-user-uses inside Pi's persona is
  gentle-pi's domain.
- No `cognix self-update` command for now.
- **Distribution via GitHub** (added by request): Cognix is installable with
  `npm install -g github:TecTroncoso/Cognix` — the `prepare` script builds
  `dist/` on git-based installs. No separate release/binary pipeline exists
  yet; once the repo is pushed, this channel works as-is.

## gentle-ai scope decisions (added on request)

- Cognix installs/upgrades the **binary** through official channels and runs
  the documented `sync` steps after gentle-ai / gentle-pi changes.
- Cognix does **not** choose persona/components/RDD (`gentle-ai install
  --agent pi` stays a user action; surfaced as guidance).
- gentle-pi's companion Pi packages (gentle-engram, pi-web-access, pi-btw)
  are installed by `gentle-ai install --agent pi` itself when the user opts
  into it — outside Cognix's default scope.
- gentle-ai unavailability never blocks the Pi core (warn + continue).

---

## Ownership (binding rule)

> Cognix decides WHEN to request an operation. Pi decides HOW to perform it.
> Cognix never implements logic that duplicates Pi's install, update, or
> package-discovery behavior.

| Component | Owner |
|---|---|
| Agent runtime | Pi |
| Pi installation | Pi's official npm mechanism |
| Pi updates | Pi (`pi update --self`) |
| gentle-pi install/update | Pi (`pi install` / `pi update`) |
| Pi package discovery/management | Pi (`settings.json` + `pi install|remove|list|config`) |
| gentle-ai binary install | gentle-ai channels (brew / install.sh / go install) |
| gentle-ai binary updates | gentle-ai (`gentle-ai upgrade`) |
| gentle-ai managed assets | gentle-ai (`gentle-ai sync`) |
| Cognix ↔ Pi integration | Cognix |
| Cognix extension | Cognix |
| Cognix distribution/updates | npm / GitHub (`npm i -g cognix` / `npm i -g github:TecTroncoso/Cognix`) |

## Post-review hardening (final pass)

Applied without changing the architecture:

1. **cmd.exe quoting fix (Windows correctness).** `quoteForCmd` now follows
   the C-runtime scheme also used by Node: backslashes are doubled before a
   quote and when trailing the argument, so the closing quote can no longer
   be swallowed as `\"` (paths ending in a backslash previously produced a
   broken argument). A previous unit test that pinned the wrong behavior was
   corrected.
2. **Deduped Pi delegation.** `runPiOrThrow` existed twice
   (gentlePi.ts/cognixPackage.ts); both now use `core/piCommands.ts`.
3. **Real local process tests** (`test/process.test.ts`): stdout/stderr and
   exit-code propagation through `capture`/`interactive`, argument fidelity
   with spaces/quotes via real `node` children, and a real throwaway `.cmd`
   shim test on Windows. No installs, no network.
4. **Isolated E2E as a script** (`scripts/e2e.mjs`, `npm run e2e`):
   temp `PI_CODING_AGENT_DIR`, real Pi bootstrap (gentle-pi installed by Pi
   itself into the temp home), idempotency re-run, declaration verification,
   bogus-flag exit-code propagation, guaranteed cleanup. Scenario A runs with
   a fake gentle-ai shim recording invocations (asserts `sync --agent pi`
   fires after the gentle-pi install and stays silent on idempotent re-runs);
   scenario B masks PATH/HOME to prove graceful degradation when gentle-ai
   is unavailable. Skips cleanly without pi/npm/network. Never runs
   `cognix update` (that would update the *user's* global Pi), never installs
   Cognix globally, never touches a real gentle-ai.
5. **`cognix --version` tolerates unreadable settings** (reports
   "unknown" for gentle-pi instead of failing); dead type removed;
   `pathDelimiter` shared between resolvers.
6. Docs extended: what Cognix is NOT, ownership table, undo instructions,
   troubleshooting, cross-platform notes (README.md).

Verified against the live docs on review day: `pi.dev` CLI/packages/settings
pages unchanged for every surface Cognix delegates to; npm latest at
`@earendil-works/pi-coding-agent@0.99.2`, `gentle-pi@3.7.0`.
