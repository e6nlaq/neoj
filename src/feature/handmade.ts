import { createInterface } from "node:readline/promises";

import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { loadConfig } from "@/lib/util/config";
import {
    findNextHandmadeTarget,
    formatHandmadeContents,
    HandmadeAbortError,
    readHandmadeBlock,
    saveHandmadeCase,
    type HandmadePrompt,
    type HandmadeTarget,
} from "@/lib/util/handmade";
import { requireInitializedProject } from "@/lib/util/project";
import { resolveTestcaseDirectory } from "@/lib/util/testcase";

export interface RunHandmadeOptions {
    projectRoot: string;
    /** Test-case directory from `testcase.folder`. */
    folder: string;
    /** File name pattern from `handmade.filename`. */
    filename: string;
    prompt: HandmadePrompt;
}

function formatCasePath(folder: string, baseName: string, extension: string): string {
    return `${folder.split(/[\\/]/u).join("/")}/${baseName}${extension}`;
}

export async function runHandmade(options: RunHandmadeOptions): Promise<HandmadeTarget> {
    const directory = await resolveTestcaseDirectory(options.projectRoot, options.folder);
    const target = await findNextHandmadeTarget(directory, options.filename);
    const inputPath = formatCasePath(options.folder, target.baseName, ".in");
    const outputPath = formatCasePath(options.folder, target.baseName, ".out");

    consola.info(`${inputPath} and ${outputPath} will be created.`);

    const input = await readHandmadeBlock(options.prompt, "input");
    options.prompt.write("\n");
    const output = await readHandmadeBlock(options.prompt, "output");

    await saveHandmadeCase(target, formatHandmadeContents(input), formatHandmadeContents(output));
    consola.success(`Created ${inputPath} and ${outputPath}.`);

    return target;
}

export function createHandmadeCommand(): Command {
    return new Command("handmade")
        .alias("h")
        .description("Create a handmade test case from interactive input")
        .action(async () => {
            let close = () => {};
            try {
                if (!process.stdin.isTTY) {
                    throw new Error(
                        "neoj handmade needs an interactive terminal. Run it from a terminal instead of piping input.",
                    );
                }

                const projectRoot = await requireInitializedProject(process.cwd());
                const config = await loadConfig();
                const readline = createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });
                close = () => readline.close();
                let closed = false;
                readline.on("close", () => {
                    closed = true;
                });
                const iterator = readline[Symbol.asyncIterator]();

                await runHandmade({
                    projectRoot,
                    folder: config.testcase.folder,
                    filename: config.handmade.filename,
                    prompt: {
                        write: (text) => {
                            process.stdout.write(text);
                        },
                        readLine: async (prompt) => {
                            if (closed) {
                                return undefined;
                            }
                            // Register the prompt so history navigation redraws it.
                            readline.setPrompt(prompt);
                            readline.prompt();
                            const result = await iterator.next();
                            return result.done ? undefined : result.value;
                        },
                    },
                });
            } catch (error) {
                if (error instanceof HandmadeAbortError) {
                    // EOF leaves the cursor after the last prompt, without a newline.
                    process.stdout.write("\n");
                    consola.info(error.message);
                } else {
                    consola.error(error instanceof Error ? error.message : String(error));
                }
                process.exitCode = 1;
            } finally {
                close();
            }
        });
}
