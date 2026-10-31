import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { hasErrorCode } from "./errors";

export interface CopyTemplateResult {
    copied: string[];
    skipped: string[];
    errors: Array<{ path: string; error: Error }>;
}

async function listTemplateFiles(
    templateDirectory: string,
    directory = templateDirectory,
): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const entryPath = join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listTemplateFiles(templateDirectory, entryPath)));
        } else if (entry.isFile()) {
            files.push(relative(templateDirectory, entryPath));
        } else {
            throw new Error(
                `Unsupported template entry "${relative(templateDirectory, entryPath)}".`,
            );
        }
    }

    return files.sort();
}

export async function copyTemplateFiles(
    templateDirectory: string,
    destinationDirectory: string,
    force = false,
): Promise<CopyTemplateResult> {
    const result: CopyTemplateResult = { copied: [], skipped: [], errors: [] };
    const files = await listTemplateFiles(templateDirectory);

    for (const path of files) {
        const source = join(templateDirectory, path);
        const destination = join(destinationDirectory, path);

        try {
            await mkdir(dirname(destination), { recursive: true });

            let existing;
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

            await copyFile(source, destination, force ? 0 : constants.COPYFILE_EXCL);
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
