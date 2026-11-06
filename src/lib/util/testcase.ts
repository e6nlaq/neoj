import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { Problem, ProblemClient, ProblemSample } from "@/lib/service/problem";
import type { Config } from "@/lib/util/config";
import { commitStagedDirectory } from "@/lib/util/directory-replace";
import { hasErrorCode } from "@/lib/util/errors";
import { assertDirectoriesDoNotOverlap, resolveProjectDirectory } from "@/lib/util/project-path";

export interface DownloadedSamples {
    directory: string;
    count: number;
    samples: ProblemSample[];
    problem: Problem;
}

export interface FetchedSamples {
    directory: string;
    problem: Problem;
}

/**
 * Resolve `testcase.folder` to an absolute directory inside the project.
 *
 * When `sourceFolder` is configured, the test-case directory must not overlap
 * it, so a download cannot replace the solution sources.
 */
export async function resolveTestcaseDirectory(
    projectRoot: string,
    folder: string,
    sourceFolder?: string,
): Promise<string> {
    const target = await resolveProjectDirectory(projectRoot, folder, "testcase.folder");
    if (sourceFolder !== undefined) {
        const source = await resolveProjectDirectory(projectRoot, sourceFolder, "src");
        assertDirectoriesDoNotOverlap(
            { path: target, name: "testcase.folder" },
            { path: source, name: "src" },
        );
    }

    return target;
}

function getSampleFiles(problem: Problem, filenamePattern: string) {
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
            await writeFile(join(stagingDirectory, file.name), file.contents + "\n", {
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
        }

        await commitStagedDirectory(stagingDirectory, targetDirectory, existing !== undefined);
    } finally {
        await rm(stagingDirectory, { recursive: true, force: true });
    }
}

export async function fetchSamples(
    url: string,
    projectRoot: string,
    testcaseConfig: Config["testcase"],
    client: Pick<ProblemClient, "getProblem">,
    sourceFolder?: string,
): Promise<FetchedSamples> {
    const targetDirectory = await resolveTestcaseDirectory(
        projectRoot,
        testcaseConfig.folder,
        sourceFolder,
    );
    const problem = await client.getProblem(url);
    return { directory: targetDirectory, problem };
}

export async function writeSamples(
    directory: string,
    problem: Problem,
    testcaseConfig: Config["testcase"],
): Promise<DownloadedSamples> {
    const files = getSampleFiles(problem, testcaseConfig.filename);

    await replaceDirectory(directory, files);
    return {
        directory,
        count: problem.samples.length,
        samples: problem.samples,
        problem,
    };
}

export async function downloadSamples(
    url: string,
    projectRoot: string,
    testcaseConfig: Config["testcase"],
    client: Pick<ProblemClient, "getProblem">,
    sourceFolder?: string,
): Promise<DownloadedSamples> {
    const fetched = await fetchSamples(url, projectRoot, testcaseConfig, client, sourceFolder);
    return writeSamples(fetched.directory, fetched.problem, testcaseConfig);
}
