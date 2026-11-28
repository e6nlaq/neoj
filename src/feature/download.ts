import { Command } from "@commander-js/extra-typings";
import { deriveProblemKey } from "@neoj/api";
import type { ProblemKey, ProblemSample } from "@neoj/api/problem";
import { consola } from "consola";

import { findProblemSource } from "@/feature/problem-sources";
import { loadConfig, type Config } from "@/lib/project/config";
import {
    readProblemMetadata,
    removeProblemMetadata,
    saveProblemMetadata,
    type ProblemMetadata,
} from "@/lib/project/problem-metadata";
import { requireInitializedProject } from "@/lib/project/project";
import { resolveProjectDirectories } from "@/lib/project/project-path";
import {
    applyStash,
    EmptyStashError,
    formatStashExpiredMessage,
    lookupStash,
    saveStash,
} from "@/lib/project/stash";
import { applyProjectTemplate } from "@/lib/project/template-apply";
import {
    clearTestcaseDirectory,
    fetchSamples,
    writeSamples,
    type DownloadedSamples,
} from "@/lib/project/testcase";
import { createAnsiStyles, supportsColor, type AnsiStyles } from "@/lib/util/ansi";
import { snapshotDirectories } from "@/lib/util/directory-snapshot";
import type { ProgressStream } from "@/lib/util/progress";
import { withSpinner } from "@/lib/util/spinner";

export { getProblemWithLoginHint } from "@/feature/problem-sources";

/** Split a sample into display lines, dropping a trailing newline and CRLF. */
function sampleContentLines(content: string): string[] {
    const normalized = content.replace(/\r\n/gu, "\n").replace(/\n+$/u, "");
    return normalized === "" ? [] : normalized.split("\n");
}

export function formatSamples(
    samples: readonly ProblemSample[],
    folder: string,
    filenamePattern: string,
    styles: AnsiStyles,
): string[] {
    const relativeFolder = folder.split(/[\\/]/u).join("/");
    const gutter = styles.dim("│");

    return samples.map((sample, index) => {
        const number = index + 1;
        const fileBase = filenamePattern.replace("{}", String(number));
        const lines = [
            `${styles.bold(`Sample ${number}`)}  ${styles.dim(`${relativeFolder}/${fileBase}.in`)}`,
        ];

        for (const [label, content] of [
            ["Input", sample.input],
            ["Output", sample.output],
        ] as const) {
            lines.push(`  ${label}`);
            for (const raw of sampleContentLines(content)) {
                const text = raw.trimEnd();
                lines.push(text === "" ? `  ${gutter}` : `  ${gutter} ${text}`);
            }
        }

        return lines.join("\n");
    });
}

function formatKey(key: { platform: string; slug: string }): string {
    return `${key.platform}/${key.slug}`;
}

/** The argument that starts an empty workspace instead of downloading a problem. */
export const blankProblemArgument = "blank";

async function resolveConfiguredDirectories(
    projectRoot: string,
    config: Config,
): Promise<Map<string, string>> {
    return await resolveProjectDirectories(projectRoot, [
        { folder: config.testcase.folder, name: "testcase.folder" },
        ...(config.source.folder === undefined
            ? []
            : [{ folder: config.source.folder, name: "source.folder" }]),
        ...(config.template.folder === undefined
            ? []
            : [{ folder: config.template.folder, name: "template.folder" }]),
    ]);
}

async function stashWorkingFiles(
    projectRoot: string,
    config: Config,
    previous: ProblemMetadata,
    previousKey: ProblemKey,
): Promise<void> {
    try {
        const saved = await saveStash(
            projectRoot,
            config,
            { url: previous.url, key: previousKey },
            { force: true },
        );
        consola.info(
            `Stashed the working files for "${formatKey(previousKey)}" (${saved.fileCount} file(s)).`,
        );
    } catch (error) {
        if (!(error instanceof EmptyStashError)) {
            throw error;
        }
        consola.info("Skipped the automatic stash: there was nothing to stash.");
    }
}

async function applyConfiguredTemplate(projectRoot: string, config: Config): Promise<void> {
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

export interface DownloadProblemOptions {
    /** Where the download spinner draws; defaults to standard error. */
    stderr?: ProgressStream;
}

export async function downloadProblem(
    url: string,
    options: DownloadProblemOptions = {},
): Promise<void> {
    if (url === blankProblemArgument) {
        await createBlankWorkspace();
        return;
    }

    const stderr = options.stderr ?? process.stderr;
    const source = findProblemSource(url);
    const projectRoot = await requireInitializedProject(process.cwd());
    const config = await loadConfig();

    // Reject unsafe or overlapping destinations before the network request or
    // any file replacement.
    const projectDirectories = await resolveConfiguredDirectories(projectRoot, config);

    const previous = await readProblemMetadata(projectRoot);
    const fetched = await withSpinner(
        { text: `Downloading the problem from ${source.displayName}…`, stream: stderr },
        () =>
            fetchSamples(
                url,
                projectRoot,
                config.testcase,
                {
                    getProblem: (problemUrl) => source.fetchProblem(problemUrl),
                },
                config.source.folder,
            ),
    );

    const currentKey = fetched.problem.key ?? deriveProblemKey(fetched.problem.url);
    const previousKey =
        previous === undefined ? undefined : (previous.key ?? deriveProblemKey(previous.url));
    const problemChanged =
        previousKey === undefined ||
        previousKey.platform !== currentKey.platform ||
        previousKey.slug !== currentKey.slug;

    if (
        config.stash.auto_stash &&
        problemChanged &&
        previous !== undefined &&
        previousKey !== undefined
    ) {
        await stashWorkingFiles(projectRoot, config, previous, previousKey);
    }

    const sourceDirectory = projectDirectories.get("source.folder");
    const snapshot = await snapshotDirectories([
        { path: fetched.directory, name: "testcase.folder" },
        ...(sourceDirectory !== undefined && (config.template.enable || config.stash.auto_apply)
            ? [{ path: sourceDirectory, name: "source.folder" }]
            : []),
    ]);

    let result: DownloadedSamples;
    try {
        result = await writeSamples(fetched.directory, fetched.problem, config.testcase);

        if (config.template.enable) {
            await applyConfiguredTemplate(projectRoot, config);
            if (!problemChanged) {
                consola.warn(
                    `Re-applied the template to "${config.source.folder}" (mode: ${config.template.mode}) because the same problem was downloaded again; working files in "source.folder" may have been overwritten or removed.`,
                );
            }
        }

        if (config.stash.auto_apply && problemChanged) {
            const lookup = await lookupStash(projectRoot, currentKey, {
                expireDays: config.stash.expire_days,
            });
            if (lookup.expired !== undefined) {
                consola.warn(formatStashExpiredMessage(currentKey, lookup.expired));
            }
            if (lookup.entry !== undefined) {
                const applied = await applyStash(projectRoot, config, currentKey, {
                    expireDays: config.stash.expire_days,
                });
                for (const warning of applied.warnings) {
                    consola.warn(warning);
                }
                consola.info(
                    `Applied the stash for "${formatKey(currentKey)}" (${applied.written} file(s) written, ${applied.removed} removed).`,
                );
            }
        }

        // Save the metadata only after every file operation succeeded, so a
        // failure cannot leave new samples paired with the previous problem.
        await saveProblemMetadata(projectRoot, result.problem);
    } catch (error) {
        try {
            await snapshot.restore();
        } catch (restoreError) {
            throw new AggregateError(
                [error, restoreError],
                "The download failed and the previous files could not be restored.",
            );
        }
        throw error;
    } finally {
        await snapshot.dispose();
    }

    if (result.count === 0) {
        consola.info(`No samples found. Recreated "${result.directory}" as an empty directory.`);
        return;
    }

    if (config.download.show_sample) {
        const blocks = formatSamples(
            result.samples,
            config.testcase.folder,
            config.testcase.filename,
            createAnsiStyles(supportsColor(process.stdout)),
        );
        consola.log(`\n${blocks.join("\n\n")}\n`);
    }

    consola.success(`Downloaded ${result.count} sample(s) to "${result.directory}".`);
}

/**
 * Start an empty workspace: clear the test-case directory, apply the template,
 * and remove the recorded problem so no submission URL is left behind.
 *
 * The previous problem's files are stashed first when `stash.auto_stash` is
 * enabled. There is no key for the blank workspace, so `stash.auto_apply`
 * never restores anything into it.
 */
export async function createBlankWorkspace(): Promise<void> {
    const projectRoot = await requireInitializedProject(process.cwd());
    const config = await loadConfig();

    // Reject unsafe or overlapping destinations before any file replacement.
    const projectDirectories = await resolveConfiguredDirectories(projectRoot, config);
    const testcaseDirectory = projectDirectories.get("testcase.folder");
    if (testcaseDirectory === undefined) {
        throw new Error("testcase.folder is not configured.");
    }

    const previous = await readProblemMetadata(projectRoot);
    const previousKey =
        previous === undefined ? undefined : (previous.key ?? deriveProblemKey(previous.url));

    if (config.stash.auto_stash && previous !== undefined && previousKey !== undefined) {
        await stashWorkingFiles(projectRoot, config, previous, previousKey);
    }

    const sourceDirectory = projectDirectories.get("source.folder");
    const snapshot = await snapshotDirectories([
        { path: testcaseDirectory, name: "testcase.folder" },
        ...(sourceDirectory !== undefined && config.template.enable
            ? [{ path: sourceDirectory, name: "source.folder" }]
            : []),
    ]);

    try {
        await clearTestcaseDirectory(testcaseDirectory);

        if (config.template.enable) {
            await applyConfiguredTemplate(projectRoot, config);
        }

        // Remove the problem only after every file operation succeeded, so a
        // failure cannot leave the previous URL paired with an empty workspace.
        await removeProblemMetadata(projectRoot);
    } catch (error) {
        try {
            await snapshot.restore();
        } catch (restoreError) {
            throw new AggregateError(
                [error, restoreError],
                "The blank workspace could not be created and the previous files could not be restored.",
            );
        }
        throw error;
    } finally {
        await snapshot.dispose();
    }

    consola.success(
        `Created a blank workspace: "${config.testcase.folder}" is empty and no problem URL is recorded.`,
    );
}

export function createDownloadCommand(): Command<[string]> {
    return new Command("download")
        .alias("d")
        .description('Download problem samples, or create an empty workspace with "blank"')
        .argument("<url>", 'Problem URL from a supported platform, or "blank"')
        .action(async (url) => {
            try {
                await downloadProblem(url);
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
