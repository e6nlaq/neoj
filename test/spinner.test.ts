import { describe, expect, it } from "bun:test";

import { createSpinner, createSpinnerSequence, withSpinner } from "@/lib/util/spinner";

function createCapture(isTTY: boolean): {
    stream: { write(chunk: string): boolean; isTTY: boolean };
    chunks: string[];
    text(): string;
} {
    const chunks: string[] = [];
    return {
        stream: {
            write(chunk: string) {
                chunks.push(chunk);
                return true;
            },
            isTTY,
        },
        chunks,
        text: () => chunks.join(""),
    };
}

describe("createSpinner", () => {
    it("draws nothing into a pipe", () => {
        const capture = createCapture(false);
        const spinner = createSpinner({ text: "Working…", stream: capture.stream });

        expect(spinner.enabled).toBe(false);
        spinner.stop();

        expect(capture.chunks).toEqual([]);
    });

    it("stays off when the caller disables it on a terminal", () => {
        const capture = createCapture(true);
        const spinner = createSpinner({ text: "Working…", stream: capture.stream, enabled: false });

        expect(spinner.enabled).toBe(false);
        spinner.stop();

        expect(capture.chunks).toEqual([]);
    });

    it("draws the message and clears it again on stop", () => {
        const capture = createCapture(true);
        const spinner = createSpinner({ text: "Working…", stream: capture.stream });

        expect(spinner.enabled).toBe(true);
        expect(capture.text()).toContain("Working…");

        capture.chunks.length = 0;
        spinner.stop();
        expect(capture.text()).not.toContain("Working…");

        // Stopping twice must not write another frame or restore the cursor twice.
        capture.chunks.length = 0;
        spinner.stop();
        expect(capture.chunks).toEqual([]);
    });
});

describe("withSpinner", () => {
    it("removes the spinner when the task rejects", async () => {
        const capture = createCapture(true);

        await expect(
            withSpinner({ text: "Working…", stream: capture.stream }, async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");

        expect(capture.chunks.at(-1)).toContain("\u001B[?25h");
    });
});

describe("createSpinnerSequence", () => {
    it("clears each step before drawing the next", () => {
        const capture = createCapture(true);
        const sequence = createSpinnerSequence(capture.stream);

        sequence.start("Building one…");
        expect(capture.text()).toContain("Building one…");

        sequence.start("Building two…");
        expect(capture.text()).toContain("Building two…");

        sequence.end();
        expect(capture.chunks.at(-1)).toContain("\u001B[?25h");
    });

    it("draws nothing into a pipe", () => {
        const capture = createCapture(false);
        const sequence = createSpinnerSequence(capture.stream);

        sequence.start("Building…");
        sequence.end();

        expect(capture.chunks).toEqual([]);
    });
});
