import { describe, expect, it } from "bun:test";

import { createAnsiStyles } from "@/lib/util/ansi";
import { compareOutput, displayWidth, formatComparison, formatLinesTable } from "@/lib/util/judge";

const strict = { ignoreTrailingSpace: false, ignoreTrailingNewline: false };
const plain = createAnsiStyles(false);

describe("compareOutput", () => {
    it("accepts identical output", () => {
        const result = compareOutput("3 7\n", "3 7\n", strict);

        expect(result.matched).toBe(true);
        expect(result.firstMismatchLine).toBeUndefined();
        expect(result.trailingNewlineOnly).toBe(false);
    });

    it("normalizes CRLF before comparing", () => {
        expect(compareOutput("a\r\nb\r\n", "a\nb\n", strict).matched).toBe(true);
    });

    it("treats a missing trailing newline as a mismatch by default", () => {
        const result = compareOutput("a", "a\n", strict);

        expect(result.matched).toBe(false);
        expect(result.trailingNewlineOnly).toBe(true);
        expect(result.firstMismatchLine).toBe(2);
        expect(result.expectedTrailingNewline).toBe(false);
        expect(result.actualTrailingNewline).toBe(true);
    });

    it("ignores trailing newlines when asked", () => {
        const options = { ignoreTrailingSpace: false, ignoreTrailingNewline: true };

        expect(compareOutput("a", "a\n", options).matched).toBe(true);
        expect(compareOutput("a\n\n", "a\n", options).matched).toBe(true);
    });

    it("compares trailing whitespace strictly by default and leniently with the option", () => {
        const lenient = { ignoreTrailingSpace: true, ignoreTrailingNewline: false };

        expect(compareOutput("a  \n", "a\n", strict).matched).toBe(false);
        expect(compareOutput("a  \n", "a\n", lenient).matched).toBe(true);
        expect(compareOutput("a b\n", "a b \n", lenient).matched).toBe(true);
        expect(compareOutput("a  b\n", "a b\n", lenient).matched).toBe(false);
    });

    it("reports the first differing line and keeps every line", () => {
        const result = compareOutput("a\nb\nc\n", "a\nx\nc\n", strict);

        expect(result.matched).toBe(false);
        expect(result.firstMismatchLine).toBe(2);
        expect(result.expectedLines).toEqual(["a", "b", "c"]);
        expect(result.actualLines).toEqual(["a", "x", "c"]);
    });

    it("detects missing and extra lines", () => {
        expect(compareOutput("a\n", "a\nb\n", strict).firstMismatchLine).toBe(2);
        expect(compareOutput("a\nb\n", "a\n", strict).firstMismatchLine).toBe(2);
    });

    it("treats two empty outputs as equal", () => {
        expect(compareOutput("", "", strict).matched).toBe(true);
        expect(compareOutput("", "\n", strict).matched).toBe(false);
    });
});

describe("compareOutput with an error tolerance", () => {
    const tolerant = { ...strict, errorExponent: 6 };

    it("accepts an absolute error at the limit and rejects a larger one", () => {
        expect(compareOutput("0\n", "0.000001\n", tolerant).matched).toBe(true);
        expect(compareOutput("0\n", "0.0000011\n", tolerant).matched).toBe(false);
    });

    it("uses the expected value for the relative error", () => {
        expect(compareOutput("1000000\n", "1000000.5\n", tolerant).matched).toBe(true);
        expect(compareOutput("1000000\n", "1000002\n", tolerant).matched).toBe(false);
    });

    it("compares whitespace-separated tokens, ignoring line breaks", () => {
        expect(compareOutput("1 2\n3\n", "1\n2 3\n", tolerant).matched).toBe(true);
        expect(compareOutput("1 2\n", "1  2", tolerant).matched).toBe(true);
        expect(compareOutput("1 2\n", "1\n", tolerant).matched).toBe(false);
    });

    it("keeps non-numeric tokens exact", () => {
        const result = compareOutput("abc\n", "abd\n", tolerant);

        expect(result.matched).toBe(false);
        expect(result.firstMismatchLine).toBe(1);
        expect(result.numericMismatch).toBeUndefined();
    });

    it("does not treat hex or non-finite spellings as numbers", () => {
        expect(compareOutput("0x10\n", "16\n", tolerant).matched).toBe(false);
        expect(compareOutput("NaN\n", "NaN\n", tolerant).matched).toBe(true);
        expect(compareOutput("NaN\n", "nan\n", tolerant).matched).toBe(false);
    });

    it("accepts scientific notation and signed zero", () => {
        expect(compareOutput("1e-7\n", "0.0000001\n", tolerant).matched).toBe(true);
        expect(compareOutput("-0\n", "0\n", tolerant).matched).toBe(true);
    });

    it("reports the numeric pair that exceeded the tolerance", () => {
        const result = compareOutput("1 2.5\n3\n", "1 2.6\n3\n", tolerant);

        expect(result.matched).toBe(false);
        expect(result.firstMismatchLine).toBe(1);
        expect(result.numericMismatch).toEqual({ expected: "2.5", actual: "2.6" });
    });

    it("reports the line of a missing or extra token", () => {
        expect(compareOutput("1\n2\n", "1\n", tolerant).firstMismatchLine).toBe(2);
        expect(compareOutput("1\n", "1 2\n", tolerant).firstMismatchLine).toBe(2);
    });

    it("honours the requested exponent", () => {
        const lenient = { ...strict, errorExponent: 1 };

        expect(compareOutput("1\n", "1.01\n", lenient).matched).toBe(true);
        expect(compareOutput("1\n", "1.2\n", lenient).matched).toBe(false);
    });
});

describe("displayWidth", () => {
    it("counts ASCII as one cell and East Asian characters as two", () => {
        expect(displayWidth("abc")).toBe(3);
        expect(displayWidth("あ")).toBe(2);
        expect(displayWidth("aあ")).toBe(3);
    });
});

describe("formatComparison", () => {
    const mismatched = compareOutput("a\nb\nc\n", "a\nx\nc\n", strict);
    const options = { styles: plain, columns: 120, sideBySide: true, lineNumbers: false };

    it("stacks the expected and actual tables with headers", () => {
        const lines = formatComparison(mismatched, { ...options, sideBySide: false });

        expect(lines).toEqual(["Expected", "a", "b", "c", "", "Output", "a", "x", "c"]);
    });

    it("numbers every row when line numbers are on", () => {
        const lines = formatComparison(mismatched, {
            ...options,
            sideBySide: false,
            lineNumbers: true,
        });

        expect(lines).toEqual([
            "Line │ Expected",
            "   1 │ a",
            "   2 │ b",
            "   3 │ c",
            "",
            "Line │ Output",
            "   1 │ a",
            "   2 │ x",
            "   3 │ c",
        ]);
    });

    it("prints both columns when the terminal is wide enough", () => {
        const lines = formatComparison(mismatched, options);

        expect(lines).toEqual([
            "Expected │ Output",
            "a        │ a",
            "b        │ x",
            "c        │ c",
        ]);
    });

    it("keeps the line-number gutter in the side-by-side table", () => {
        const lines = formatComparison(mismatched, { ...options, lineNumbers: true });

        expect(lines).toEqual([
            "Line │ Expected │ Output",
            "   1 │ a        │ a",
            "   2 │ b        │ x",
            "   3 │ c        │ c",
        ]);
    });

    it("falls back to stacked output on narrow terminals", () => {
        const wide = compareOutput("aaaaaaaaaaaaaaaaaaaa\n", "bbbbbbbbbbbbbbbbbbbb\n", strict);
        const lines = formatComparison(wide, { ...options, columns: 30 });

        expect(lines.some((line) => line.includes("│"))).toBe(false);
    });

    it("falls back to stacked output when a line contains a tab", () => {
        const tabbed = compareOutput("a\tb\n", "a\tc\n", strict);
        const lines = formatComparison(tabbed, options);

        expect(lines.some((line) => line.includes("│"))).toBe(false);
    });

    it("leaves room for the report indent when measuring the table", () => {
        // 16 + 3 + 16 cells plus the 4-space report indent needs 39 columns.
        const exact = compareOutput(`${"x".repeat(16)}\n`, `${"y".repeat(16)}\n`, strict);

        expect(
            formatComparison(exact, { ...options, columns: 39 }).some((line) => line.includes("│")),
        ).toBe(true);
        expect(
            formatComparison(exact, { ...options, columns: 38 }).some((line) => line.includes("│")),
        ).toBe(false);
    });

    it("notes a trailing-newline-only difference", () => {
        const onlyNewline = compareOutput("a", "a\n", strict);
        const lines = formatComparison(onlyNewline, { ...options, sideBySide: false });

        expect(lines.at(-1)).toContain("trailing newline");
    });

    it("colors only the differing rows", () => {
        const colored = formatComparison(mismatched, {
            styles: createAnsiStyles(true),
            columns: 120,
            sideBySide: false,
            lineNumbers: false,
        });

        expect(colored.filter((line) => line.includes("\u001B[31m"))).toHaveLength(1);
        expect(colored.find((line) => line.includes("\u001B[31m"))).toContain("b");
        expect(colored.filter((line) => line.includes("\u001B[32m"))).toHaveLength(1);
        expect(colored.find((line) => line.includes("\u001B[32m"))).toContain("x");
        expect(colored[1]).not.toContain("\u001B[");
    });

    it("formats outputs with more lines than the spread argument limit", () => {
        const lineCount = 150_000;
        const large = compareOutput(
            `${"x\n".repeat(lineCount)}`,
            `${"y\n".repeat(lineCount)}`,
            strict,
        );

        const lines = formatComparison(large, options);

        expect(lines).toHaveLength(lineCount + 1);
        expect(lines[0]).toBe("Expected │ Output");
    });
});

describe("formatLinesTable", () => {
    it("renders a single-column table with a header", () => {
        expect(
            formatLinesTable(["1 2", "3"], { styles: plain, header: "Input", lineNumbers: true }),
        ).toEqual(["Line │ Input", "   1 │ 1 2", "   2 │ 3"]);
    });

    it("omits the gutter when line numbers are off", () => {
        expect(
            formatLinesTable(["1 2", "3"], { styles: plain, header: "Input", lineNumbers: false }),
        ).toEqual(["Input", "1 2", "3"]);
    });

    it("summarises the rows it was not given", () => {
        const lines = formatLinesTable(["a"], {
            styles: plain,
            header: "Output",
            lineNumbers: true,
            omitted: 7,
        });

        expect(lines.at(-1)).toBe("… 7 more line(s)");
    });

    it("does not pad the last column", () => {
        const lines = formatLinesTable(["a", "long"], {
            styles: plain,
            header: "Input",
            lineNumbers: true,
        });

        expect(lines).toEqual(["Line │ Input", "   1 │ a", "   2 │ long"]);
    });
});
