import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { Problem } from "@/lib/service/problem";
import { hasErrorCode } from "@/lib/util/errors";

export interface ProblemMetadata {
    url: string;
    contestrange?: { start: string; end: string };
}

function getMetadataDirectory(projectRoot: string): string {
    return join(resolve(projectRoot), ".neoj");
}

async function assertMetadataDirectory(directory: string): Promise<void> {
    const metadataDirectoryStat = await lstat(directory);
    if (metadataDirectoryStat.isSymbolicLink() || !metadataDirectoryStat.isDirectory()) {
        throw new Error(`Metadata directory "${directory}" is not a directory.`);
    }
}

function parseProblemMetadata(value: unknown, path: string): ProblemMetadata {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`Problem metadata "${path}" must contain a JSON object.`);
    }

    const { url, contestrange } = value as Record<string, unknown>;
    if (typeof url !== "string" || url.length === 0) {
        throw new Error(`Problem metadata "${path}" must contain a problem URL.`);
    }

    if (contestrange === undefined) {
        return { url };
    }
    if (typeof contestrange !== "object" || contestrange === null || Array.isArray(contestrange)) {
        throw new Error(`Problem metadata "${path}" has an invalid contest range.`);
    }

    const { start, end } = contestrange as Record<string, unknown>;
    if (typeof start !== "string" || typeof end !== "string") {
        throw new Error(`Problem metadata "${path}" has an invalid contest range.`);
    }

    return { url, contestrange: { start, end } };
}

export async function readProblemMetadata(
    projectRoot: string,
): Promise<ProblemMetadata | undefined> {
    const metadataDirectory = getMetadataDirectory(projectRoot);
    try {
        await assertMetadataDirectory(metadataDirectory);
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
            return undefined;
        }
        throw error;
    }

    const metadataPath = join(metadataDirectory, "problem.json");
    let metadataStat;
    try {
        metadataStat = await lstat(metadataPath);
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
            return undefined;
        }
        throw error;
    }

    if (metadataStat.isSymbolicLink() || !metadataStat.isFile()) {
        throw new Error(`Problem metadata path "${metadataPath}" is not a regular file.`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(await readFile(metadataPath, "utf8"));
    } catch (error) {
        throw new Error(`Problem metadata "${metadataPath}" is not valid JSON.`, { cause: error });
    }

    return parseProblemMetadata(parsed, metadataPath);
}

export async function saveProblemMetadata(
    projectRoot: string,
    problem: Pick<Problem, "url" | "startTime" | "endTime">,
): Promise<void> {
    const metadataDirectory = getMetadataDirectory(projectRoot);

    try {
        await mkdir(metadataDirectory);
    } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) {
            throw error;
        }
    }

    await assertMetadataDirectory(metadataDirectory);

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
    const metadata: ProblemMetadata = { url: problem.url };
    if ((problem.startTime === undefined) !== (problem.endTime === undefined)) {
        throw new Error("Problem contest range requires both a start and an end time.");
    }
    if (problem.startTime !== undefined && problem.endTime !== undefined) {
        metadata.contestrange = {
            start: problem.startTime.toString(),
            end: problem.endTime.toString(),
        };
    }

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
