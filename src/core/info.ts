/**
 * Official identifiers of the external products Cognix delegates to.
 *
 * Everything here is part of a documented public surface:
 * - Pi's npm package name and `pi` bin      -> https://pi.dev/docs/latest/quickstart
 * - gentle-pi's npm source for `pi install`  -> gentle-shell docs ("Path B")
 * - PI_CODING_AGENT_DIR                      -> https://pi.dev/docs/latest/environment-variables
 *
 * Cognix never forks, vendors, or re-implements these products.
 */

/** Official npm package of the Pi coding agent runtime. */
export const PI_NPM_PACKAGE = "@earendil-works/pi-coding-agent";

/** Executable name exposed by the Pi package. */
export const PI_BIN = "pi";

/** Official Pi package source for gentle-pi, as used with `pi install`. Unpinned on purpose. */
export const GENTLE_PI_NPM_SOURCE = "npm:gentle-pi";

/** npm package name of gentle-pi (identity used in Pi package declarations). */
export const GENTLE_PI_PACKAGE_NAME = "gentle-pi";

/** npm package name of Cognix itself (identity used in Pi package declarations). */
export const COGNIX_PACKAGE_NAME = "cognix";

/** Environment variable Pi itself reads to locate its agent directory. */
export const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** Optional Cognix override: explicit path to a pi executable (development/testing hook). */
export const COGNIX_PI_ENV = "COGNIX_PI";

/** Optional Cognix override: explicit path to a gentle-ai executable. */
export const COGNIX_GENTLE_AI_ENV = "COGNIX_GENTLE_AI";

/** gentle-ai CLI binary name. */
export const GENTLE_AI_BIN = "gentle-ai";

/** Official install channels for the gentle-ai binary (docs/quickstart.md, README). */
export const GENTLE_AI_BREW_FORMULA = "gentleman-programming/tap/gentle-ai";
export const GENTLE_AI_INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/scripts/install.sh";
/** Official `go install` module path (v4 line of the current docs). */
export const GENTLE_AI_GO_MODULE_V4 = "github.com/gentleman-programming/gentle-ai/v4/cmd/gentle-ai@latest";
/**
 * Fallback for the pre-v4.0.0 window: the docs state `@latest` on `/v4`
 * cannot resolve until v4.0.0 is published, while the latest stable tag is
 * published on the `/v3` module path (v3.7.0 at research time). `@latest`
 * here tracks the newest stable tag — it is not a version pin.
 */
export const GENTLE_AI_GO_MODULE_V3 = "github.com/gentleman-programming/gentle-ai/v3/cmd/gentle-ai@latest";

export const GENTLE_AI_DOCS = "https://github.com/Gentleman-Programming/gentle-ai";

/** Official npm install command for Pi (documented; scripts are not required). */
export const PI_INSTALL_ARGS = ["install", "-g", "--ignore-scripts", PI_NPM_PACKAGE] as const;

/** Official installer shown to users when npm is unavailable. */
export const PI_INSTALLER_HINT = "curl -fsSL https://pi.dev/install.sh | sh  (macOS/Linux)";
