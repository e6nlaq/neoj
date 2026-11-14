import { Command } from "@commander-js/extra-typings";
import { deriveProblemKey } from "@neoj/api";
import type { ProblemSample } from "@neoj/api/problem";
import { consola } from "consola";

import { findProblemSource } from "@/feature/problem-sources";
import { createAnsiStyles, supportsColor, type AnsiStyles } from "@/lib/util/ansi";
import { loadConfig } from "@/lib/util/config";
import { snapshotDirectories } from "@/lib/util/directory-snapshot";
import { readProblemMetadata, saveProblemMetadata } from "@/lib/util/problem-metadata";
import { requireInitializedProject } from "@/lib/util/project";
import { resolveProjectDirectories } from "@/lib/util/project-path";
import { applyStash, EmptyStashError, findStash, saveStash } from "@/lib/util/stash";
import { applyProjectTemplate } from "@/lib/util/template-apply";
import { fetchSamples, writeSamples, type DownloadedSamples } from "@/lib/util/testcase";

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

export async function downloadProblem(url: string): Promise<void> {
    const source = findProblemSource(url);
    const projectRoot = await requireInitializedProject(process.cwd());
    const config = await loadConfig();

    // Reject unsafe or overlapping destinations before the network request or
    // any file replacement.
    const projectDirectories = await resolveProjectDirectories(projectRoot, [
        { folder: config.testcase.folder, name: "testcase.folder" },
        ...(config.src === undefined ? [] : [{ folder: config.src, name: "src" }]),
        ...(config.template.folder === undefined
            ? []
            : [{ folder: config.template.folder, name: "template.folder" }]),
    ]);

    const previous = await readProblemMetadata(projectRoot);
    const fetched = await fetchSamples(
        url,
        projectRoot,
        config.testcase,
        {
            getProblem: (problemUrl) => source.fetchProblem(problemUrl),
        },
        config.src,
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

    const sourceDirectory = projectDirectories.get("src");
    const snapshot = await snapshotDirectories([
        { path: fetched.directory, name: "testcase.folder" },
        ...(sourceDirectory !== undefined && (config.template.enable || config.stash.auto_apply)
            ? [{ path: sourceDirectory, name: "src" }]
            : []),
    ]);

    let result: DownloadedSamples;
    try {
        result = await writeSamples(fetched.directory, fetched.problem, config.testcase);

        if (problemChanged && config.template.enable) {
            const templateFolder = config.template.folder;
            const sourcePath = config.src;
            if (templateFolder === undefined || sourcePath === undefined) {
                throw new Error(
                    "Configuration requires src and template.folder when template.enable is true.",
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

        if (config.stash.auto_apply && problemChanged) {
            const entry = await findStash(projectRoot, currentKey);
            if (entry !== undefined) {
                const applied = await applyStash(projectRoot, config, currentKey);
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

export function createDownloadCommand(): Command<[string]> {
    return new Command("download")
        .alias("d")
        .description("Download problem samples into the test-case directory")
        .argument("<url>", "Problem URL from a supported platform")
        .action(async (url) => {
            try {
                await downloadProblem(url);
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
