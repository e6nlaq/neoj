import { createInterface } from "node:readline/promises";

import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { loadConfig } from "@/lib/project/config";
import {
    findNextHandmadeTarget,
    formatHandmadeContents,
    HandmadeAbortError,
    readHandmadeBlock,
    saveHandmadeCase,
    type HandmadePrompt,
    type HandmadeTarget,
} from "@/lib/project/handmade";
import { requireInitializedProject } from "@/lib/project/project";
import { resolveTestcaseDirectory } from "@/lib/project/testcase";
import { createAnsiStyles, supportsColor, type AnsiStyles } from "@/lib/util/ansi";

export interface RunHandmadeOptions {
    projectRoot: string;
    /** Test-case directory from `testcase.folder`. */
    folder: string;
    /** Source directory from `source.folder`, when configured. */
    sourceFolder?: string;
    /** File name pattern from `handmade.filename`. */
    filename: string;
    prompt: HandmadePrompt;
    /** Create only the `.in` file and skip the expected output. */
    inputOnly?: boolean;
    /** Styling for the block headers and the line-number gutter. */
    styles?: AnsiStyles;
}

function formatCasePath(folder: string, baseName: string, extension: string): string {
    return `${folder.split(/[\\/]/u).join("/")}/${baseName}${extension}`;
}

/** Number of columns reserved for the line number, matching the test report. */
const lineNumberWidth = 3;

function formatLinePrompt(lineNumber: number, styles: AnsiStyles): string {
    return `${styles.dim(String(lineNumber).padStart(lineNumberWidth))} ${styles.dim("│")} `;
}

export async function runHandmade(options: RunHandmadeOptions): Promise<HandmadeTarget> {
    const directory = await resolveTestcaseDirectory(
        options.projectRoot,
        options.folder,
        options.sourceFolder,
    );
    const target = await findNextHandmadeTarget(directory, options.filename);
    const inputPath = formatCasePath(options.folder, target.baseName, ".in");
    const outputPath = formatCasePath(options.folder, target.baseName, ".out");
    const styles = options.styles ?? createAnsiStyles(false);

    options.prompt.write(`${styles.bold(`Input (${target.baseName}.in)`)}\n`);
    const input = await readHandmadeBlock(options.prompt, (lineNumber) =>
        formatLinePrompt(lineNumber, styles),
    );

    if (options.inputOnly === true) {
        await saveHandmadeCase(target, formatHandmadeContents(input));
        consola.success(`Created ${inputPath}.`);

        return target;
    }

    options.prompt.write("\n");
    options.prompt.write(`${styles.bold(`Output (${target.baseName}.out)`)}\n`);
    const output = await readHandmadeBlock(options.prompt, (lineNumber) =>
        formatLinePrompt(lineNumber, styles),
    );

    await saveHandmadeCase(target, formatHandmadeContents(input), formatHandmadeContents(output));
    consola.success(`Created ${inputPath} and ${outputPath}.`);

    return target;
}

export function createHandmadeCommand(): Command {
    return new Command("handmade")
        .alias("h")
        .description("Create a handmade test case from interactive input")
        .option("-i, --input", "Create only the .in file and skip the expected output")
        .action(async (options) => {
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
                    sourceFolder: config.source.folder,
                    filename: config.handmade.filename,
                    inputOnly: options.input,
                    styles: createAnsiStyles(supportsColor(process.stdout)),
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
                    // Cancelling is a normal exit, matching login and submit.
                } else {
                    consola.error(error instanceof Error ? error.message : String(error));
                    process.exitCode = 1;
                }
            } finally {
                close();
            }
        });
}
