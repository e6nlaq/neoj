import type { Stats } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { hasErrorCode } from "./errors";

/** A single template file, independent of where its contents are stored. */
export interface TemplateFile {
    /** Destination path relative to the project root, using POSIX separators. */
    path: string;
    /** Absolute path to the contents, which may live in the compiled binary. */
    source: string;
}

export interface CopyTemplateResult {
    copied: string[];
    skipped: string[];
    errors: Array<{ path: string; error: Error }>;
}

export async function copyTemplateFiles(
    files: readonly TemplateFile[],
    destinationDirectory: string,
    force = false,
): Promise<CopyTemplateResult> {
    const result: CopyTemplateResult = { copied: [], skipped: [], errors: [] };

    for (const { path, source } of files) {
        const destination = join(destinationDirectory, path);

        try {
            await mkdir(dirname(destination), { recursive: true });

            let existing: Stats | undefined;
            try {
                existing = await lstat(destination);
            } catch (error) {
                if (!hasErrorCode(error, "ENOENT")) {
                    throw error;
                }
            }

            if (existing !== undefined) {
                if (!force) {
                    result.skipped.push(path);
                    continue;
                }
                if (!existing.isFile()) {
                    throw new Error("Cannot overwrite a non-file destination.");
                }
            }

            const contents = await readFile(source);
            await writeFile(destination, contents, { flag: force ? "w" : "wx" });
            result.copied.push(path);
        } catch (error) {
            if (!force && hasErrorCode(error, "EEXIST")) {
                result.skipped.push(path);
            } else {
                result.errors.push({
                    path,
                    error: error instanceof Error ? error : new Error(String(error)),
                });
            }
        }
    }

    return result;
}
