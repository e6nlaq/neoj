import { describe, expect, it } from "bun:test";

import { reportLoginResult, type LoginReporter } from "@/feature/login";

function createReporter(): { messages: string[]; reporter: LoginReporter } {
    const messages: string[] = [];
    return {
        messages,
        reporter: {
            info: (message) => messages.push(`info: ${message}`),
            success: (message) => messages.push(`success: ${message}`),
            warn: (message) => messages.push(`warn: ${message}`),
        },
    };
}

describe("reportLoginResult", () => {
    it("prints the account name after a successful login", () => {
        const { messages, reporter } = createReporter();

        reportLoginResult("AtCoder", { username: "e6nlaq" }, reporter);

        expect(messages).toEqual(["success: Logged in to AtCoder as e6nlaq."]);
    });

    it("warns when the platform could not report the account name", () => {
        const { messages, reporter } = createReporter();

        reportLoginResult("ShareOJ", {}, reporter);

        expect(messages).toEqual([
            "success: Logged in to ShareOJ.",
            "warn: Could not read your ShareOJ username. The session is still saved.",
        ]);
    });

    it("treats a blank account name as missing", () => {
        const { messages, reporter } = createReporter();

        reportLoginResult("yukicoder", { username: "  \u0007 " }, reporter);

        expect(messages).toEqual([
            "success: Logged in to yukicoder.",
            "warn: Could not read your yukicoder username. The session is still saved.",
        ]);
    });

    it("reports a cancelled login without treating it as an error", () => {
        const { messages, reporter } = createReporter();

        reportLoginResult("AtCoder", undefined, reporter);

        expect(messages).toEqual(["info: Login cancelled."]);
    });

    it("strips terminal escape sequences from the account name", () => {
        const { messages, reporter } = createReporter();

        reportLoginResult(
            "ShareOJ",
            { username: "alice\u001B[2J\u001B]0;owned\u0007\nname" },
            reporter,
        );

        expect(messages).toEqual(["success: Logged in to ShareOJ as alice name."]);
    });
});
