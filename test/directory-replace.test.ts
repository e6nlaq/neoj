import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commitStagedDirectory } from "@/lib/util/directory-replace";

let testRoot: string | undefined;

afterEach(async () => {
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function createRoot(): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-directory-replace-"));
    return testRoot;
}

describe("commitStagedDirectory", () => {
    it("moves a staged directory into place and removes the backup", async () => {
        const root = await createRoot();
        const target = join(root, "test");
        const staging = join(root, "staging");
        await mkdir(target);
        await writeFile(join(target, "old.in"), "old");
        await mkdir(staging);
        await writeFile(join(staging, "new.in"), "new");

        await commitStagedDirectory(staging, target, true);

        await expect(readdir(target)).resolves.toEqual(["new.in"]);
        await expect(readFile(join(target, "new.in"), "utf8")).resolves.toBe("new");
        await expect(readdir(root)).resolves.toEqual(["test"]);
    });

    it("restores the previous directory when the staged rename fails", async () => {
        const root = await createRoot();
        const target = join(root, "test");
        await mkdir(target);
        await writeFile(join(target, "keep.in"), "keep");

        await expect(
            commitStagedDirectory(join(root, "missing-staging"), target, true),
        ).rejects.toThrow();

        await expect(readFile(join(target, "keep.in"), "utf8")).resolves.toBe("keep");
        await expect(readdir(root)).resolves.toEqual(["test"]);
    });

    it("moves a staged directory into a path that did not exist", async () => {
        const root = await createRoot();
        const target = join(root, "test");
        const staging = join(root, "staging");
        await mkdir(staging);
        await writeFile(join(staging, "new.in"), "new");

        await commitStagedDirectory(staging, target, false);

        await expect(readdir(target)).resolves.toEqual(["new.in"]);
    });
});
