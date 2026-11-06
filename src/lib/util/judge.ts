import type { AnsiStyles } from "@/lib/util/ansi";
import { maxValue } from "@/lib/util/numbers";

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
