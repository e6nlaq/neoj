/** Colors used by the output comparison highlight. */
export type AnsiHighlightColor = "green" | "red";

/** Background palette that matches the terminal's own background. */
export type AnsiTheme = "dark" | "light";

/** One combined style for a comparison segment. */
export interface AnsiPaintOptions {
    /** Highlight foreground; green marks expected output, red marks actual output. */
    fg?: AnsiHighlightColor;
    /** Highlight background; green marks expected output, red marks actual output. */
    bg?: AnsiHighlightColor;
    /** Palette for `bg` and the matching foreground; defaults to `light`. */
    theme?: AnsiTheme;
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
     * Combining the codes keeps a bold marked segment from resetting the
     * style of surrounding text before its own reset.
     */
    paint(text: string, options: AnsiPaintOptions): string;
}

const escape = "\u001B[";

// Text-only highlighting keeps the terminal's default color scheme.
const basicForeground: Record<AnsiHighlightColor, readonly number[]> = {
    green: [32],
    red: [31],
};

interface ThemePalette {
    fg: Record<AnsiHighlightColor, readonly number[]>;
    bg: Record<AnsiHighlightColor, readonly number[]>;
}

// A light terminal needs dark text on a pale tint; a dark terminal needs the
// opposite. The dark tint is deliberately desaturated so it stays subtle.
const lightPalette: ThemePalette = {
    fg: { green: [38, 5, 28], red: [38, 5, 124] },
    bg: { green: [48, 5, 194], red: [48, 5, 224] },
};
const darkPalette: ThemePalette = {
    fg: { green: [38, 2, 150, 200, 160], red: [38, 2, 220, 160, 160] },
    bg: { green: [48, 2, 24, 38, 30], red: [48, 2, 40, 26, 26] },
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
            if (options.bg === undefined) {
                if (options.fg !== undefined) {
                    codes.push(...basicForeground[options.fg]);
                }
            } else {
                const palette = options.theme === "dark" ? darkPalette : lightPalette;
                if (options.fg !== undefined) {
                    codes.push(...palette.fg[options.fg]);
                }
                codes.push(...palette.bg[options.bg]);
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
