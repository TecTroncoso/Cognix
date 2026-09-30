/**
 * Cognix's Pi extension entry.
 *
 * Loaded by Pi itself through the package mechanism (`pi.extensions` in
 * this package's manifest). It intentionally stays small: cognix's job is
 * done at the CLI layer (install, register, update, launch); inside the Pi
 * session the extension only identifies the layer and reminds users where
 * lifecycle commands live.
 *
 * The extension API is host-provided by Pi (peer dependency), so nothing
 * from Pi is bundled here.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findOwnPackage } from "../core/meta.js";

export default function cognixExtension(pi: ExtensionAPI): void {
  pi.registerCommand("cognix:status", {
    description: "Show the Cognix layer status (runtime, update command).",
    handler: async (_args, ctx) => {
      const own = findOwnPackage();
      ctx.ui.notify(
        own
          ? `cognix ${own.version} layer active — Pi is the runtime. Update everything with \`cognix update\` in your terminal.`
          : "cognix layer active — update everything with `cognix update` in your terminal.",
        "info",
      );
    },
  });
}
