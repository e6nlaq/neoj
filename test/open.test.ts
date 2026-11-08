import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openProblem, resolveOpenUrl } from "@/feature/open";

const atCoderProblemUrl = "https://atcoder.jp/contests/abc300/tasks/abc300_a";
const yukicoderProblemUrl = "https://yukicoder.me/problems/no/1";
const aojProblemUrl = "https://onlinejudge.u-aizu.ac.jp/courses/lesson/1/ALDS1/1/ALDS1_1_A";
const codeforcesProblemUrl = "https://codeforces.com/problemset/problem/1900/B";

let testRoot: string | undefined;
const originalCwd = process.cwd();

afterEach(async () => {
    process.chdir(originalCwd);
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function createProject(problemUrl?: string): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-open-test-"));
    await Bun.write(join(testRoot, "neoj.toml"), "");
    if (problemUrl !== undefined) {
        await mkdir(join(testRoot, ".neoj"));
        await Bun.write(
            join(testRoot, ".neoj", "problem.json"),
            `${JSON.stringify({ url: problemUrl })}\n`,
        );
    }
    process.chdir(testRoot);
    return testRoot;
}

function captureOpenedUrls(): {
    opened: string[];
    openUrl: (url: string) => Promise<boolean>;
} {
    const opened: string[] = [];
    return {
        opened,
        openUrl: async (url) => {
            opened.push(url);
            return true;
        },
    };
}

async function withMockFetch<T>(body: unknown, run: () => Promise<T>, status = 200): Promise<T> {
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: async () =>
            new Response(typeof body === "string" ? body : JSON.stringify(body), {
                status,
                headers: { "Content-Type": "application/json" },
            }),
    });
    try {
        return await run();
    } finally {
        Object.defineProperty(globalThis, "fetch", {
            configurable: true,
            writable: true,
            value: originalFetch,
        });
    }
}

describe("resolveOpenUrl", () => {
    it("returns the recorded URL for the problem page", async () => {
        await expect(resolveOpenUrl("problem", atCoderProblemUrl)).resolves.toBe(atCoderProblemUrl);
        await expect(resolveOpenUrl("problem", yukicoderProblemUrl)).resolves.toBe(
            yukicoderProblemUrl,
        );
    });

    it("derives the AtCoder contest and submission URLs from the problem URL", async () => {
        await expect(resolveOpenUrl("contest", atCoderProblemUrl)).resolves.toBe(
            "https://atcoder.jp/contests/abc300",
        );
        await expect(resolveOpenUrl("submissions", atCoderProblemUrl)).resolves.toBe(
            "https://atcoder.jp/contests/abc300/submissions/me?f.Task=abc300_a",
        );
    });

    it("derives the yukicoder submission URL from the problem URL", async () => {
        await expect(resolveOpenUrl("submissions", yukicoderProblemUrl)).resolves.toBe(
            "https://yukicoder.me/problems/no/1/submissions?my_submission=enabled",
        );
        await expect(
            resolveOpenUrl("submissions", "https://yukicoder.me/problems/1"),
        ).resolves.toBe("https://yukicoder.me/problems/1/submissions?my_submission=enabled");
    });

    it("resolves the yukicoder contest through the API", async () => {
        await withMockFetch({ No: 1, ContestId: 253 }, async () => {
            await expect(resolveOpenUrl("contest", yukicoderProblemUrl)).resolves.toBe(
                "https://yukicoder.me/contests/253",
            );
        });
    });

    it("rejects a yukicoder problem that is not part of a contest", async () => {
        await withMockFetch({ No: 1, ContestId: null }, async () => {
            await expect(resolveOpenUrl("contest", yukicoderProblemUrl)).rejects.toThrow(
                "This yukicoder problem does not belong to a contest.",
            );
        });
    });

    it("reports a failed yukicoder problem request", async () => {
        await withMockFetch(
            "",
            async () => {
                await expect(resolveOpenUrl("contest", yukicoderProblemUrl)).rejects.toThrow(
                    "yukicoder problem request failed (500).",
                );
            },
            500,
        );
    });

    it("rejects URLs from unsupported platforms", async () => {
        await expect(resolveOpenUrl("problem", "https://example.com/problem")).rejects.toThrow(
            "Expected a problem URL from a supported platform",
        );
        await expect(resolveOpenUrl("contest", "file:///tmp/problem")).rejects.toThrow(
            "Expected a problem URL from a supported platform",
        );
    });

    it("opens AOJ problem URLs but rejects contest and submissions targets", async () => {
        await expect(resolveOpenUrl("problem", aojProblemUrl)).resolves.toBe(aojProblemUrl);
        await expect(resolveOpenUrl("contest", aojProblemUrl)).rejects.toThrow(
            'AOJ does not support "neoj open --contest" or "neoj open --submissions" yet.',
        );
        await expect(resolveOpenUrl("submissions", aojProblemUrl)).rejects.toThrow(
            'AOJ does not support "neoj open --contest" or "neoj open --submissions" yet.',
        );
    });

    it("opens the Codeforces contest page but rejects submissions", async () => {
        await expect(resolveOpenUrl("contest", codeforcesProblemUrl)).resolves.toBe(
            "https://codeforces.com/contest/1900",
        );
        await expect(resolveOpenUrl("submissions", codeforcesProblemUrl)).rejects.toThrow(
            'Codeforces does not support "neoj open --submissions" yet.',
        );
    });
});

describe("openProblem", () => {
    it("opens the URL recorded by the last download", async () => {
        await createProject(atCoderProblemUrl);
        const { opened, openUrl } = captureOpenedUrls();

        await expect(openProblem("problem", "browser", { openUrl })).resolves.toEqual({
            target: "problem",
            output: "browser",
            url: atCoderProblemUrl,
            completed: true,
        });
        expect(opened).toEqual([atCoderProblemUrl]);
    });

    it("opens the contest page with the contest target", async () => {
        await createProject(atCoderProblemUrl);
        const { opened, openUrl } = captureOpenedUrls();

        await openProblem("contest", "browser", { openUrl });

        expect(opened).toEqual(["https://atcoder.jp/contests/abc300"]);
    });

    it("reports when the browser could not be started", async () => {
        await createProject(atCoderProblemUrl);

        await expect(
            openProblem("problem", "browser", { openUrl: async () => false }),
        ).resolves.toMatchObject({ completed: false });
    });

    it("copies the URL when the clipboard output is selected", async () => {
        await createProject(atCoderProblemUrl);
        const copied: string[] = [];
        const { opened, openUrl } = captureOpenedUrls();

        await expect(
            openProblem("submissions", "clipboard", {
                openUrl,
                copyUrl: async (url) => {
                    copied.push(url);
                    return true;
                },
            }),
        ).resolves.toEqual({
            target: "submissions",
            output: "clipboard",
            url: "https://atcoder.jp/contests/abc300/submissions/me?f.Task=abc300_a",
            completed: true,
        });
        expect(copied).toEqual([
            "https://atcoder.jp/contests/abc300/submissions/me?f.Task=abc300_a",
        ]);
        expect(opened).toEqual([]);
    });

    it("reports when the clipboard is unavailable", async () => {
        await createProject(atCoderProblemUrl);

        await expect(
            openProblem("problem", "clipboard", { copyUrl: async () => false }),
        ).resolves.toMatchObject({ completed: false });
    });

    it("neither opens nor copies when the URL output is selected", async () => {
        await createProject(atCoderProblemUrl);
        const { opened, openUrl } = captureOpenedUrls();

        await expect(
            openProblem("problem", "url", {
                openUrl,
                copyUrl: async () => {
                    throw new Error("the clipboard must not be used");
                },
            }),
        ).resolves.toEqual({
            target: "problem",
            output: "url",
            url: atCoderProblemUrl,
            completed: true,
        });
        expect(opened).toEqual([]);
    });

    it("requires a recorded problem", async () => {
        await createProject();
        const { opened, openUrl } = captureOpenedUrls();

        await expect(openProblem("problem", "browser", { openUrl })).rejects.toThrow(
            'No problem is recorded. Run "neoj download <url>" first.',
        );
        expect(opened).toEqual([]);
    });

    it("rejects a recorded URL from an unsupported platform", async () => {
        await createProject("https://example.com/problem");

        await expect(openProblem("problem")).rejects.toThrow(
            "Expected a problem URL from a supported platform",
        );
    });
});
