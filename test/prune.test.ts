import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatByteSize, pruneProjectCache } from "@/feature/prune";
import { getBuildCacheDirectory, pruneBuildCache } from "@/lib/util/build-cache";

let testRoot: string | undefined;
const originalCwd = process.cwd();

afterEach(async () => {
    process.chdir(originalCwd);
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function createProject(): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-prune-test-"));
    await Bun.write(join(testRoot, "neoj.toml"), "");
    return testRoot;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

describe("pruneBuildCache", () => {
    it("removes every cached build and reports its size", async () => {
        const root = await createProject();
        await mkdir(getBuildCacheDirectory(root, "key-1"), { recursive: true });
        await mkdir(getBuildCacheDirectory(root, "key-2"), { recursive: true });
        await Bun.write(getBuildCacheDirectory(root, "key-1", "a"), "hello");
        await Bun.write(getBuildCacheDirectory(root, "key-2", "a"), "world!");
        await Bun.write(join(root, ".neoj", "problem.json"), "{}");

        const result = await pruneBuildCache(root);

        expect(result).toEqual({
            directory: getBuildCacheDirectory(root),
            entryCount: 2,
            bytes: 11,
            removed: true,
        });
        await expect(pathExists(getBuildCacheDirectory(root))).resolves.toBe(false);
        await expect(pathExists(join(root, ".neoj", "problem.json"))).resolves.toBe(true);
    });

    it("measures the cache without deleting it during a dry run", async () => {
        const root = await createProject();
        await mkdir(getBuildCacheDirectory(root, "key"), { recursive: true });
        await Bun.write(getBuildCacheDirectory(root, "key", "a"), "build");

        const result = await pruneBuildCache(root, { dryRun: true });

        expect(result.entryCount).toBe(1);
        expect(result.bytes).toBe(5);
        expect(result.removed).toBe(false);
        await expect(pathExists(getBuildCacheDirectory(root, "key", "a"))).resolves.toBe(true);
    });

    it("reports an empty cache when nothing was built", async () => {
        const root = await createProject();

        await expect(pruneBuildCache(root)).resolves.toEqual({
            directory: getBuildCacheDirectory(root),
            entryCount: 0,
            bytes: 0,
            removed: false,
        });
    });

    it("rejects a build cache path that is not a directory", async () => {
        const root = await createProject();
        await mkdir(join(root, ".neoj"), { recursive: true });
        await Bun.write(getBuildCacheDirectory(root), "not a directory");

        await expect(pruneBuildCache(root)).rejects.toThrow("is not a directory");
        await expect(pathExists(getBuildCacheDirectory(root))).resolves.toBe(true);
    });
});

describe("pruneProjectCache", () => {
    it("prunes the nearest initialized project from a nested directory", async () => {
        const root = await createProject();
        const nested = join(root, "nested", "deeper");
        await mkdir(nested, { recursive: true });
        await mkdir(getBuildCacheDirectory(root, "key"), { recursive: true });
        await Bun.write(getBuildCacheDirectory(root, "key", "a"), "build");
        process.chdir(nested);

        // `process.cwd()` may use a short path on Windows and resolve symlinks
        // on macOS, so derive the expected path from it instead of `root`.
        const expectedDirectory = join(process.cwd(), "..", "..", ".neoj", "build");
        const result = await pruneProjectCache();

        expect(result.directory).toBe(expectedDirectory);
        await expect(pathExists(getBuildCacheDirectory(root))).resolves.toBe(false);
    });

    it("requires an initialized project", async () => {
        testRoot = await mkdtemp(join(tmpdir(), "neoj-prune-test-"));
        await mkdir(join(testRoot, ".git"), { recursive: true });
        process.chdir(testRoot);

        await expect(pruneProjectCache()).rejects.toThrow(
            'Project is not initialized. Run "neoj init"',
        );
    });
});

describe("formatByteSize", () => {
    it("formats bytes with binary units", () => {
        expect(formatByteSize(0)).toBe("0 B");
        expect(formatByteSize(512)).toBe("512 B");
        expect(formatByteSize(1024)).toBe("1.0 KiB");
        expect(formatByteSize(1536)).toBe("1.5 KiB");
        expect(formatByteSize(2 * 1024 * 1024)).toBe("2.0 MiB");
    });
});
