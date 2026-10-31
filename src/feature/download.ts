import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { getAtCoderSession } from "@/feature/login/atcoder";
import {
    AtCoderClient,
    AtCoderProblemRequestError,
    type AtCoderSample,
    parseAtCoderProblemUrl,
} from "@/lib/service/atcoder";
import { readAuth } from "@/lib/util/auth";
import { loadConfig } from "@/lib/util/config";
import { requireInitializedProject } from "@/lib/util/project";
import { applyProjectTemplate } from "@/lib/util/template-apply";
import { downloadAtCoderSamples } from "@/lib/util/testcase";

export async function getProblemWithLoginHint(
    url: string,
    client: Pick<AtCoderClient, "getProblem">,
    loggedIn: boolean,
) {
    try {
        return await client.getProblem(url);
    } catch (error) {
        if (error instanceof AtCoderProblemRequestError && error.status === 404 && !loggedIn) {
            throw new Error(
                `${error.message} If the problem requires an account, try "neoj login atcoder".`,
                { cause: error },
            );
        }
        throw error;
    }
}

export function formatSamples(
    samples: readonly AtCoderSample[],
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
    parseAtCoderProblemUrl(url);
    const projectRoot = await requireInitializedProject(process.cwd());
    const config = await loadConfig();
    const auth = await readAuth();
    const client = new AtCoderClient();
    const savedSession = getAtCoderSession(auth.atcoder);
    const loggedIn = savedSession === undefined ? false : await client.login(savedSession);

    const result = await downloadAtCoderSamples(url, projectRoot, config.testcase, {
        getProblem: (problemUrl) => getProblemWithLoginHint(problemUrl, client, loggedIn),
    });

    if (config.template.enable) {
        const templatePath = config.template.path;
        const sourcePath = config.src;
        if (templatePath === undefined || sourcePath === undefined) {
            throw new Error(
                "Configuration requires src and template.path when template.enable is true.",
            );
        }
        await applyProjectTemplate(projectRoot, templatePath, sourcePath, config.template.mode);
    }

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
