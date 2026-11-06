import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Replace `targetDirectory` with the already prepared `stagingDirectory`.
 *
 * The existing directory is renamed aside before the staging directory moves in,
 * so a failed swap can restore the previous contents. The caller owns the
 * staging directory and still has to clean it up in its own `finally` block.
 */
export async function commitStagedDirectory(
    stagingDirectory: string,
    targetDirectory: string,
    existing: boolean,
): Promise<void> {
    if (!existing) {
        await rename(stagingDirectory, targetDirectory);
        return;
    }

    const backupDirectory = join(
        dirname(targetDirectory),
        `.${basename(targetDirectory)}-backup-${randomUUID()}`,
    );
    await rename(targetDirectory, backupDirectory);
    try {
        await rename(stagingDirectory, targetDirectory);
    } catch (error) {
        try {
            await rename(backupDirectory, targetDirectory);
        } catch (restoreError) {
            throw new AggregateError(
                [error, restoreError],
                `Failed to replace "${targetDirectory}" and could not restore the previous directory from "${backupDirectory}".`,
            );
        }
        throw error;
    }

    await rm(backupDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
