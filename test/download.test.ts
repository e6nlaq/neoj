import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { AtCoderProblem } from "@/lib/service/atcoder";
import { downloadAtCoderSamples } from "@/lib/util/testcase";

let testRoot: string | undefined;

afterEach(async () => {
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

describe("downloadAtCoderSamples", () => {
    it("replaces the test folder with numbered samples without changing contents", async () => {
        const projectRoot = await createProject();
        const target = join(projectRoot, config.folder);
        await mkdir(join(target, "old"), { recursive: true });
        await Bun.write(join(target, "old", "stale.txt"), "stale");
        const problem = createProblem([
            { input: "1 2\n", output: "3\n" },
            { input: "4 5", output: "9" },
        ]);
        const client = { getProblem: async () => problem };

        await expect(
            downloadAtCoderSamples(problem.url, projectRoot, config, client),
        ).resolves.toEqual({ directory: target, count: 2 });

        expect((await readdir(target)).sort()).toEqual([
            "sample-1.in",
            "sample-1.out",
            "sample-2.in",
            "sample-2.out",
        ]);
        expect(await Bun.file(join(target, "sample-1.in")).text()).toBe("1 2\n");
        expect(await Bun.file(join(target, "sample-2.out")).text()).toBe("9");
    });

    it("clears the folder and succeeds when the problem has no samples", async () => {
        const projectRoot = await createProject();
        const target = join(projectRoot, config.folder);
        await mkdir(target, { recursive: true });
        await Bun.write(join(target, "old.in"), "old");
        const problem = createProblem([]);

        await expect(
            downloadAtCoderSamples(problem.url, projectRoot, config, {
                getProblem: async () => problem,
            }),
        ).resolves.toEqual({ directory: target, count: 0 });
        await expect(readdir(target)).resolves.toEqual([]);
    });

    it("preserves existing tests when fetching the problem fails", async () => {
        const projectRoot = await createProject();
        const target = join(projectRoot, config.folder);
        await mkdir(target, { recursive: true });
        await Bun.write(join(target, "existing.in"), "keep");

        await expect(
            downloadAtCoderSamples("https://atcoder.jp/invalid", projectRoot, config, {
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
                downloadAtCoderSamples(
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
            downloadAtCoderSamples("https://atcoder.jp/invalid", projectRoot, config, {
                getProblem: async () => createProblem([]),
            }),
        ).rejects.toThrow("exists but is not a directory");
        expect(await Bun.file(target).text()).toBe("keep");
    });
});
