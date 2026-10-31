import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AtCoderProblem } from "@/lib/service/atcoder";
import { hasErrorCode } from "@/lib/util/errors";

export async function saveProblemMetadata(
    projectRoot: string,
    problem: Pick<AtCoderProblem, "url" | "startTime" | "endTime">,
): Promise<void> {
    const root = resolve(projectRoot);
    const metadataDirectory = join(root, ".neoj");

    try {
        await mkdir(metadataDirectory);
    } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) {
            throw error;
        }
    }

    const metadataDirectoryStat = await lstat(metadataDirectory);
    if (metadataDirectoryStat.isSymbolicLink() || !metadataDirectoryStat.isDirectory()) {
        throw new Error(`Metadata directory "${metadataDirectory}" is not a directory.`);
    }

    const metadataPath = join(metadataDirectory, "problem.json");
    try {
        const metadataStat = await lstat(metadataPath);
        if (metadataStat.isSymbolicLink() || !metadataStat.isFile()) {
            throw new Error(`Problem metadata path "${metadataPath}" is not a regular file.`);
        }
    } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) {
            throw error;
        }
    }

    const temporaryPath = join(metadataDirectory, `.problem-${randomUUID()}.tmp`);
    const metadata = {
        url: problem.url,
        contestrange: {
            start: problem.startTime.toString(),
            end: problem.endTime.toString(),
        },
    };

    let temporaryFileCreated = false;
    try {
        const temporaryFile = await open(temporaryPath, "wx");
        temporaryFileCreated = true;
        try {
            await temporaryFile.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
        } finally {
            await temporaryFile.close();
        }
        await rename(temporaryPath, metadataPath);
    } finally {
        if (temporaryFileCreated) {
            await rm(temporaryPath, { force: true });
        }
    }
}
