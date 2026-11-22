import { describe, expect, it } from "bun:test";

import { parseShareOjMarkdownSamples } from "@neoj/api/shareoj";

describe("parseShareOjMarkdownSamples", () => {
    it("reads grouped samples and ignores code in the explanation", () => {
        const markdown = [
            "## 問題文",
            "入力は次の形式です。",
            "## サンプル 1",
            "### 入力",
            "```text",
            "1 2",
            "```",
            "### 出力",
            "```text",
            "3",
            "```",
            "計算の例:",
            "```text",
            "1 + 2 = 3",
            "```",
            "<!-- sample-end: case_001.txt -->",
            "## サンプル 2",
            "### 入力",
            "```text",
            "4 5",
            "```",
            "### 出力",
            "```text",
            "9",
            "```",
        ].join("\n");

        expect(parseShareOjMarkdownSamples(markdown)).toEqual([
            { input: "1 2", output: "3" },
            { input: "4 5", output: "9" },
        ]);
    });

    it("reads numbered input and output examples under a shared heading", () => {
        const markdown = [
            "## 入出力例",
            "### 入力例 1",
            "```text",
            "1",
            "```",
            "### 出力例 1",
            "```text",
            "2",
            "```",
            "補足:",
            "```text",
            "not a sample",
            "```",
            "### 入力例 2",
            "```text",
            "3",
            "```",
            "### 出力例 2",
            "```text",
            "4",
            "```",
        ].join("\n");

        expect(parseShareOjMarkdownSamples(markdown)).toEqual([
            { input: "1", output: "2" },
            { input: "3", output: "4" },
        ]);
    });

    it("ignores the input and output format sections and incomplete samples", () => {
        const markdown = [
            "## 入力",
            "```text",
            "N",
            "```",
            "## 出力",
            "```text",
            "answer",
            "```",
            "## サンプル 1",
            "### 入力",
            "```text",
            "1",
            "```",
        ].join("\n");

        expect(parseShareOjMarkdownSamples(markdown)).toEqual([]);
    });

    it("normalizes CRLF and keeps interior blank lines", () => {
        const markdown = [
            "### 入力例 1",
            "```",
            "a",
            "",
            "b",
            "```",
            "### 出力例 1",
            "```",
            "c",
            "```",
        ].join("\r\n");

        expect(parseShareOjMarkdownSamples(markdown)).toEqual([{ input: "a\n\nb", output: "c" }]);
    });
});
