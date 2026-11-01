import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { findProblemSource } from "@/feature/problem-sources";
import type { ProblemSample } from "@/lib/service/problem";
import { loadConfig } from "@/lib/util/config";
import { saveProblemMetadata } from "@/lib/util/problem-metadata";
import { requireInitializedProject } from "@/lib/util/project";
import { applyProjectTemplate } from "@/lib/util/template-apply";
import { downloadSamples } from "@/lib/util/testcase";

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

export async function downloadProblem(url: string): Promise<void> {
    const source = findProblemSource(url);
    const projectRoot = await requireInitializedProject(process.cwd());
    const config = await loadConfig();

    const result = await downloadSamples(url, projectRoot, config.testcase, {
        getProblem: (problemUrl) => source.fetchProblem(problemUrl),
    });

    if (config.template.enable) {
        const templateFolder = config.template.folder;
        const sourcePath = config.src;
        if (templateFolder === undefined || sourcePath === undefined) {
            throw new Error(
                "Configuration requires src and template.folder when template.enable is true.",
            );
        }
        await applyProjectTemplate(projectRoot, templateFolder, sourcePath, config.template.mode);
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
