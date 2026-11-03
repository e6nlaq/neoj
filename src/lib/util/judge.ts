import type { AnsiStyles } from "./ansi";

export const caseVerdicts = ["AC", "WA", "TLE", "MLE", "RE", "UNJUDGED"] as const;

export type CaseVerdict = (typeof caseVerdicts)[number];

export interface ComparisonOptions {
    ignoreTrailingSpace: boolean;
    ignoreTrailingNewline: boolean;
}

export interface ComparisonResult {
    matched: boolean;
    expectedLines: readonly string[];
    actualLines: readonly string[];
    /** 1-based line number of the first difference, when there is one. */
    firstMismatchLine: number | undefined;
    /** The outputs only disagree on whether the text ends with a newline. */
    trailingNewlineOnly: boolean;
    expectedTrailingNewline: boolean;
    actualTrailingNewline: boolean;
}

export interface ComparisonFormatOptions {
    styles: AnsiStyles;
    columns: number;
    /** Try to place the expected and actual lines next to each other. */
    sideBySide: boolean;
}

export function normalizeLineEndings(text: string): string {
    return text.replaceAll("\r\n", "\n");
}

function splitOutput(text: string): string[] {
    const lines = text.split("\n");
    if (lines.length > 0 && lines.at(-1) === "") {
        lines.pop();
    }

    return lines;
}

function stripTrailingSpaces(lines: string[]): string[] {
    return lines.map((line) => line.replace(/[ \t\f\v]+$/u, ""));
}

function dropTrailingEmptyLines(lines: string[]): string[] {
    while (lines.length > 0 && lines.at(-1) === "") {
        lines.pop();
    }

    return lines;
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((line, index) => line === right[index]);
}

function firstDifferentLine(left: readonly string[], right: readonly string[]): number | undefined {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        if (left[index] !== right[index]) {
            return index + 1;
        }
    }

    return undefined;
}

/**
 * Compare program output with the expected output.
 *
 * CRLF is always normalized; the two leniency switches match `-S` and `-N`.
 */
export function compareOutput(
    expected: string,
    actual: string,
    options: ComparisonOptions,
): ComparisonResult {
    const expectedText = normalizeLineEndings(expected);
    const actualText = normalizeLineEndings(actual);
    const expectedTrailingNewline = expectedText.endsWith("\n");
    const actualTrailingNewline = actualText.endsWith("\n");

    let expectedLines = splitOutput(expectedText);
    let actualLines = splitOutput(actualText);
    if (options.ignoreTrailingSpace) {
        expectedLines = stripTrailingSpaces(expectedLines);
        actualLines = stripTrailingSpaces(actualLines);
    }
    if (options.ignoreTrailingNewline) {
        expectedLines = dropTrailingEmptyLines(expectedLines);
        actualLines = dropTrailingEmptyLines(actualLines);
    }

    const contentsEqual = sameLines(expectedLines, actualLines);
    const newlinesEqual =
        options.ignoreTrailingNewline || expectedTrailingNewline === actualTrailingNewline;
    const matched = contentsEqual && newlinesEqual;
    const trailingNewlineOnly = contentsEqual && !newlinesEqual;

    return {
        matched,
        expectedLines,
        actualLines,
        firstMismatchLine: matched
            ? undefined
            : (firstDifferentLine(expectedLines, actualLines) ?? expectedLines.length + 1),
        trailingNewlineOnly,
        expectedTrailingNewline,
        actualTrailingNewline,
    };
}

function isWideCharacter(codePoint: number): boolean {
    return (
        (codePoint >= 0x1100 && codePoint <= 0x115f) ||
        (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
        (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
        (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
        (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
        (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
        (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
        (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
        (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    );
}

/** Approximate terminal cells used by `text`, treating East Asian characters as double width. */
export function displayWidth(text: string): number {
    let width = 0;
    for (const character of text) {
        const codePoint = character.codePointAt(0) ?? 0;
        if (codePoint < 0x20 || codePoint === 0x7f) {
            continue;
        }
        width += isWideCharacter(codePoint) ? 2 : 1;
    }

    return width;
}

function padToWidth(text: string, width: number): string {
    return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

function rowsOf(result: ComparisonResult): number {
    return Math.max(result.expectedLines.length, result.actualLines.length);
}

function fitsSideBySide(result: ComparisonResult, columns: number): boolean {
    const lines = [...result.expectedLines, ...result.actualLines];
    if (lines.some((line) => line.includes("\t"))) {
        return false;
    }

    const left = Math.max(0, ...result.expectedLines.map((line) => displayWidth(line)));
    const right = Math.max(0, ...result.actualLines.map((line) => displayWidth(line)));

    return left + right + 5 <= columns;
}

function formatSideBySide(
    result: ComparisonResult,
    options: ComparisonFormatOptions,
    leftWidth: number,
    rightWidth: number,
): string[] {
    const { styles } = options;
    const lines: string[] = [];

    for (let index = 0; index < rowsOf(result); index += 1) {
        const expected = result.expectedLines[index];
        const actual = result.actualLines[index];
        const matched = expected !== undefined && actual !== undefined && expected === actual;
        const left = padToWidth(expected ?? "", leftWidth);
        const right = padToWidth(actual ?? "", rightWidth);

        if (matched) {
            lines.push(`  ${left} ${styles.dim("│")} ${right}`.trimEnd());
        } else {
            lines.push(`  ${styles.red(left)} ${styles.dim("│")} ${styles.green(right)}`.trimEnd());
        }
    }

    return lines;
}

function formatStacked(result: ComparisonResult, styles: AnsiStyles): string[] {
    const lines: string[] = [];

    for (let index = 0; index < rowsOf(result); index += 1) {
        const expected = result.expectedLines[index];
        const actual = result.actualLines[index];

        if (expected !== undefined && actual !== undefined && expected === actual) {
            lines.push(`  ${expected}`);
            continue;
        }
        if (expected !== undefined) {
            lines.push(styles.red(`- ${expected}`));
        }
        if (actual !== undefined) {
            lines.push(styles.green(`+ ${actual}`));
        }
    }

    return lines;
}

/**
 * Render every line of both outputs, highlighting the ones that differ.
 *
 * Side-by-side needs a wide terminal, no tabs, and both columns to fit; the
 * caller decides whether the terminal even qualifies.
 */
export function formatComparison(
    result: ComparisonResult,
    options: ComparisonFormatOptions,
): string[] {
    const sideBySide = options.sideBySide && fitsSideBySide(result, options.columns);
    const leftWidth = Math.max(0, ...result.expectedLines.map((line) => displayWidth(line)));
    const rightWidth = Math.max(0, ...result.actualLines.map((line) => displayWidth(line)));

    const lines = sideBySide
        ? formatSideBySide(result, options, leftWidth, rightWidth)
        : formatStacked(result, options.styles);

    if (result.trailingNewlineOnly) {
        lines.push(
            options.styles.dim(
                result.expectedTrailingNewline
                    ? "(the actual output has no trailing newline)"
                    : "(the expected output has no trailing newline)",
            ),
        );
    }

    return lines;
}
