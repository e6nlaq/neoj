import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { hasErrorCode } from "@/lib/util/errors";

/** Directory under `.neoj/` that holds compiled programs, one entry per cache key. */
const buildCacheDirectoryName = "build";

/** Path of the build cache directory, or of an entry inside it. */
export function getBuildCacheDirectory(projectRoot: string, ...segments: string[]): string {
    return join(projectRoot, ".neoj", buildCacheDirectoryName, ...segments);
}

export interface PruneBuildCacheOptions {
    /** Measure the cache without deleting it. */
    dryRun?: boolean;
}

export interface PruneBuildCacheResult {
    directory: string;
    /** Number of entries directly inside the build cache directory. */
    entryCount: number;
    /** Total size of the cached files in bytes. */
    bytes: number;
    /** Whether the cache directory was deleted. */
    removed: boolean;
}

async function measurePath(path: string): Promise<number> {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
        return 0;
    }
    if (!stats.isDirectory()) {
        return stats.size;
    }

    let total = 0;
    for (const entry of await readdir(path)) {
        total += await measurePath(join(path, entry));
    }
    return total;
}

/**
 * Delete every cached build in a project.
 *
 * The cache is rebuilt on demand, so this command needs no confirmation. A
 * missing cache is not an error, and a dry run reports the same totals without
 * touching the files.
 */
export async function pruneBuildCache(
    projectRoot: string,
    options: PruneBuildCacheOptions = {},
): Promise<PruneBuildCacheResult> {
    const directory = getBuildCacheDirectory(projectRoot);

    let stats;
    try {
        stats = await lstat(directory);
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
            return { directory, entryCount: 0, bytes: 0, removed: false };
        }
        throw error;
    }

    if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Build cache "${directory}" is not a directory.`);
    }

    const entries = await readdir(directory);
    let bytes = 0;
    for (const entry of entries) {
        bytes += await measurePath(join(directory, entry));
    }

    const removed = options.dryRun !== true;
    if (removed) {
        await rm(directory, { recursive: true, force: true });
    }

    return { directory, entryCount: entries.length, bytes, removed };
}
