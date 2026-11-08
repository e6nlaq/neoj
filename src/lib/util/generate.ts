import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { defaultOutputLimitBytes, runCommand, type CommandResult } from "@/lib/util/command-runner";
import type { Config } from "@/lib/util/config";
import { collectExistingCaseNames } from "@/lib/util/handmade";
import { createProgressBar } from "@/lib/util/progress";
import {
    auxiliaryPlaceholderNames,
    buildAuxiliaryTool,
    cleanupBuild,
    defaultJobCount,
    describeExit,
    expandTokens,
    type BuiltInteractor,
} from "@/lib/util/test-runner";
import { resolveTestcaseDirectory } from "@/lib/util/testcase";

/** One test case picked for generation, with its free case number. */
export interface GenerateCaseSpec {
    number: number;
    baseName: string;
}

/** A test case whose files were written in full. */
export interface GeneratedCase {
    number: number;
    baseName: string;
    inputPath: string;
    /** Defined unless the run was input-only. */
    outputPath: string | undefined;
}

export interface RunGenerateOptions {
    projectRoot: string;
    config: Config;
    /** Create only `.in` files; `generate.naive` is not needed. */
    inputOnly?: boolean;
    /** Number of cases to create; defaults to `generate.count`. */
    count?: number;
    jobs?: number;
    parallel?: boolean;
    progress?: boolean;
    cache?: boolean;
    /** Aborts the run: in-flight tools are killed and incomplete cases removed. */
    signal?: AbortSignal;
    stderr?: { write(chunk: string): unknown; isTTY?: boolean; columns?: number };
}

export interface RunGenerateResult {
    directory: string;
    cases: GeneratedCase[];
}

/** The run was aborted through the `signal` option. */
export class GenerateInterruptedError extends Error {
    constructor() {
        super("Interrupted. Incomplete test cases were removed.");
        this.name = "GenerateInterruptedError";
    }
}

interface GenerateSettings {
    gen: string;
    naive: string | undefined;
}

/** Validate the `[generate]` section for the requested mode. */
export function requireGenerateSettings(config: Config, inputOnly: boolean): GenerateSettings {
    const gen = config.generate.gen;
    if (gen === undefined || gen.trim() === "") {
        throw new Error(
            'neoj generate needs generate.gen. Add it to neoj.toml:\n\n  [generate]\n  gen = "judge/gen.cpp"',
        );
    }
    const naive = config.generate.naive;
    if (!inputOnly && (naive === undefined || naive.trim() === "")) {
        throw new Error(
            'Generating outputs needs generate.naive. Add it to neoj.toml, or pass --input to create inputs only:\n\n  [generate]\n  naive = "judge/naive.cpp"',
        );
    }

    return { gen, naive: inputOnly ? undefined : naive };
}

/**
 * Pick `count` case numbers whose `.in` and `.out` files do not exist yet.
 *
 * Both extensions are considered, so an input-only case is never overwritten.
 */
export async function findFreeCaseSpecs(
    directory: string,
    filenamePattern: string,
    count: number,
): Promise<GenerateCaseSpec[]> {
    if (!filenamePattern.includes("{}")) {
        throw new Error(`The generate file name pattern "${filenamePattern}" must contain {}.`);
    }

    const existing = await collectExistingCaseNames(directory);
    const specs: GenerateCaseSpec[] = [];
    for (let number = 1; specs.length < count; number += 1) {
        const baseName = filenamePattern.replace("{}", String(number));
        if (!existing.has(baseName)) {
            specs.push({ number, baseName });
        }
    }

    return specs;
}

function formatToolFailure(
    noun: string,
    baseName: string,
    result: CommandResult,
    timeoutSeconds: number,
    outputLimitBytes: number,
): Error {
    if (result.timedOut) {
        return new Error(`${noun} timed out after ${timeoutSeconds} s on "${baseName}".`);
    }
    if (result.outputLimitExceeded) {
        return new Error(
            `${noun} exceeded the ${Math.round(outputLimitBytes / (1024 * 1024))} MiB output limit on "${baseName}".`,
        );
    }

    const stderr = result.stderr.trimEnd();
    return new Error(
        `${noun} failed on "${baseName}" (${describeExit(result)}).${stderr === "" ? "" : `\n\n${stderr}`}`,
    );
}

function isAborted(signal: AbortSignal | undefined): boolean {
    return signal?.aborted === true;
}

interface ToolContext {
    projectRoot: string;
    directory: string;
    genArgv: readonly string[];
    naiveArgv: readonly string[] | undefined;
    timeoutSeconds: number;
    outputLimitBytes: number;
    signal: AbortSignal | undefined;
    /** Files of cases that are not complete yet; removed when the run aborts. */
    pendingFiles: Set<string>;
}

async function writeAtomically(
    context: ToolContext,
    path: string,
    contents: string,
): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.tmp`;
    context.pendingFiles.add(temporaryPath);
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
    context.pendingFiles.delete(temporaryPath);
    context.pendingFiles.add(path);
}

async function generateCase(context: ToolContext, spec: GenerateCaseSpec): Promise<GeneratedCase> {
    const genResult = await runCommand({
        argv: [...context.genArgv, String(spec.number)],
        cwd: context.projectRoot,
        timeoutMs: context.timeoutSeconds * 1000,
        outputLimitBytes: context.outputLimitBytes,
        signal: context.signal,
    });
    if (isAborted(context.signal)) {
        throw new GenerateInterruptedError();
    }
    if (genResult.timedOut || genResult.outputLimitExceeded || genResult.exitCode !== 0) {
        throw formatToolFailure(
            "Generator",
            spec.baseName,
            genResult,
            context.timeoutSeconds,
            context.outputLimitBytes,
        );
    }
    const input = genResult.stdout;

    let output: string | undefined;
    if (context.naiveArgv !== undefined) {
        const naiveResult = await runCommand({
            argv: context.naiveArgv,
            cwd: context.projectRoot,
            stdinText: input,
            timeoutMs: context.timeoutSeconds * 1000,
            outputLimitBytes: context.outputLimitBytes,
            signal: context.signal,
        });
        if (isAborted(context.signal)) {
            throw new GenerateInterruptedError();
        }
        if (naiveResult.timedOut || naiveResult.outputLimitExceeded || naiveResult.exitCode !== 0) {
            throw formatToolFailure(
                "Naive solution",
                spec.baseName,
                naiveResult,
                context.timeoutSeconds,
                context.outputLimitBytes,
            );
        }
        output = naiveResult.stdout;
    }

    // Both parts are in memory before anything is written, and each file is
    // renamed into place, so a crash never leaves a half-written file behind.
    const inputPath = join(context.directory, `${spec.baseName}.in`);
    await writeAtomically(context, inputPath, input);
    let outputPath: string | undefined;
    if (output !== undefined) {
        outputPath = join(context.directory, `${spec.baseName}.out`);
        await writeAtomically(context, outputPath, output);
    }

    context.pendingFiles.delete(inputPath);
    if (outputPath !== undefined) {
        context.pendingFiles.delete(outputPath);
    }

    return { number: spec.number, baseName: spec.baseName, inputPath, outputPath };
}

async function buildTool(
    options: RunGenerateOptions & { projectRoot: string },
    settings: { source: string },
    label: string,
    noun: string,
    testDirectory: string,
): Promise<BuiltInteractor> {
    const stderr = options.stderr ?? process.stderr;
    return buildAuxiliaryTool({
        projectRoot: options.projectRoot,
        config: options.config,
        cache: options.cache,
        settings,
        label,
        noun,
        testDirectory,
        onCompilerOutput: (chunk) => stderr.write(`${chunk}\n`),
        onCompiled: (line) => stderr.write(`${line}\n`),
    });
}

/**
 * Build the generator (and the naive solution unless input-only), then create
 * the requested number of random test cases.
 *
 * Throws for configuration, compile, and tool problems; an aborted run throws
 * `GenerateInterruptedError` after removing the files of incomplete cases.
 */
export async function runGenerate(options: RunGenerateOptions): Promise<RunGenerateResult> {
    const projectRoot = await realpath(options.projectRoot);
    const inputOnly = options.inputOnly === true;
    const settings = requireGenerateSettings(options.config, inputOnly);
    const count = options.count ?? options.config.generate.count;
    const directory = await resolveTestcaseDirectory(
        projectRoot,
        options.config.testcase.folder,
        options.config.src,
    );
    const specs = await findFreeCaseSpecs(directory, options.config.generate.filename, count);
    await mkdir(directory, { recursive: true });

    const stderr = options.stderr ?? process.stderr;
    const builtGen = await buildTool(
        { ...options, projectRoot },
        { source: settings.gen },
        "generate.gen",
        "Generator",
        directory,
    );
    let builtNaive: BuiltInteractor | undefined;
    try {
        if (settings.naive !== undefined) {
            builtNaive = await buildTool(
                { ...options, projectRoot },
                { source: settings.naive },
                "generate.naive",
                "Naive solution",
                directory,
            );
        }

        const genArgv = expandTokens(
            builtGen.runTokens,
            { ...builtGen.placeholders, infile: "" },
            "generate.gen.run",
            auxiliaryPlaceholderNames,
        );
        const naiveArgv =
            builtNaive === undefined
                ? undefined
                : expandTokens(
                      builtNaive.runTokens,
                      { ...builtNaive.placeholders, infile: "" },
                      "generate.naive.run",
                      auxiliaryPlaceholderNames,
                  );

        const parallel = options.parallel ?? options.config.generate.parallel;
        const jobCount = !parallel ? 1 : (options.jobs ?? defaultJobCount(specs.length));
        const jobLimit = Math.max(1, Math.min(jobCount, specs.length));
        const progress = createProgressBar({
            total: specs.length,
            label: "Generating",
            stream: stderr,
            enabled: (options.progress ?? true) && stderr.isTTY === true,
        });

        const context: ToolContext = {
            projectRoot,
            directory,
            genArgv,
            naiveArgv,
            timeoutSeconds: options.config.generate.timeout,
            outputLimitBytes: defaultOutputLimitBytes,
            signal: options.signal,
            pendingFiles: new Set(),
        };

        const results: (GeneratedCase | undefined)[] = Array.from({ length: specs.length });
        let nextIndex = 0;
        let firstError: unknown;

        const worker = async (): Promise<void> => {
            while (firstError === undefined && options.signal?.aborted !== true) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= specs.length) {
                    return;
                }

                try {
                    results[index] = await generateCase(context, specs[index]!);
                    progress.advance();
                } catch (error) {
                    // Stop scheduling work, but let in-flight cases settle so
                    // their files are tracked before the cleanup runs.
                    firstError = error;
                    return;
                }
            }
        };

        try {
            await Promise.all(Array.from({ length: jobLimit }, () => worker()));
        } finally {
            progress.finish();
        }

        if (firstError !== undefined || options.signal?.aborted === true) {
            await Promise.all([...context.pendingFiles].map((path) => rm(path, { force: true })));
            if (firstError !== undefined && !(firstError instanceof GenerateInterruptedError)) {
                throw firstError;
            }
            throw new GenerateInterruptedError();
        }

        return {
            directory,
            cases: results.map((result) => result!),
        };
    } finally {
        await cleanupBuild(builtGen);
        if (builtNaive !== undefined) {
            await cleanupBuild(builtNaive);
        }
    }
}
