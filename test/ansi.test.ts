import { afterEach, describe, expect, it } from "bun:test";

import { createAnsiStyles, supportsColor } from "@/lib/util/ansi";

const originalNoColor = process.env.NO_COLOR;
const originalForceColor = process.env.FORCE_COLOR;

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

afterEach(() => {
    restoreEnvironmentVariable("NO_COLOR", originalNoColor);
    restoreEnvironmentVariable("FORCE_COLOR", originalForceColor);
});

describe("paint", () => {
    it("combines bold and a foreground color into one sequence", () => {
        const styles = createAnsiStyles(true);

        expect(styles.paint("x", { fg: "green", bold: true })).toBe("\u001B[1;32mx\u001B[0m");
        expect(styles.paint("x", { fg: "red" })).toBe("\u001B[31mx\u001B[0m");
    });

    it("leaves text untouched when styling is disabled or there is nothing to paint", () => {
        expect(createAnsiStyles(false).paint("x", { fg: "green", bold: true })).toBe("x");
        expect(createAnsiStyles(true).paint("", { fg: "green" })).toBe("");
        expect(createAnsiStyles(true).paint("x", {})).toBe("x");
    });
});

describe("supportsColor", () => {
    it("requires a TTY by default", () => {
        delete process.env.NO_COLOR;
        delete process.env.FORCE_COLOR;

        expect(supportsColor({ isTTY: true })).toBe(true);
        expect(supportsColor({ isTTY: false })).toBe(false);
        expect(supportsColor(undefined)).toBe(false);
    });

    it("treats a present NO_COLOR as disabled, even when it is empty", () => {
        delete process.env.FORCE_COLOR;
        process.env.NO_COLOR = "";

        expect(supportsColor({ isTTY: true })).toBe(false);
    });

    it("lets FORCE_COLOR override the TTY check", () => {
        process.env.NO_COLOR = "1";
        process.env.FORCE_COLOR = "1";

        expect(supportsColor({ isTTY: false })).toBe(true);
    });

    it("treats FORCE_COLOR=0 and false as disabled", () => {
        delete process.env.NO_COLOR;

        process.env.FORCE_COLOR = "0";
        expect(supportsColor({ isTTY: true })).toBe(false);

        process.env.FORCE_COLOR = "false";
        expect(supportsColor({ isTTY: true })).toBe(false);
    });
});
