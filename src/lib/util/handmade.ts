import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { hasErrorCode } from "@/lib/util/errors";

/** A test case number that is free in the test-case directory. */
export interface HandmadeTarget {
    directory: string;
    baseName: string;
    inputPath: string;
    outputPath: string;
}

/** The line-oriented input `neoj handmade` reads its test case from. */
export interface HandmadePrompt {
    /** Write text that is not a prompt, such as the blank line between blocks. */
    write(text: string): void;
    /** Show `prompt` and read one line, or `undefined` when the input ends. */
    readLine(prompt: string): Promise<string | undefined>;
}

/** Thrown when the input ends before both blocks were terminated by a blank line. */
export class HandmadeAbortError extends Error {
    constructor() {
        super("Cancelled. No files were written.");
        this.name = "HandmadeAbortError";
    }
}

async function collectExistingCaseNames(directory: string): Promise<Set<string>> {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
            return new Set();
        }
        throw error;
    }

    const names = new Set<string>();
    for (const entry of entries) {
        if (entry.name.endsWith(".in")) {
            names.add(entry.name.slice(0, -".in".length));
        } else if (entry.name.endsWith(".out")) {
            names.add(entry.name.slice(0, -".out".length));
        }
    }

    return names;
}

/**
 * Pick the smallest case number whose `.in` and `.out` files do not exist yet.
 *
 * Both files are considered, so a half-written pair is never reused.
 */
export async function findNextHandmadeTarget(
    directory: string,
    filenamePattern: string,
): Promise<HandmadeTarget> {
    if (!filenamePattern.includes("{}")) {
        throw new Error(`The handmade file name pattern "${filenamePattern}" must contain {}.`);
    }

    const existing = await collectExistingCaseNames(directory);

    for (let number = 1; ; number += 1) {
        const baseName = filenamePattern.replace("{}", String(number));
        if (!existing.has(baseName)) {
            return {
                directory,
                baseName,
                inputPath: join(directory, `${baseName}.in`),
                outputPath: join(directory, `${baseName}.out`),
            };
        }
    }
}

/** Join the entered lines the way a sample file is written, with a trailing newline. */
export function formatHandmadeContents(lines: readonly string[]): string {
    return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
            return false;
        }
        throw error;
    }
}

function createExistsError(target: HandmadeTarget): Error {
    return new Error(
        `Test case "${target.baseName}" already exists in "${target.directory}". Run "neoj handmade" again to use the next number.`,
    );
}

/**
 * Write the `.in` and `.out` files of a case that was entered in full.
 *
 * Existing files are never replaced; when the `.out` write fails, the `.in`
 * file written by this call is removed so no half case is left behind.
 */
export async function saveHandmadeCase(
    target: HandmadeTarget,
    input: string,
    output: string,
): Promise<void> {
    await mkdir(target.directory, { recursive: true });

    if ((await pathExists(target.inputPath)) || (await pathExists(target.outputPath))) {
        throw createExistsError(target);
    }

    try {
        await writeFile(target.inputPath, input, { encoding: "utf8", flag: "wx" });
    } catch (error) {
        if (hasErrorCode(error, "EEXIST")) {
            throw createExistsError(target);
        }
        throw error;
    }

    try {
        await writeFile(target.outputPath, output, { encoding: "utf8", flag: "wx" });
    } catch (error) {
        await rm(target.inputPath, { force: true });
        if (hasErrorCode(error, "EEXIST")) {
            throw createExistsError(target);
        }
        throw error;
    }
}

/** Read lines until a blank line, which ends the block. */
export async function readHandmadeBlock(prompt: HandmadePrompt, label: string): Promise<string[]> {
    const lines: string[] = [];

    for (;;) {
        const line = await prompt.readLine(`${label}> `);
        if (line === undefined) {
            throw new HandmadeAbortError();
        }
        if (line === "") {
            return lines;
        }
        lines.push(line);
    }
}
