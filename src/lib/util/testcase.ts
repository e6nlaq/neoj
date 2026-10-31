import { lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { AtCoderClient, type AtCoderProblem } from "@/lib/service/atcoder";
import type { Config } from "@/lib/util/config";
import { hasErrorCode } from "@/lib/util/errors";

export interface DownloadedSamples {
    directory: string;
    count: number;
}

async function validateTargetDirectory(projectRoot: string, folder: string): Promise<string> {
    if (!folder || isAbsolute(folder)) {
        throw new Error("testcase.folder must be a non-empty relative path.");
    }

    const root = await realpath(projectRoot);
    const target = resolve(root, folder);
    const targetRelative = relative(root, target);
    if (
        targetRelative === "" ||
        targetRelative === ".." ||
        targetRelative.startsWith(`..${sep}`) ||
        isAbsolute(targetRelative)
    ) {
        throw new Error("testcase.folder must resolve to a directory inside the project.");
    }

    const segments = targetRelative.split(sep);
    if (segments.some((segment) => segment.toLowerCase() === ".git")) {
        throw new Error("testcase.folder cannot target the Git metadata directory.");
    }

    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
        current = join(current, segments[index] ?? "");
        let entry;
        try {
            entry = await lstat(current);
        } catch (error) {
            if (hasErrorCode(error, "ENOENT")) {
                break;
            }
            throw error;
        }

        if (entry.isSymbolicLink()) {
            throw new Error("testcase.folder cannot pass through a symbolic link.");
        }
        if (index < segments.length - 1 && !entry.isDirectory()) {
            throw new Error(`Parent path "${current}" is not a directory.`);
        }
        if (index === segments.length - 1 && !entry.isDirectory()) {
            throw new Error(`testcase.folder "${current}" exists but is not a directory.`);
        }
    }

    return target;
}

function getSampleFiles(problem: AtCoderProblem, filenamePattern: string) {
    return problem.samples.flatMap((sample, index) => {
        const baseName = filenamePattern.replace("{}", String(index + 1));
        return [
            { name: `${baseName}.in`, contents: sample.input },
            { name: `${baseName}.out`, contents: sample.output },
        ];
    });
}

async function replaceDirectory(
    targetDirectory: string,
    files: ReturnType<typeof getSampleFiles>,
): Promise<void> {
    const parentDirectory = dirname(targetDirectory);
    await mkdir(parentDirectory, { recursive: true });

    const stagingDirectory = await mkdtemp(
        join(parentDirectory, `.${basename(targetDirectory)}-download-`),
    );
    try {
        for (const file of files) {
            await writeFile(join(stagingDirectory, file.name), file.contents, {
                encoding: "utf8",
                flag: "wx",
            });
        }

        let existing;
        try {
            existing = await lstat(targetDirectory);
        } catch (error) {
            if (!hasErrorCode(error, "ENOENT")) {
                throw error;
            }
        }

        if (existing !== undefined) {
            if (existing.isSymbolicLink() || !existing.isDirectory()) {
                throw new Error(`testcase.folder "${targetDirectory}" is not a directory.`);
            }
            await rm(targetDirectory, { recursive: true });
        }

        await rename(stagingDirectory, targetDirectory);
    } finally {
        await rm(stagingDirectory, { recursive: true, force: true });
    }
}

export async function downloadAtCoderSamples(
    url: string,
    projectRoot: string,
    testcaseConfig: Config["testcase"],
    client: Pick<AtCoderClient, "getProblem"> = new AtCoderClient(),
): Promise<DownloadedSamples> {
    const targetDirectory = await validateTargetDirectory(projectRoot, testcaseConfig.folder);
    const problem = await client.getProblem(url);
    await validateTargetDirectory(projectRoot, testcaseConfig.folder);
    const files = getSampleFiles(problem, testcaseConfig.filename);

    await replaceDirectory(targetDirectory, files);
    return { directory: targetDirectory, count: problem.samples.length };
}
