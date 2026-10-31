import { dirname, resolve } from "node:path";

import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { loadConfig } from "@/lib/util/config";
import { findProjectConfig } from "@/lib/util/project";
import { downloadAtCoderSamples } from "@/lib/util/testcase";

export async function downloadProblem(url: string): Promise<void> {
    const config = await loadConfig();
    const projectConfigPath = await findProjectConfig(process.cwd());
    const projectRoot = projectConfigPath ? dirname(projectConfigPath) : resolve(process.cwd());
    const result = await downloadAtCoderSamples(url, projectRoot, config.testcase);

    if (result.count === 0) {
        consola.info(`No samples found. Recreated "${result.directory}" as an empty directory.`);
        return;
    }

    consola.success(`Downloaded ${result.count} sample(s) to "${result.directory}".`);
}

export function createDownloadCommand(): Command<[string]> {
    return new Command("download")
        .alias("d")
        .description("Download problem samples into the test-case directory")
        .argument("<url>", "AtCoder problem URL")
        .action(async (url) => {
            try {
                await downloadProblem(url);
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
