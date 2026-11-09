import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { Problem } from "@/lib/service/problem";
import { hasErrorCode } from "@/lib/util/errors";
import type { ProblemKey } from "@/lib/util/stash";

export interface ProblemMetadata {
    url: string;
    /**
     * The problem key recorded at download time, for platforms whose URL does
     * not map to a key synchronously (ShareOJ contest problem URLs). Omitted
     * when the key can be derived from `url` offline.
     */
    key?: ProblemKey;
    contestrange?: { start: string; end: string };
}

function getMetadataDirectory(projectRoot: string): string {
    return join(resolve(projectRoot), ".neoj");
}

/** The same shape the stash layout accepts for a platform and slug segment. */
const KEY_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

async function assertMetadataDirectory(directory: string): Promise<void> {
    const metadataDirectoryStat = await lstat(directory);
    if (metadataDirectoryStat.isSymbolicLink() || !metadataDirectoryStat.isDirectory()) {
        throw new Error(`Metadata directory "${directory}" is not a directory.`);
    }
}

export function parseProblemMetadata(value: unknown, path: string): ProblemMetadata {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`Problem metadata "${path}" must contain a JSON object.`);
    }

    const { url, key, contestrange } = value as Record<string, unknown>;
    if (typeof url !== "string" || url.length === 0) {
        throw new Error(`Problem metadata "${path}" must contain a problem URL.`);
    }

    let problemKey: ProblemKey | undefined;
    if (key !== undefined) {
        if (typeof key !== "object" || key === null) {
            throw new Error(`Problem metadata "${path}" has an invalid key.`);
        }
        const { platform, slug } = key as Record<string, unknown>;
        // The key becomes a stash path, so reject what the stash layout rejects.
        if (
            typeof platform !== "string" ||
            typeof slug !== "string" ||
            !KEY_SEGMENT_PATTERN.test(platform) ||
            !KEY_SEGMENT_PATTERN.test(slug)
        ) {
            throw new Error(`Problem metadata "${path}" has an invalid key.`);
        }
        problemKey = { platform, slug };
    }

    if (problemKey === undefined && contestrange === undefined) {
        return { url };
    }
    if (contestrange === undefined) {
        return { url, key: problemKey };
    }
    if (typeof contestrange !== "object" || contestrange === null || Array.isArray(contestrange)) {
        throw new Error(`Problem metadata "${path}" has an invalid contest range.`);
    }

    const { start, end } = contestrange as Record<string, unknown>;
    if (typeof start !== "string" || typeof end !== "string") {
        throw new Error(`Problem metadata "${path}" has an invalid contest range.`);
    }

    return problemKey === undefined
        ? { url, contestrange: { start, end } }
        : { url, key: problemKey, contestrange: { start, end } };
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
    problem: Pick<Problem, "url" | "key" | "startTime" | "endTime">,
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
    if (problem.key !== undefined) {
        metadata.key = problem.key;
    }
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
