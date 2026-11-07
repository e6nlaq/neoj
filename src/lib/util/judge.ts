import type { AnsiStyles } from "@/lib/util/ansi";
import { maxValue } from "@/lib/util/numbers";

export const caseVerdicts = ["AC", "WA", "TLE", "MLE", "RE", "UNJUDGED"] as const;

export type CaseVerdict = (typeof caseVerdicts)[number];

export interface ComparisonOptions {
    ignoreTrailingSpace: boolean;
    ignoreTrailingNewline: boolean;
    /**
     * When set, compare whitespace-separated tokens and accept a numeric
     * difference of up to `10 ** -errorExponent` instead of comparing text.
     */
    errorExponent?: number;
}

/** Range accepted by `neoj test --error` and `test.error`. */
export const errorExponentBounds = { min: 0, max: 15 } as const;

/** The pair of numeric tokens behind a tolerance failure, kept for the report. */
export interface NumericMismatch {
    expected: string;
    actual: string;
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
    /** Set when the first difference is two numbers that exceed the tolerance. */
    numericMismatch: NumericMismatch | undefined;
}

export interface ComparisonFormatOptions {
    styles: AnsiStyles;
    columns: number;
    /** Try to place the expected and actual lines next to each other. */
    sideBySide: boolean;
    /** Prefix every row with a right-aligned line number. */
    lineNumbers: boolean;
}

export interface LinesTableOptions {
    styles: AnsiStyles;
    /** Column header, such as "Input" or "Output". */
    header: string;
    /** Prefix every row with a right-aligned line number. */
    lineNumbers: boolean;
    /** Rows the caller dropped from the end of the table. */
    omitted?: number;
}

const lineNumberHeader = "Line";

interface TableCell {
    text: string;
    color?: "red" | "green";
}

interface TableRow {
    /** 1-based line number shown in the gutter. */
    number: number;
    cells: readonly TableCell[];
}

function toRows(lines: readonly string[]): TableRow[] {
    return lines.map((text, index) => ({ number: index + 1, cells: [{ text }] }));
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

/** Decimal and scientific notation only; hex, `NaN`, and `Infinity` stay text. */
const numericTokenPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

/** ASCII whitespace, which is what judges treat as a token separator. */
function isTokenSeparator(char: string): boolean {
    return (
        char === " " ||
        char === "\t" ||
        char === "\n" ||
        char === "\r" ||
        char === "\f" ||
        char === "\v"
    );
}

interface OutputToken {
    text: string;
    /** 1-based line the token starts on. */
    line: number;
}

function splitTokens(text: string): OutputToken[] {
    const tokens: OutputToken[] = [];
    let line = 1;
    let index = 0;
    while (index < text.length) {
        const char = text[index]!;
        if (char === "\n") {
            line += 1;
            index += 1;
            continue;
        }
        if (isTokenSeparator(char)) {
            index += 1;
            continue;
        }

        let end = index;
        while (end < text.length) {
            const next = text[end]!;
            if (next === "\n" || isTokenSeparator(next)) {
                break;
            }
            end += 1;
        }
        tokens.push({ text: text.slice(index, end), line });
        index = end;
    }

    return tokens;
}

function withinTolerance(actual: number, expected: number, exponent: number): boolean {
    return Math.abs(actual - expected) <= 10 ** -exponent * Math.max(1, Math.abs(expected));
}

interface TokenComparison {
    matched: boolean;
    firstMismatchLine: number | undefined;
    numericMismatch: NumericMismatch | undefined;
}

function compareTokens(
    expected: string,
    actual: string,
    exponent: number,
    expectedLineCount: number,
): TokenComparison {
    const expectedTokens = splitTokens(expected);
    const actualTokens = splitTokens(actual);
    const length = Math.max(expectedTokens.length, actualTokens.length);

    for (let index = 0; index < length; index += 1) {
        const left = expectedTokens[index];
        const right = actualTokens[index];
        if (left === undefined) {
            // The actual output has tokens the expected output never had.
            return {
                matched: false,
                firstMismatchLine: expectedLineCount + 1,
                numericMismatch: undefined,
            };
        }
        if (right === undefined) {
            return { matched: false, firstMismatchLine: left.line, numericMismatch: undefined };
        }
        if (left.text === right.text) {
            continue;
        }

        if (numericTokenPattern.test(left.text) && numericTokenPattern.test(right.text)) {
            const expectedValue = Number(left.text);
            const actualValue = Number(right.text);
            if (
                Number.isFinite(expectedValue) &&
                Number.isFinite(actualValue) &&
                withinTolerance(actualValue, expectedValue, exponent)
            ) {
                continue;
            }

            return {
                matched: false,
                firstMismatchLine: left.line,
                numericMismatch: { expected: left.text, actual: right.text },
            };
        }

        return { matched: false, firstMismatchLine: left.line, numericMismatch: undefined };
    }

    return { matched: true, firstMismatchLine: undefined, numericMismatch: undefined };
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

    if (options.errorExponent !== undefined) {
        const compared = compareTokens(
            expectedText,
            actualText,
            options.errorExponent,
            expectedLines.length,
        );
        // Whitespace is a separator, so trailing-newline differences cannot
        // make the output wrong once a tolerance is requested.
        return {
            matched: compared.matched,
            expectedLines,
            actualLines,
            firstMismatchLine: compared.firstMismatchLine,
            trailingNewlineOnly: false,
            expectedTrailingNewline,
            actualTrailingNewline,
            numericMismatch: compared.numericMismatch,
        };
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
        numericMismatch: undefined,
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

function padCell(text: string, width: number): string {
    return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

function formatTableRow(
    number: string | undefined,
    cells: readonly TableCell[],
    widths: readonly number[],
    numberWidth: number,
    styles: AnsiStyles,
): string {
    const parts: string[] = [];
    if (number !== undefined) {
        parts.push(styles.dim(number.padStart(numberWidth)));
    }
    for (const [index, cell] of cells.entries()) {
        const padded =
            index === cells.length - 1 ? cell.text : padCell(cell.text, widths[index] ?? 0);
        parts.push(cell.color === undefined ? padded : styles[cell.color](padded));
    }

    return parts.join(` ${styles.dim("│")} `).trimEnd();
}

/**
 * Render a table whose first row names the columns.
 *
 * The line-number gutter is optional; the last column is never padded, so no
 * line ends with whitespace.
 */
function formatTable(
    headers: readonly string[],
    rows: readonly TableRow[],
    styles: AnsiStyles,
    lineNumbers: boolean,
): string[] {
    const numberWidth = lineNumbers
        ? Math.max(lineNumberHeader.length, String(rows.length).length)
        : 0;
    const widths = headers.map((header, index) =>
        maxValue(
            rows.map((row) => displayWidth(row.cells[index]?.text ?? "")),
            displayWidth(header),
        ),
    );

    const lines = [
        styles.dim(
            formatTableRow(
                lineNumbers ? lineNumberHeader.padEnd(numberWidth) : undefined,
                headers.map((header) => ({ text: header })),
                widths,
                numberWidth,
                styles,
            ),
        ),
    ];
    for (const row of rows) {
        lines.push(
            formatTableRow(
                lineNumbers ? String(row.number) : undefined,
                row.cells,
                widths,
                numberWidth,
                styles,
            ),
        );
    }

    return lines;
}

function columnWidthsOf(result: ComparisonResult): { left: number; right: number } {
    return {
        left: maxValue(
            result.expectedLines.map((line) => displayWidth(line)),
            displayWidth("Expected"),
        ),
        right: maxValue(
            result.actualLines.map((line) => displayWidth(line)),
            displayWidth("Output"),
        ),
    };
}

/** Indent used by the report; the table has to fit next to it. */
const reportIndentWidth = 4;

function fitsSideBySide(result: ComparisonResult, columns: number, lineNumbers: boolean): boolean {
    const lines = [...result.expectedLines, ...result.actualLines];
    if (lines.some((line) => line.includes("\t"))) {
        return false;
    }

    const widths = columnWidthsOf(result);
    const rowCount = Math.max(result.expectedLines.length, result.actualLines.length);
    const numberWidth = lineNumbers
        ? Math.max(lineNumberHeader.length, String(rowCount).length)
        : 0;
    const textWidth = widths.left + 3 + widths.right;
    const gutterWidth = lineNumbers ? numberWidth + 3 : 0;

    return gutterWidth + textWidth + reportIndentWidth <= columns;
}

/**
 * Render both outputs as a table: side by side when it fits, otherwise as two
 * stacked tables that keep the headers. Differing rows stay colored.
 */
export function formatComparison(
    result: ComparisonResult,
    options: ComparisonFormatOptions,
): string[] {
    const { styles, lineNumbers } = options;
    const lines: string[] = [];
    const rowCount = Math.max(result.expectedLines.length, result.actualLines.length);
    const mismatched = (index: number): boolean =>
        result.expectedLines[index] !== result.actualLines[index];

    if (options.sideBySide && fitsSideBySide(result, options.columns, lineNumbers)) {
        const rows: TableRow[] = [];
        for (let index = 0; index < rowCount; index += 1) {
            const expected = result.expectedLines[index];
            const actual = result.actualLines[index];
            rows.push({
                number: index + 1,
                cells: [
                    { text: expected ?? "", color: mismatched(index) ? "red" : undefined },
                    { text: actual ?? "", color: mismatched(index) ? "green" : undefined },
                ],
            });
        }
        lines.push(...formatTable(["Expected", "Output"], rows, styles, lineNumbers));
    } else {
        const expectedRows: TableRow[] = result.expectedLines.map((text, index) => ({
            number: index + 1,
            cells: [{ text, color: mismatched(index) ? "red" : undefined }],
        }));
        const actualRows: TableRow[] = result.actualLines.map((text, index) => ({
            number: index + 1,
            cells: [{ text, color: mismatched(index) ? "green" : undefined }],
        }));
        lines.push(...formatTable(["Expected"], expectedRows, styles, lineNumbers));
        lines.push("");
        lines.push(...formatTable(["Output"], actualRows, styles, lineNumbers));
    }

    if (result.trailingNewlineOnly) {
        lines.push(
            styles.dim(
                result.expectedTrailingNewline
                    ? "(the actual output has no trailing newline)"
                    : "(the expected output has no trailing newline)",
            ),
        );
    }

    return lines;
}

/** Render one block, such as the input or the program's output, as a table. */
export function formatLinesTable(lines: readonly string[], options: LinesTableOptions): string[] {
    const formatted = formatTable(
        [options.header],
        toRows(lines),
        options.styles,
        options.lineNumbers,
    );
    const omitted = options.omitted ?? 0;
    if (omitted > 0) {
        formatted.push(options.styles.dim(`… ${omitted} more line(s)`));
    }

    return formatted;
}
