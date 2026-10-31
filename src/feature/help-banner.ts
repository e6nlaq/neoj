import type { Command } from "@commander-js/extra-typings";

import { version, author } from "../../package.json";

/**
 * The wordmark from `docs/assets/logo.svg`, rasterised at four tiles of 12x6
 * cells. Each line is trimmed, so the art is left-aligned in the help output.
 */
const ART_LINES = [
    "████████████  ████████████    ▄█████████          ████",
    "████████████  ████          ▄███████████          ▀▀▀▀",
    "████    ████  ████▄▄▄▄▄▄    ████████████",
    "████    ████  ████▀▀▀▀▀▀    ████████████          ████",
    "████    ████  ████          ███████████▀  ▄▄▄▄▄▄▄▄████",
    `████    ████  ████████████  █████████▀    ████████████  v${version} / by ${author.name}`,
] as const;

/** Banner text for the root help, ending with the blank line that follows it. */
export const helpBanner = `\n${ART_LINES.join("\n")}\n`;

/**
 * Show the banner above the root command's help. Subcommand help stays compact,
 * and usage errors keep their plain error output instead of a styled banner.
 */
export function applyHelpBanner(program: Command): void {
    program.addHelpText("before", ({ error }) => (error ? "" : helpBanner));
}
