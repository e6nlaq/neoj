import { Command } from "@commander-js/extra-typings";
import { deriveProblemKey } from "@neoj/api";
import type { ProblemSample } from "@neoj/api/problem";
import { consola } from "consola";

import { findProblemSource } from "@/feature/problem-sources";
import { loadConfig } from "@/lib/util/config";
import { readProblemMetadata, saveProblemMetadata } from "@/lib/util/problem-metadata";
import { requireInitializedProject } from "@/lib/util/project";
import { applyStash, EmptyStashError, findStash, saveStash } from "@/lib/util/stash";
import { applyProjectTemplate } from "@/lib/util/template-apply";
import { fetchSamples, writeSamples } from "@/lib/util/testcase";

export { getProblemWithLoginHint } from "@/feature/problem-sources";

export function formatSamples(
    samples: readonly ProblemSample[],
    folder: string,
    filenamePattern: string,
): string[] {
    const relativeFolder = folder.split(/[\\/]/u).join("/");
    return samples.map(
        (sample, index) =>
            `Sample ${index + 1}\nInput [${relativeFolder}/${filenamePattern.replace("{}", String(index + 1))}.in]:\n${sample.input}\nOutput [${relativeFolder}/${filenamePattern.replace("{}", String(index + 1))}.out]:\n${sample.output}\n`,
    );
}

function formatKey(key: { platform: string; slug: string }): string {
    return `${key.platform}/${key.slug}`;
}

export async function downloadProblem(url: string): Promise<void> {
    const source = findProblemSource(url);
    const projectRoot = await requireInitializedProject(process.cwd());
    const config = await loadConfig();

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

    const result = await writeSamples(fetched.directory, fetched.problem, config.testcase);

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

    await saveProblemMetadata(projectRoot, result.problem);

    if (result.count === 0) {
        consola.info(`No samples found. Recreated "${result.directory}" as an empty directory.`);
        return;
    }

    if (config.download.show_sample) {
        for (const sample of formatSamples(
            result.samples,
            config.testcase.folder,
            config.testcase.filename,
        )) {
            consola.info(sample);
        }
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
