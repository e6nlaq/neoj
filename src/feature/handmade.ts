import { createInterface } from "node:readline/promises";
import { PassThrough } from "node:stream";
import { StringDecoder } from "node:string_decoder";

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

export interface HandmadeTerminalInput extends NodeJS.ReadableStream {
    isTTY?: boolean;
    setRawMode?(mode: boolean): void;
}

export interface HandmadeTerminalOutput extends NodeJS.WritableStream {
    isTTY?: boolean;
}

export interface HandmadePromptSession {
    prompt: HandmadePrompt;
    close(): void;
}

/** Deliver each pasted line in its own event-loop turn. */
function forwardInputLines(input: PassThrough, text: string, isStopped: () => boolean): void {
    const write = (piece: string) => {
        setImmediate(() => {
            if (!isStopped() && !input.destroyed) {
                input.write(piece);
            }
        });
    };

    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character !== "\n" && character !== "\r") {
            continue;
        }

        // Keep CRLF together so readline does not treat the LF as a second Enter.
        const end = character === "\r" && text[index + 1] === "\n" ? index + 2 : index + 1;
        write(text.slice(start, end));
        start = end;
        index = end - 1;
    }

    if (start < text.length) {
        write(text.slice(start));
    }
}

/**
 * Build the readline-backed prompt for an interactive terminal.
 *
 * Readline echoes a chunk containing several pasted lines before the caller
 * can print the next prompt, which leaves those lines without a gutter. Input
 * is split at line endings and forwarded one line per event-loop turn, so the
 * line-number prompt is written before the next line is echoed.
 */
export function createHandmadePrompt(
    source: HandmadeTerminalInput,
    sink: HandmadeTerminalOutput,
): HandmadePromptSession {
    const input = new PassThrough() as PassThrough & {
        isTTY: boolean;
        setRawMode(mode: boolean): void;
    };
    input.isTTY = source.isTTY === true;
    input.setRawMode = (mode) => source.setRawMode?.(mode);

    const readline = createInterface({ input, output: sink, terminal: true });
    let closed = false;
    let stopped = false;
    let started = false;
    const pending: string[] = [];
    readline.on("close", () => {
        closed = true;
    });
    const iterator = readline[Symbol.asyncIterator]();
    const decoder = new StringDecoder("utf8");

    const onData = (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
        if (!started) {
            // Hold input that arrives before the first prompt, so it is echoed
            // under the numbered gutter instead of above the block header.
            pending.push(text);
            return;
        }
        forwardInputLines(input, text, () => stopped);
    };
    const onEnd = () => {
        const tail = decoder.end();
        if (tail !== "") {
            forwardInputLines(input, tail, () => stopped);
        }
        setImmediate(() => input.end());
    };
    source.on("data", onData);
    source.on("end", onEnd);

    return {
        prompt: {
            write: (text) => {
                sink.write(text);
            },
            readLine: async (prompt) => {
                if (closed) {
                    return undefined;
                }
                // Register the prompt so history navigation redraws it.
                readline.setPrompt(prompt);
                readline.prompt();
                if (!started) {
                    started = true;
                    const buffered = pending.join("");
                    pending.length = 0;
                    if (buffered !== "") {
                        forwardInputLines(input, buffered, () => stopped);
                    }
                }
                const result = await iterator.next();
                return result.done ? undefined : result.value;
            },
        },
        close: () => {
            stopped = true;
            source.off("data", onData);
            source.off("end", onEnd);
            readline.close();
            input.end();
        },
    };
}

export function createHandmadeCommand(): Command {
    return new Command("handmade")
        .alias("h")
        .description("Create a handmade test case from interactive input")
        .option("-i, --input", "Create only the .in file and skip the expected output")
        .action(async (options) => {
            let session: HandmadePromptSession | undefined;
            try {
                if (!process.stdin.isTTY) {
                    throw new Error(
                        "neoj handmade needs an interactive terminal. Run it from a terminal instead of piping input.",
                    );
                }

                const projectRoot = await requireInitializedProject(process.cwd());
                const config = await loadConfig();
                session = createHandmadePrompt(process.stdin, process.stdout);

                await runHandmade({
                    projectRoot,
                    folder: config.testcase.folder,
                    sourceFolder: config.source.folder,
                    filename: config.handmade.filename,
                    inputOnly: options.input,
                    styles: createAnsiStyles(supportsColor(process.stdout)),
                    prompt: session.prompt,
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
                session?.close();
            }
        });
}
