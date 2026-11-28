import { readdir } from "node:fs/promises";

import { Command } from "@commander-js/extra-typings";
import { confirm } from "@inquirer/prompts";
import { consola } from "consola";

import { findProblemSource } from "@/feature/problem-sources";
import { loadConfig } from "@/lib/project/config";
import { noRecordedProblemMessage, readProblemMetadata } from "@/lib/project/problem-metadata";
import { requireInitializedProject } from "@/lib/project/project";
import { resolveProjectDirectories } from "@/lib/project/project-path";
import { applyProjectTemplate } from "@/lib/project/template-apply";
import { fetchSamples, writeSamples } from "@/lib/project/testcase";
import { snapshotDirectories } from "@/lib/util/directory-snapshot";
import { hasErrorCode } from "@/lib/util/errors";

export interface ResetOptions {
    /** Restore both `source.folder` and the test cases. */
    all?: boolean;
    /** Re-download the test cases only. */
    testcase?: boolean;
    /** Skip the confirmation prompt. */
    yes?: boolean;
}

export interface ResetDependencies {
    confirm?: (options: { message: string; default: boolean }) => Promise<boolean>;
}

function formatFolder(folder: string): string {
    return folder.split(/[\\/]/u).join("/");
}

/** Whether a file name is a handmade test case written with `handmade.filename`. */
function isHandmadeName(name: string, pattern: string): boolean {
    const brace = pattern.indexOf("{}");
    const prefix = pattern.slice(0, brace);
    const suffix = pattern.slice(brace + 2);

    for (const extension of [".in", ".out"]) {
        const tail = `${suffix}${extension}`;
        if (!name.startsWith(prefix) || !name.endsWith(tail)) {
            continue;
        }
        const number = name.slice(prefix.length, name.length - tail.length);
        if (
            number.length > 0 &&
            [...number].every((character) => character >= "0" && character <= "9")
        ) {
            return true;
        }
    }

    return false;
}

async function findHandmadeNames(directory: string, filenamePattern: string): Promise<string[]> {
    let entries: string[];
    try {
        entries = await readdir(directory);
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
            return [];
        }
        throw error;
    }
    return entries.filter((name) => isHandmadeName(name, filenamePattern));
}

function buildConfirmMessage(actions: readonly string[], handmadeWarning?: string): string {
    const sentences = [`This will ${actions.join(" and ")}.`];
    if (handmadeWarning !== undefined) {
        sentences.push(handmadeWarning);
    }
    return `${sentences.join(" ")} Continue?`;
}

/**
 * Restore the workspace to its initial state: re-apply the template to
 * `source.folder` and optionally re-download the samples recorded by the last
 * `neoj download`.
 *
 * Without flags only the source folder is restored. `--testcase` re-downloads
 * the test cases only, and `--all` restores both. Nothing is written before the
 * confirmation prompt, and a failure after the first write restores the
 * snapshot taken before the reset.
 */
export async function resetWorkspace(
    options: ResetOptions,
    dependencies: ResetDependencies = {},
): Promise<void> {
    const testcaseRequested = options.all === true || options.testcase === true;
    const sourceRequested = options.all === true || !testcaseRequested;

    const projectRoot = await requireInitializedProject(process.cwd());
    const config = await loadConfig();

    const templateUsable =
        config.template.enable &&
        config.template.folder !== undefined &&
        config.source.folder !== undefined;

    if (sourceRequested && !templateUsable) {
        if (!testcaseRequested) {
            throw new Error(
                'Cannot restore "source.folder": template.enable is false in this project.',
            );
        }
        consola.warn("Skipping the template restore: template.enable is false in this project.");
    }
    const sourceRestore = sourceRequested && templateUsable;

    let problemUrl: string | undefined;
    if (testcaseRequested) {
        const metadata = await readProblemMetadata(projectRoot);
        if (metadata === undefined) {
            throw new Error(noRecordedProblemMessage);
        }
        problemUrl = metadata.url;
    }
    const testcaseRestore = problemUrl !== undefined;

    const resolved = await resolveProjectDirectories(projectRoot, [
        ...(sourceRestore && config.source.folder !== undefined
            ? [{ folder: config.source.folder, name: "source.folder" }]
            : []),
        ...(sourceRestore && config.template.folder !== undefined
            ? [{ folder: config.template.folder, name: "template.folder" }]
            : []),
        ...(testcaseRestore ? [{ folder: config.testcase.folder, name: "testcase.folder" }] : []),
    ]);

    const actions: string[] = [];
    if (sourceRestore) {
        actions.push('overwrite "source.folder" with the template');
    }
    let handmadeWarning: string | undefined;
    if (testcaseRestore) {
        const folder = formatFolder(config.testcase.folder);
        actions.push(`replace every file in "${folder}" with the freshly downloaded samples`);
        const handmadeNames = await findHandmadeNames(
            resolved.get("testcase.folder")!,
            config.handmade.filename,
        );
        if (handmadeNames.length > 0) {
            handmadeWarning = `The ${handmadeNames.length} handmade test case file(s) in "${folder}" will also be deleted.`;
        }
    }

    if (options.yes !== true) {
        const accepted = await (dependencies.confirm ?? confirm)({
            message: buildConfirmMessage(actions, handmadeWarning),
            default: false,
        });
        if (!accepted) {
            consola.info("Reset cancelled.");
            return;
        }
    }

    const snapshot = await snapshotDirectories([
        ...(sourceRestore ? [{ path: resolved.get("source.folder")!, name: "source.folder" }] : []),
        ...(testcaseRestore
            ? [{ path: resolved.get("testcase.folder")!, name: "testcase.folder" }]
            : []),
    ]);

    let downloadedCount: number | undefined;
    try {
        if (sourceRestore) {
            const templateFolder = config.template.folder;
            const sourcePath = config.source.folder;
            if (templateFolder === undefined || sourcePath === undefined) {
                throw new Error(
                    "Configuration requires source.folder and template.folder when template.enable is true.",
                );
            }
            await applyProjectTemplate(
                projectRoot,
                templateFolder,
                sourcePath,
                config.template.mode,
                config.template.exclude,
            );
        }

        if (testcaseRestore) {
            const source = findProblemSource(problemUrl!);
            const fetched = await fetchSamples(
                problemUrl!,
                projectRoot,
                config.testcase,
                {
                    getProblem: (url) => source.fetchProblem(url),
                },
                config.source.folder,
            );
            const result = await writeSamples(fetched.directory, fetched.problem, config.testcase);
            downloadedCount = result.count;
        }
    } catch (error) {
        try {
            await snapshot.restore();
        } catch (restoreError) {
            throw new AggregateError(
                [error, restoreError],
                "The reset failed and the previous files could not be restored.",
            );
        }
        throw error;
    } finally {
        await snapshot.dispose();
    }

    if (sourceRestore) {
        consola.success(
            `Restored "source.folder" from the template (mode: ${config.template.mode}).`,
        );
    }
    if (testcaseRestore) {
        if (downloadedCount === 0) {
            consola.info(
                `No samples found. Recreated "${formatFolder(config.testcase.folder)}" as an empty directory.`,
            );
        } else {
            consola.success(
                `Re-downloaded ${downloadedCount} sample(s) to "${formatFolder(config.testcase.folder)}".`,
            );
        }
    }
}

export function createResetCommand(): Command {
    return new Command("reset")
        .description("Restore source.folder, and optionally the test cases, to the initial state")
        .option("-a, --all", "Restore both source.folder and the test cases")
        .option("-t, --testcase", "Re-download the test cases only")
        .option("-y, --yes", "Skip the confirmation prompt")
        .action(async ({ all, testcase, yes }) => {
            try {
                if (!process.stdin.isTTY && yes !== true) {
                    throw new Error(
                        "neoj reset needs an interactive terminal to confirm. Run it from a terminal, or pass --yes to skip the confirmation.",
                    );
                }
                await resetWorkspace({ all, testcase, yes });
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
