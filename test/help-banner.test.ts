import { describe, expect, it } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { applyHelpBanner, helpBanner } from "@/feature/help-banner";

function captureHelp(command: Command, context?: { error: boolean }): string {
    let output = "";
    const write = (text: string) => {
        output += text;
    };
    command.configureOutput({ writeOut: write, writeErr: write });
    command.outputHelp(context);
    return output;
}

describe("helpBanner", () => {
    it("starts with a blank line followed by six art lines", () => {
        const lines = helpBanner.split("\n");

        expect(lines[0]).toBe("");
        expect(lines.slice(1, 7)).toHaveLength(6);
        for (const line of lines.slice(1, 7)) {
            expect(line).not.toMatch(/\s+$/u);
        }
    });

    it("keeps the wordmark within 54 columns", () => {
        const art = helpBanner.split("\n").slice(1, 7);

        for (const line of art.slice(0, 5)) {
            expect(line.length).toBeLessThanOrEqual(54);
        }
    });

    it("credits the version and author after the wordmark", () => {
        const lastLine = helpBanner.split("\n")[6];

        expect(lastLine).toMatch(/ v\d+\.\d+\.\d+ \/ by \S+$/u);
    });

    it("uses plain text without ANSI escapes", () => {
        expect(helpBanner).not.toContain("\u001b");
    });
});

describe("applyHelpBanner", () => {
    it("places the banner above the root help", () => {
        const program = new Command("neoj").description("A CLI tool for neoj.");
        applyHelpBanner(program);

        const output = captureHelp(program);

        expect(output.startsWith(`${helpBanner}\n`)).toBe(true);
        expect(output).toContain("Usage: neoj");
    });

    it("leaves subcommand help unchanged", () => {
        const program = new Command("neoj");
        applyHelpBanner(program);
        const status = new Command("status").description("Check login status");
        program.addCommand(status);

        const output = captureHelp(status);

        expect(output).not.toContain(helpBanner);
        expect(output).toContain("Usage: neoj status");
    });

    it("hides the banner when help is shown for an error", () => {
        const program = new Command("neoj");
        applyHelpBanner(program);

        const output = captureHelp(program, { error: true });

        expect(output).not.toContain(helpBanner);
        expect(output).toContain("Usage: neoj");
    });
});
