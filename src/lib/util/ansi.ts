/** Terminal styling that can be switched off for pipes and dumb terminals. */
export interface AnsiStyles {
    readonly enabled: boolean;
    bold(text: string): string;
    dim(text: string): string;
    red(text: string): string;
    green(text: string): string;
    yellow(text: string): string;
    cyan(text: string): string;
}

const escape = "\u001B[";

function wrap(enabled: boolean, codes: readonly number[], text: string): string {
    if (!enabled) {
        return text;
    }

    return `${escape}${codes.join(";")}m${text}${escape}0m`;
}

/**
 * Whether ANSI styling should be enabled for a stream.
 *
 * `FORCE_COLOR` wins over the terminal check, and `NO_COLOR` is honored by
 * presence even when it is set to an empty string. `FORCE_COLOR=0` and
 * `FORCE_COLOR=false` explicitly disable styling.
 */
export function supportsColor(stream: { isTTY?: boolean } | undefined): boolean {
    const forceColor = process.env.FORCE_COLOR;
    if (forceColor !== undefined) {
        const normalized = forceColor.trim().toLowerCase();
        if (normalized === "0" || normalized === "false") {
            return false;
        }
        return true;
    }

    if ("NO_COLOR" in process.env) {
        return false;
    }

    return stream?.isTTY === true;
}

export function createAnsiStyles(enabled: boolean): AnsiStyles {
    return {
        enabled,
        bold: (text) => wrap(enabled, [1], text),
        dim: (text) => wrap(enabled, [2], text),
        red: (text) => wrap(enabled, [31], text),
        green: (text) => wrap(enabled, [32], text),
        yellow: (text) => wrap(enabled, [33], text),
        cyan: (text) => wrap(enabled, [36], text),
    };
}

// oxlint-disable-next-line no-control-regex -- terminal sequences start with ESC
const OSC_PATTERN = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu;
// oxlint-disable-next-line no-control-regex -- terminal sequences start with ESC
const CSI_PATTERN = /\u001B\[[0-9;?]*[ -/]*[@-~]/gu;
const CONTROL_PATTERN = /\p{Cc}/gu;

/**
 * Make text received from a service safe to print on one terminal line.
 *
 * Account names are user-controlled, so escape sequences are removed and any
 * remaining control characters collapse into spaces before display.
 */
export function sanitizeForTerminal(text: string): string {
    return text
        .replace(OSC_PATTERN, "")
        .replace(CSI_PATTERN, "")
        .replace(CONTROL_PATTERN, " ")
        .replace(/\s+/gu, " ")
        .trim();
}
