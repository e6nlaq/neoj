import { describe, expect, it } from "bun:test";

import { formatBytes } from "@/lib/util/bytes";
import { formatSourceLimit, sourceLimitBytes } from "@/lib/util/source-limit";

describe("source size limits", () => {
    it("records each platform's documented limit in bytes", () => {
        expect(sourceLimitBytes.atcoder).toBe(512 * 1024);
        expect(sourceLimitBytes.yukicoder).toBe(128 * 1024);
        expect(sourceLimitBytes.shareoj).toBe(128 * 1024);
    });

    it("labels a limit as a whole number of KiB", () => {
        expect(formatSourceLimit("atcoder")).toBe("512 KiB");
        expect(formatSourceLimit("yukicoder")).toBe("128 KiB");
        expect(formatSourceLimit("shareoj")).toBe("128 KiB");
    });

    it("formats byte sizes for messages", () => {
        expect(formatBytes(1)).toBe("1 B");
        expect(formatBytes(1024)).toBe("1.0 KiB");
        expect(formatBytes(128 * 1024)).toBe("128.0 KiB");
        expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MiB");
    });
});
