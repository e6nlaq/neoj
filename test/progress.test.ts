import { describe, expect, it } from "bun:test";

import { createProgressBar, formatEta } from "@/lib/util/progress";

function createStream(options: { isTTY?: boolean; columns?: number } = {}) {
    let text = "";
    return {
        stream: {
            write(chunk: string) {
                text += chunk;
                return true;
            },
            ...options,
        },
        text: () => text,
    };
}

describe("createProgressBar", () => {
    it("stays silent on a non-terminal stream", () => {
        const capture = createStream({ isTTY: false });
        const bar = createProgressBar({ total: 2, stream: capture.stream });

        expect(bar.enabled).toBe(false);
        bar.update(1);
        bar.advance();
        bar.finish();
        expect(capture.text()).toBe("");

        bar.line("sample-1 AC");
        expect(capture.text()).toBe("sample-1 AC\n");
    });

    it("draws and clears a single line on a terminal", () => {
        const capture = createStream({ isTTY: true, columns: 80 });
        const bar = createProgressBar({ total: 4, label: "Testing", stream: capture.stream });

        expect(bar.enabled).toBe(true);
        bar.update(2, "pass 2 fail 0");
        expect(capture.text()).toContain("Testing");
        expect(capture.text()).toContain("2/4");
        expect(capture.text()).toContain("pass 2 fail 0");
        expect(capture.text().startsWith("\r")).toBe(true);

        bar.finish();
        expect(capture.text().endsWith("\r\u001B[K")).toBe(true);
    });

    it("prints a line above the bar and redraws it", () => {
        const capture = createStream({ isTTY: true, columns: 80 });
        const bar = createProgressBar({ total: 2, stream: capture.stream });
        bar.update(1);

        const before = capture.text().length;
        bar.line("note");

        const written = capture.text().slice(before);
        expect(written.startsWith("\r\u001B[Knote\n")).toBe(true);
        expect(written).toContain("1/2");
    });

    it("can be disabled explicitly", () => {
        const capture = createStream({ isTTY: true, columns: 80 });
        const bar = createProgressBar({ total: 2, stream: capture.stream, enabled: false });

        expect(bar.enabled).toBe(false);
    });

    describe("eta", () => {
        it("formats compact durations", () => {
            expect(formatEta(0)).toBe("0s");
            expect(formatEta(41_400)).toBe("41s");
            expect(formatEta(83_000)).toBe("1m23s");
            expect(formatEta(3_720_000)).toBe("1h02m");
        });

        it("stays hidden before the first item finishes", () => {
            const capture = createStream({ isTTY: true, columns: 80 });
            const bar = createProgressBar({ total: 4, stream: capture.stream });
            bar.update(0);
            expect(capture.text()).not.toContain("eta");
        });

        it("shows the rate-based estimate after the first item", () => {
            let now = 0;
            const capture = createStream({ isTTY: true, columns: 80 });
            const bar = createProgressBar({ total: 4, stream: capture.stream, now: () => now });
            now = 10_000;
            bar.update(2);
            // 10s elapsed for 2/4 leaves an estimated 10s remaining.
            expect(capture.text()).toContain("eta 10s");
        });

        it("omits the estimate once every item is done", () => {
            let now = 0;
            const capture = createStream({ isTTY: true, columns: 80 });
            const bar = createProgressBar({ total: 4, stream: capture.stream, now: () => now });
            now = 10_000;
            bar.update(4);
            expect(capture.text()).not.toContain("eta");
        });

        it("keeps the estimate alongside the detail text", () => {
            let now = 0;
            const capture = createStream({ isTTY: true, columns: 80 });
            const bar = createProgressBar({ total: 4, stream: capture.stream, now: () => now });
            now = 20_000;
            bar.update(1, "pass 1 fail 0");
            expect(capture.text()).toContain("pass 1 fail 0 eta 1m");
        });
    });
});
