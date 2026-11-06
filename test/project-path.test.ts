import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
    assertDirectoriesDoNotOverlap,
    isWithin,
    resolveProjectDirectory,
} from "@/lib/util/project-path";

let testRoot: string | undefined;

afterEach(async () => {
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function createRoot(): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-project-path-"));
    return testRoot;
}

describe("resolveProjectDirectory", () => {
    it("resolves a relative directory inside the project", async () => {
        const root = await createRoot();
        const expected = join(await realpath(root), "cases", "nested");

        await expect(
            resolveProjectDirectory(root, "cases/nested", "testcase.folder"),
        ).resolves.toBe(expected);
    });

    it("rejects empty, absolute, outside, and project-root paths", async () => {
        const root = await createRoot();

        for (const folder of ["", resolve(root, "cases"), "../outside", "."]) {
            await expect(
                resolveProjectDirectory(root, folder, "testcase.folder"),
            ).rejects.toThrow();
        }
    });

    it("rejects reserved metadata segments at any depth", async () => {
        const root = await createRoot();

        for (const folder of [".git", ".git/config", ".neoj", "nested/.neoj/cases"]) {
            await expect(resolveProjectDirectory(root, folder, "testcase.folder")).rejects.toThrow(
                "cannot target",
            );
        }
    });

    it("rejects a regular file in place of the directory", async () => {
        const root = await createRoot();
        await writeFile(join(root, "cases"), "keep");
        await mkdir(join(root, "parent"));
        await writeFile(join(root, "parent", "file"), "keep");

        await expect(resolveProjectDirectory(root, "cases", "testcase.folder")).rejects.toThrow(
            "exists but is not a directory",
        );
        await expect(
            resolveProjectDirectory(root, "parent/file/nested", "testcase.folder"),
        ).rejects.toThrow("is not a directory");
    });
});

describe("assertDirectoriesDoNotOverlap", () => {
    it("accepts sibling directories", () => {
        expect(() =>
            assertDirectoriesDoNotOverlap(
                { path: "/project/src", name: "src" },
                { path: "/project/test", name: "testcase.folder" },
            ),
        ).not.toThrow();
    });

    it("rejects identical and nested directories", () => {
        for (const right of ["/project/src", "/project/src/test", "/project"]) {
            expect(() =>
                assertDirectoriesDoNotOverlap(
                    { path: "/project/src", name: "src" },
                    { path: right, name: "testcase.folder" },
                ),
            ).toThrow("must not overlap");
        }
    });
});

describe("isWithin", () => {
    it("accepts the directory itself and its children", () => {
        expect(isWithin("/project", "/project")).toBe(true);
        expect(isWithin("/project", "/project/src")).toBe(true);
    });

    it("rejects parents and siblings", () => {
        expect(isWithin("/project/src", "/project")).toBe(false);
        expect(isWithin("/project/src", "/project/test")).toBe(false);
    });
});
