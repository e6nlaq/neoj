import { describe, expect, it } from "bun:test";

import { createAnsiStyles } from "@/lib/util/ansi";
import { compareOutput, displayWidth, formatComparison } from "@/lib/util/judge";

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

describe("displayWidth", () => {
    it("counts ASCII as one cell and East Asian characters as two", () => {
        expect(displayWidth("abc")).toBe(3);
        expect(displayWidth("あ")).toBe(2);
        expect(displayWidth("aあ")).toBe(3);
    });
});

describe("formatComparison", () => {
    const mismatched = compareOutput("a\nb\nc\n", "a\nx\nc\n", strict);
    const options = { styles: plain, columns: 120, sideBySide: true };

    it("prints every line and prefixes only the differing ones when stacked", () => {
        const lines = formatComparison(mismatched, { ...options, sideBySide: false });

        expect(lines).toEqual(["  a", "- b", "+ x", "  c"]);
    });

    it("prints both columns when the terminal is wide enough", () => {
        const lines = formatComparison(mismatched, options);

        expect(lines.some((line) => line.includes("│"))).toBe(true);
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain("a");
        expect(lines[1]).toContain("b");
        expect(lines[1]).toContain("x");
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
        });

        expect(colored[0]).not.toContain("\u001B[");
        expect(colored[1]).toContain("\u001B[31m");
        expect(colored[2]).toContain("\u001B[32m");
    });
});
