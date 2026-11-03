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

/** True when the stream is a terminal and `NO_COLOR` is not set. */
export function supportsColor(stream: { isTTY?: boolean } | undefined): boolean {
    if (stream?.isTTY !== true) {
        return false;
    }

    return !process.env.NO_COLOR;
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
