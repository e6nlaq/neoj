import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { downloadProblem, formatSamples, getProblemWithLoginHint } from "@/feature/download";
import type { AtCoderProblem } from "@/lib/service/atcoder";
import { AtCoderProblemRequestError } from "@/lib/service/atcoder";
import { downloadSamples } from "@/lib/util/testcase";

let testRoot: string | undefined;
const originalCwd = process.cwd();
const originalUserProfile = process.env.USERPROFILE;
const originalHome = process.env.HOME;
const originalLocalAppData = process.env.LOCALAPPDATA;

afterEach(async () => {
    process.chdir(originalCwd);
    for (const [key, value] of [
        ["USERPROFILE", originalUserProfile],
        ["HOME", originalHome],
        ["LOCALAPPDATA", originalLocalAppData],
    ] as const) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function createProject(): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-download-test-"));
    return testRoot;
}

function createProblem(samples: AtCoderProblem["samples"]): AtCoderProblem {
    return {
        url: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
        title: "A - Example",
        samples,
        startTime: Temporal.Instant.from("2026-10-30T00:00:00Z"),
        endTime: Temporal.Instant.from("2026-10-30T01:00:00Z"),
    };
}

const config = { folder: "testcases", filename: "sample-{}" };

describe("formatSamples", () => {
    it("formats sample input and output with numbered headings and a trailing newline", () => {
        expect(
            formatSamples(
                [
                    { input: "1 2\n", output: "3\n" },
                    { input: "4 5", output: "9" },
                ],
                "test",
                "sample-{}",
            ),
        ).toEqual([
            "Sample 1\nInput [test/sample-1.in]:\n1 2\n\nOutput [test/sample-1.out]:\n3\n\n",
            "Sample 2\nInput [test/sample-2.in]:\n4 5\nOutput [test/sample-2.out]:\n9\n",
        ]);
    });

    it("uses configured nested paths and normalizes separators for display", () => {
        expect(formatSamples([{ input: "x", output: "y" }], "cases\\atcoder", "case-{}")).toEqual([
            "Sample 1\nInput [cases/atcoder/case-1.in]:\nx\nOutput [cases/atcoder/case-1.out]:\ny\n",
        ]);
    });
});

describe("getProblemWithLoginHint", () => {
    it("hints to log in only on a 404 while logged out", async () => {
        const notFound = {
            getProblem: async () => Promise.reject(new AtCoderProblemRequestError(404)),
        };

        await expect(getProblemWithLoginHint("url", notFound, false)).rejects.toMatchObject({
            message:
                'AtCoder problem request failed (404). If the problem requires an account, try "neoj login atcoder".',
        });
        await expect(getProblemWithLoginHint("url", notFound, true)).rejects.toMatchObject({
            message: "AtCoder problem request failed (404).",
        });
    });

    it("does not add the login hint to other errors", async () => {
        const forbidden = {
            getProblem: async () => Promise.reject(new AtCoderProblemRequestError(403)),
        };

        await expect(getProblemWithLoginHint("url", forbidden, false)).rejects.toMatchObject({
            message: "AtCoder problem request failed (403).",
        });
    });
});

describe("downloadSamples", () => {
    it("replaces the test folder with numbered samples ending in a newline", async () => {
        const projectRoot = await createProject();
        const target = join(projectRoot, config.folder);
        await mkdir(join(target, "old"), { recursive: true });
        await Bun.write(join(target, "old", "stale.txt"), "stale");
        const problem = createProblem([
            { input: "1 2\n", output: "3\n" },
            { input: "4 5", output: "9" },
        ]);
        const client = { getProblem: async () => problem };

        await expect(downloadSamples(problem.url, projectRoot, config, client)).resolves.toEqual({
            directory: target,
            count: 2,
            samples: problem.samples,
            problem,
        });

        expect((await readdir(target)).sort()).toEqual([
            "sample-1.in",
            "sample-1.out",
            "sample-2.in",
            "sample-2.out",
        ]);
        expect(await Bun.file(join(target, "sample-1.in")).text()).toBe("1 2\n\n");
        expect(await Bun.file(join(target, "sample-1.out")).text()).toBe("3\n\n");
        expect(await Bun.file(join(target, "sample-2.in")).text()).toBe("4 5\n");
        expect(await Bun.file(join(target, "sample-2.out")).text()).toBe("9\n");
    });

    it("clears the folder and succeeds when the problem has no samples", async () => {
        const projectRoot = await createProject();
        const target = join(projectRoot, config.folder);
        await mkdir(target, { recursive: true });
        await Bun.write(join(target, "old.in"), "old");
        const problem = createProblem([]);

        await expect(
            downloadSamples(problem.url, projectRoot, config, {
                getProblem: async () => problem,
            }),
        ).resolves.toEqual({ directory: target, count: 0, samples: [], problem });
        await expect(readdir(target)).resolves.toEqual([]);
    });

    it("preserves existing tests when fetching the problem fails", async () => {
        const projectRoot = await createProject();
        const target = join(projectRoot, config.folder);
        await mkdir(target, { recursive: true });
        await Bun.write(join(target, "existing.in"), "keep");

        await expect(
            downloadSamples("https://atcoder.jp/invalid", projectRoot, config, {
                getProblem: async () => {
                    throw new Error("network unavailable");
                },
            }),
        ).rejects.toThrow("network unavailable");
        expect(await Bun.file(join(target, "existing.in")).text()).toBe("keep");
    });

    it("rejects unsafe destinations before fetching or deleting files", async () => {
        const projectRoot = await createProject();
        const existing = join(projectRoot, "keep.in");
        await Bun.write(existing, "keep");
        let fetched = false;

        for (const folder of [
            "",
            ".",
            "..",
            "../outside",
            ".git",
            ".git/config",
            resolve(projectRoot, "outside"),
        ]) {
            await expect(
                downloadSamples(
                    "https://atcoder.jp/invalid",
                    projectRoot,
                    { ...config, folder },
                    {
                        getProblem: async () => {
                            fetched = true;
                            return createProblem([]);
                        },
                    },
                ),
            ).rejects.toThrow();
        }

        expect(fetched).toBe(false);
        expect(await Bun.file(existing).text()).toBe("keep");
    });

    it("does not delete a regular file at the configured directory path", async () => {
        const projectRoot = await createProject();
        const target = join(projectRoot, config.folder);
        await Bun.write(target, "keep");

        await expect(
            downloadSamples("https://atcoder.jp/invalid", projectRoot, config, {
                getProblem: async () => createProblem([]),
            }),
        ).rejects.toThrow("exists but is not a directory");
        expect(await Bun.file(target).text()).toBe("keep");
    });
});

describe("downloadProblem", () => {
    it("records problem metadata after a successful download with no samples", async () => {
        const projectRoot = await createProject();
        const homeDirectory = join(projectRoot, "home");
        await mkdir(homeDirectory);
        await Bun.write(join(projectRoot, "neoj.toml"), "");
        process.env.USERPROFILE = homeDirectory;
        process.env.HOME = homeDirectory;
        process.env.LOCALAPPDATA = join(projectRoot, "local-app-data");
        process.chdir(projectRoot);

        const originalFetch = globalThis.fetch;
        Object.defineProperty(globalThis, "fetch", {
            configurable: true,
            writable: true,
            value: async () =>
                new Response(
                    `<html>
                    <title>A - Example</title>
                    <div id="task-statement"></div>
                    <div class="contest-duration">
                        <time>2026-10-30 00:00:00+0000</time>
                        <time>2026-10-30 01:00:00+0000</time>
                    </div>
                </html>`,
                    { status: 200 },
                ),
        });
        try {
            await downloadProblem("https://atcoder.jp/contests/abc300/tasks/abc300_a");
        } finally {
            Object.defineProperty(globalThis, "fetch", {
                configurable: true,
                writable: true,
                value: originalFetch,
            });
        }

        await expect(Bun.file(join(projectRoot, ".neoj", "problem.json")).json()).resolves.toEqual({
            url: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
            contestrange: {
                start: "2026-10-30T00:00:00Z",
                end: "2026-10-30T01:00:00Z",
            },
        });
    });

    it("downloads yukicoder samples without storing a contest window", async () => {
        const projectRoot = await createProject();
        const homeDirectory = join(projectRoot, "home");
        await mkdir(homeDirectory);
        await Bun.write(join(projectRoot, "neoj.toml"), "");
        process.env.USERPROFILE = homeDirectory;
        process.env.HOME = homeDirectory;
        process.env.LOCALAPPDATA = join(projectRoot, "local-app-data");
        process.chdir(projectRoot);

        const originalFetch = globalThis.fetch;
        Object.defineProperty(globalThis, "fetch", {
            configurable: true,
            writable: true,
            value: async () =>
                new Response(
                    `<html>
                    <head><title> No.480 合計 - yukicoder</title></head>
                    <body>
                        <div id="content" data-problem-id="1480">
                            <div class="sample">
                                <div class="paragraph">
                                    <h6>入力</h6><pre>3</pre>
                                    <h6>出力</h6><pre>6</pre>
                                </div>
                            </div>
                            <div class="sample">
                                <div class="paragraph">
                                    <h6>入力</h6><pre>1</pre>
                                    <h6>出力</h6><pre>1</pre>
                                </div>
                            </div>
                        </div>
                        <event-timer start-time="2017-02-10T22:20:00+09:00" end-time="2017-02-11T00:20:00+09:00"></event-timer>
                    </body>
                </html>`,
                    { status: 200 },
                ),
        });
        try {
            await downloadProblem("https://yukicoder.me/problems/no/480");
        } finally {
            Object.defineProperty(globalThis, "fetch", {
                configurable: true,
                writable: true,
                value: originalFetch,
            });
        }

        await expect(
            readdir(join(projectRoot, "test")).then((entries) => entries.sort()),
        ).resolves.toEqual(["sample-1.in", "sample-1.out", "sample-2.in", "sample-2.out"]);
        await expect(Bun.file(join(projectRoot, "test", "sample-1.in")).text()).resolves.toBe(
            "3\n",
        );
        await expect(Bun.file(join(projectRoot, "test", "sample-2.out")).text()).resolves.toBe(
            "1\n",
        );
        await expect(Bun.file(join(projectRoot, ".neoj", "problem.json")).json()).resolves.toEqual({
            url: "https://yukicoder.me/problems/no/480",
        });
    });

    it("rejects unsupported problem URLs", async () => {
        await expect(downloadProblem("https://example.com/problems/no/480")).rejects.toThrow(
            "Expected a problem URL from a supported platform (AtCoder, yukicoder).",
        );
    });
});
