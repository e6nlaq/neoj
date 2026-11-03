import { describe, expect, it } from "bun:test";

import { createProgressBar } from "@/lib/util/progress";

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
});
