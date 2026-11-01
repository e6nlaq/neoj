import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AtCoderProblem } from "@/lib/service/atcoder";
import { saveProblemMetadata } from "@/lib/util/problem-metadata";

let testRoot: string | undefined;

afterEach(async () => {
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function createProject(): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-problem-metadata-test-"));
    return testRoot;
}

function createProblem(): Pick<AtCoderProblem, "url" | "startTime" | "endTime"> {
    return {
        url: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
        startTime: Temporal.Instant.from("2026-10-30T00:00:00Z"),
        endTime: Temporal.Instant.from("2026-10-30T01:00:00Z"),
    };
}

describe("saveProblemMetadata", () => {
    it("creates the metadata directory and writes the problem URL and contest range", async () => {
        const projectRoot = await createProject();

        await saveProblemMetadata(projectRoot, createProblem());

        await expect(Bun.file(join(projectRoot, ".neoj", "problem.json")).json()).resolves.toEqual({
            url: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
            contestrange: {
                start: "2026-10-30T00:00:00Z",
                end: "2026-10-30T01:00:00Z",
            },
        });
        await expect(readdir(join(projectRoot, ".neoj"))).resolves.toEqual(["problem.json"]);
    });

    it("omits the contest window when the problem does not provide one", async () => {
        const projectRoot = await createProject();

        await saveProblemMetadata(projectRoot, {
            url: "https://yukicoder.me/problems/no/480",
        });

        await expect(Bun.file(join(projectRoot, ".neoj", "problem.json")).json()).resolves.toEqual({
            url: "https://yukicoder.me/problems/no/480",
        });
    });

    it("rejects a partial contest window", async () => {
        const projectRoot = await createProject();

        await expect(
            saveProblemMetadata(projectRoot, {
                url: "https://yukicoder.me/problems/no/480",
                startTime: Temporal.Instant.from("2026-10-30T00:00:00Z"),
            }),
        ).rejects.toThrow("Problem contest range requires both a start and an end time.");
    });

    it("overwrites problem metadata while preserving other files in .neoj", async () => {
        const projectRoot = await createProject();
        const metadataDirectory = join(projectRoot, ".neoj");
        await mkdir(metadataDirectory);
        await Bun.write(join(metadataDirectory, "other.json"), '{"keep":true}');
        await Bun.write(join(metadataDirectory, "problem.json"), '{"old":true}');

        await saveProblemMetadata(projectRoot, createProblem());

        await expect(
            Bun.file(join(metadataDirectory, "problem.json")).json(),
        ).resolves.toMatchObject({ url: createProblem().url });
        await expect(Bun.file(join(metadataDirectory, "other.json")).text()).resolves.toBe(
            '{"keep":true}',
        );
        await expect(readdir(metadataDirectory).then((entries) => entries.sort())).resolves.toEqual(
            ["other.json", "problem.json"],
        );
    });

    it("rejects a non-directory .neoj path without replacing it", async () => {
        const projectRoot = await createProject();
        const metadataPath = join(projectRoot, ".neoj");
        await Bun.write(metadataPath, "keep");

        await expect(saveProblemMetadata(projectRoot, createProblem())).rejects.toThrow(
            "is not a directory",
        );
        await expect(Bun.file(metadataPath).text()).resolves.toBe("keep");
    });

    it("rejects a non-file problem.json path without replacing it", async () => {
        const projectRoot = await createProject();
        const metadataDirectory = join(projectRoot, ".neoj");
        await mkdir(join(metadataDirectory, "problem.json"), { recursive: true });

        await expect(saveProblemMetadata(projectRoot, createProblem())).rejects.toThrow(
            "is not a regular file",
        );
    });
});
