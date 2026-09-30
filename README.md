# Cognix

**Cognix is a thin launcher/integration layer over the official Pi coding agent.**
`cognix` gives you a working Pi session with **gentle-pi + the Cognix
extension + the gentle-ai managed assets**, and `cognix update` keeps Pi,
gentle-pi and gentle-ai current — always through each project's own official
mechanisms.

## What Cognix is — and what it is NOT

| Cognix IS | Cognix is NOT |
|---|---|
| A launcher + bootstrap + integration CLI for Pi | A fork of Pi |
| A Pi package/extension (registers itself with Pi) | A vendored/copied Pi, gentle-pi, or gentle-ai |
| A thin npm/GitHub-distributed package | A second package manager for Pi |
| The trigger for documented `gentle-ai sync` runs | A parallel updater (Pi/gentle-ai update themselves) |
| | The chooser of your persona, components, or RDD mode — that is your call, e.g. via the `gentle-ai` TUI or `gentle-ai install --agent pi` |

**Pi stays the runtime.** Cognix decides *when* to request an operation; each
project decides *how* to perform it.

## Ownership

| Component | Owner |
|---|---|
| Agent runtime | **Pi** |
| Pi installation | Pi's official mechanism (`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`) |
| Pi updates | **Pi** (`pi update --self`) |
| gentle-pi installation | **Pi** (`pi install npm:gentle-pi`) |
| gentle-pi updates | **Pi** (`pi update npm:gentle-pi`) |
| Pi package management | **Pi** |
| gentle-ai binary install | **gentle-ai's official channels** (Homebrew / install.sh / `go install`) |
| gentle-ai updates | **gentle-ai** (`gentle-ai upgrade`) |
| gentle-ai managed assets | **gentle-ai** (`gentle-ai sync`) |
| Cognix ↔ Pi integration | **Cognix** |
| Cognix extension | **Cognix** |
| Cognix distribution | **npm + GitHub** |
| Cognix updates | **npm** (`npm install -g cognix`) |

> Cognix does not implement logic that duplicates Pi's install, update, or
> package-discovery behavior.

## Requirements

- Node.js **22.19+** with npm on PATH (used only to install Pi when missing).
- Pi itself is installed for you on first run if absent.
- gentle-ai is installed for you on first run too, via its official channel:
  Homebrew (macOS), the official `install.sh` (macOS/Linux), or `go install`
  (Windows — needs **Go 1.25.10+**; Windows binaries are temporarily
  unavailable upstream until Authenticode signing returns). If gentle-ai
  cannot be installed, Cognix warns clearly and continues: the Pi+gentle-pi
  core works without it.

## Installing Cognix

Cognix is installed globally with npm (it is a Node CLI, like Pi itself).

### From GitHub (available now)

No npm package is published yet — install straight from the repository:

```bash
npm install -g github:TecTroncoso/Cognix
```

Equivalent explicit form, and how to pin a tag or commit instead of `main`:

```bash
npm install -g git+https://github.com/TecTroncoso/Cognix.git
npm install -g github:TecTroncoso/Cognix#main
npm install -g github:TecTroncoso/Cognix#v1.0.0   # once a tag exists
```

What happens: npm clones the repo, installs dev dependencies, and runs the
package's `prepare` script, which builds `dist/` with `tsc` — no prebuilt
binaries, no extra tooling beyond **Node.js 22.19+** (npm and git ship with
it). Verify afterwards:

```bash
cognix --version
cognix doctor
```

Update later the same way (the Pi registration follows automatically):

```bash
npm install -g github:TecTroncoso/Cognix
```

### From the npm registry (pending)

```bash
npm install -g cognix
```

Will be available once the package is published.

### From a source checkout (development)

```bash
git clone https://github.com/TecTroncoso/Cognix.git
cd Cognix
npm install
npm run build
npm link   # makes `cognix` available globally from this checkout
```

## Commands

```bash
cognix                 # start a Pi session (bootstraps Pi + gentle-pi + cognix + gentle-ai on first run)
cognix update          # pi update --self · pi update/install npm:gentle-pi · gentle-ai upgrade · gentle-ai sync · re-verify
cognix doctor          # read-only diagnostics: versions, paths, registrations, gentle-ai scope
cognix --help          # this CLI's help
cognix --version       # cognix / pi / gentle-pi / gentle-ai versions
```

### Pass-through

Every argument Cognix does not own is forwarded to Pi **unchanged**; its
stdin/stdout/stderr and exit code are inherited:

```bash
cognix --mode rpc        # == pi --mode rpc
cognix -p "explain src"  # == pi -p "explain src"
cognix -c                # == pi --continue
cognix -- --help         # pi's own help (cognix owns plain --help)
cognix -- list           # pi list
```

Cognix's own status lines go to **stderr**, so Pi's stdout stays a clean
protocol channel in print/JSON/RPC modes.

### Pin policy

If Pi's settings pin gentle-pi (e.g. `npm:gentle-pi@3.7.0`, typically written
by gentle-ai tooling for release pairing), `cognix update` **keeps the pin**
and reports it. Move it intentionally with `pi install npm:gentle-pi`. Pins
are an explicit user/tool decision — Cognix never rewrites them quietly.

## How it works

1. **Locate Pi** — `COGNIX_PI` → PATH scan → well-known prefixes
   (Windows: `%APPDATA%\npm\pi.cmd`; Unix: `/usr/local/bin`, `/usr/bin`,
   `~/.local/bin`, `~/.npm-global/bin`). Verified with `pi --version`.
2. **Install Pi if absent** — `npm install -g --ignore-scripts
   @earendil-works/pi-coding-agent` (documented official mechanism).
3. **Ensure gentle-pi** — `pi install npm:gentle-pi` when no declaration
   exists; existing npm (pinned or not) and path-package declarations are
   reused as-is. A broken gentle-pi path entry is removed and reinstalled.
4. **Register Cognix** — `pi install <absolute path of the installed cognix
   package>` (Pi's official local-path package mechanism; the extension
   always matches the installed CLI, one copy of code on disk).
5. **Ensure gentle-ai (binary)** — `COGNIX_GENTLE_AI` → PATH →
   `~/go/bin`, brew prefixes, `/usr/local/bin`, `~/.local/bin`. If missing,
   installed through the official channel. Missing/impossible → warning and
   continue, never a blocker.
6. **Sync when slots changed** — the documented post-update steps:
   `gentle-ai sync` after the gentle-ai binary changes, and
   `gentle-ai sync --agent pi` after gentle-pi installs/repairs (the
   documented flag for targeting pi explicitly). Sync failures are surfaced
   as warnings, never fatal.
7. **Launch the real `pi`** with your arguments; its exit code becomes
   cognix's exit code.

Everything is idempotent: a second `cognix` run with a healthy setup performs
**zero** installs and **zero** syncs.

## Environment variables

| Variable | Effect |
|---|---|
| `COGNIX_PI` | Explicit path to a pi executable (dev/testing override) |
| `COGNIX_GENTLE_AI` | Explicit path to a gentle-ai executable (dev/testing override) |
| `PI_CODING_AGENT_DIR` | Pi's own agent-directory override (default `~/.pi/agent`) |
| `GENTLE_AI_YES=1` | gentle-ai's own switch: auto-accept its self-update prompt in scripts |

## Undo the Cognix registration

Cognix is a normal Pi local-path package declaration inside Pi settings:

```bash
cognix doctor          # shows the registered path
pi remove <that path>  # Pi's own package removal
npm uninstall -g cognix
```

Nothing else is left behind by Cognix; Pi's own state (sessions, credentials,
gentle-pi) stays under `~/.pi/agent`, and gentle-ai's managed assets stay
under `~/.gentle-ai` (removed via `gentle-ai uninstall` — gentle-ai's own
command — not by Cognix).

## Cross-platform notes

- Windows: npm global CLIs are `.cmd` shims — Node cannot spawn them directly,
  so Cognix runs them through `cmd.exe` with a single pre-quoted command line
  (arguments with spaces, quotes, and trailing backslashes survive). `pi.ps1`
  is never used as a spawn target.
- macOS/Linux: plain executables resolved from PATH and well-known prefixes.
- Exit codes are propagated; child stdio and environment are inherited;
  signals reach the child through the shared console/process group.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `npm is required to install Pi` | Install Node.js ≥ 22.19 (npm included), or install Pi manually (`curl -fsSL https://pi.dev/install.sh \| sh` on macOS/Linux) and re-run `cognix`. |
| `Found pi at … but it failed to run` | Broken/partial install: reinstall with `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`. If you set `COGNIX_PI`, fix or unset it. |
| `installed … but the pi executable could not be found` | PATH not refreshed after the first npm global install: open a new terminal, or set `COGNIX_PI` to the pi shim path. |
| `Pi settings … are not valid JSON` | Hand-fix or restore `~/.pi/agent/settings.json` (Pi itself also refuses malformed settings). |
| `gentle-pi is pinned to X` during update | Intentional: the pin is respected. Move it with `pi install npm:gentle-pi`. |
| `could not install gentle-ai automatically … Go is not on PATH` (Windows) | gentle-ai's official Windows channel is source-install: install Go 1.25.10+ (`winget install GoLang.Go`), or set `COGNIX_GENTLE_AI` to an existing binary. Core stack keeps working either way. |
| `gentle-ai upgrade exited …` | gentle-ai's own updater failed: run `gentle-ai upgrade` yourself to see its guidance (non-TTY runs auto-decline; `GENTLE_AI_YES=1` auto-accepts; GitHub rate limits need `GH_TOKEN`). |
| `gentle-ai sync … exited …` | Assets were not refreshed; run the shown command manually. Until sync succeeds, gentle-pi's RDD review operations fail closed (their design). |
| `cognix package: stale registration(s)` in doctor | The npm prefix moved; run `cognix update` (auto-repair) or `pi remove <old path>`. |
| pi not in gentle-ai's recorded agents | Optional: `gentle-ai install --agent pi` for gentle-ai to fully manage Pi (package stack, persona, components). Cognix syncs pi assets with `sync --agent pi` either way. |

## Development

```bash
npm install        # dev dependencies (local only)
npm test           # build + unit suite (node:test; fakes + temp dirs only; no network)
npm run e2e        # opt-in REAL isolated e2e: temp PI_CODING_AGENT_DIR, self-cleaning
npm run typecheck  # tsc --noEmit
npm run build      # tsc -> dist/
```

The unit suite never installs anything and never touches the real `~/.pi`.
The e2e script installs gentle-pi *into a temporary agent home* via the real
Pi, proves bootstrap + idempotency + passthrough, and deletes the temporary
home afterwards. It skips cleanly when pi/npm or network are unavailable.

See [docs/architecture.md](docs/architecture.md) for the full investigation
report and the delegation/deadline decisions this design rests on.
