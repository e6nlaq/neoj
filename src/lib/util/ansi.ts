/** Colors used by the output comparison highlight. */
export type AnsiHighlightColor = "green" | "red";

/** One combined style for a comparison segment. */
export interface AnsiPaintOptions {
    /** Highlight foreground; green marks expected output, red marks actual output. */
    fg?: AnsiHighlightColor;
    /** Highlight background; green marks expected output, red marks actual output. */
    bg?: AnsiHighlightColor;
    bold?: boolean;
}

/** Terminal styling that can be switched off for pipes and dumb terminals. */
export interface AnsiStyles {
    readonly enabled: boolean;
    bold(text: string): string;
    dim(text: string): string;
    red(text: string): string;
    green(text: string): string;
    yellow(text: string): string;
    cyan(text: string): string;
    blue(text: string): string;
    /**
     * Apply one combined style in a single SGR sequence.
     *
     * Nested `bold(red(...))` calls cannot be tinted afterwards: the inner
     * reset also clears the background. Combining the codes here keeps a
     * background continuous across marked and unmarked segments.
     */
    paint(text: string, options: AnsiPaintOptions): string;
}

const escape = "\u001B[";

// 256-color palette entries that stay readable on both dark and light
// terminals: a dark foreground on a very light background.
const highlightForeground: Record<AnsiHighlightColor, readonly number[]> = {
    green: [38, 5, 28],
    red: [38, 5, 124],
};
const highlightBackground: Record<AnsiHighlightColor, readonly number[]> = {
    green: [48, 5, 194],
    red: [48, 5, 224],
};

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
        blue: (text) => wrap(enabled, [34], text),
        paint: (text, options) => {
            if (!enabled || text === "") {
                return text;
            }

            const codes: number[] = [];
            if (options.bold === true) {
                codes.push(1);
            }
            if (options.fg !== undefined) {
                codes.push(...highlightForeground[options.fg]);
            }
            if (options.bg !== undefined) {
                codes.push(...highlightBackground[options.bg]);
            }
            if (codes.length === 0) {
                return text;
            }

            return wrap(enabled, codes, text);
        },
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
