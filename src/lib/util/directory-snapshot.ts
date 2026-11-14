import { cp, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { hasErrorCode } from "@/lib/util/errors";

/** A directory, or a path that will become one, captured before a mutation. */
export interface SnapshotTarget {
    path: string;
    /** Human-readable name used in error messages. */
    name: string;
}

export interface DirectorySnapshot {
    /** Put every target back exactly as it was before the snapshot. */
    restore(): Promise<void>;
    /** Remove the backup copies after a successful operation. */
    dispose(): Promise<void>;
}

interface SnapshotEntry {
    path: string;
    name: string;
    backupPath: string;
    existed: boolean;
}

const copyOptions = {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
    preserveTimestamps: true,
} as const;

async function copyPath(source: string, destination: string): Promise<void> {
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, copyOptions);
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
            return false;
        }
        throw error;
    }
}

/**
 * Copy several paths to a temporary directory before a destructive operation.
 *
 * Most download and stash steps are individually atomic, but a failure after
 * the first step can still leave a project with new samples and old metadata,
 * or with only one of two restored slots. This snapshot lets the caller put
 * every touched path back before reporting the error.
 */
export async function snapshotDirectories(
    targets: readonly SnapshotTarget[],
): Promise<DirectorySnapshot> {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "neoj-snapshot-"));
    const entries: SnapshotEntry[] = [];
    const seen = new Set<string>();

    try {
        for (const target of targets) {
            if (seen.has(target.path)) {
                continue;
            }
            seen.add(target.path);

            const backupPath = join(temporaryRoot, String(entries.length));
            const existed = await pathExists(target.path);
            if (existed) {
                await copyPath(target.path, backupPath);
            }
            entries.push({ path: target.path, name: target.name, backupPath, existed });
        }
    } catch (error) {
        await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3 }).catch(
            () => undefined,
        );
        throw error;
    }

    return {
        async restore() {
            const errors: unknown[] = [];
            for (const entry of entries) {
                try {
                    await rm(entry.path, {
                        recursive: true,
                        force: true,
                        maxRetries: 3,
                        retryDelay: 50,
                    });
                    if (entry.existed) {
                        await copyPath(entry.backupPath, entry.path);
                    }
                } catch (error) {
                    errors.push(
                        new Error(`Failed to restore ${entry.name} at "${entry.path}".`, {
                            cause: error,
                        }),
                    );
                }
            }

            if (errors.length > 0) {
                throw new AggregateError(errors, "Failed to restore one or more directories.");
            }
        },

        async dispose() {
            await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3 }).catch(
                () => undefined,
            );
        },
    };
}
