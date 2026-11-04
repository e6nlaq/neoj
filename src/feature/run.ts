import { Command } from "@commander-js/extra-typings";
import { consola, createConsola, LogLevels } from "consola";

import { loadConfig } from "@/lib/util/config";
import { requireInitializedProject } from "@/lib/util/project";
import { runProgram, splitRunArguments } from "@/lib/util/run-runner";
import { buildSolution, cleanupBuild } from "@/lib/util/test-runner";

export interface RunSolutionOptions {
    source?: string;
    programArgs: readonly string[];
    language?: string;
    cache?: boolean;
    silent?: boolean;
    /** Defaults to the process directory. */
    cwd?: string;
    /** Where neoj's own logs go; defaults to the process standard error. */
    stderr?: { write(chunk: string): unknown };
    /** How the program's streams are connected; defaults to `inherit`. */
    stdio?: "inherit" | "ignore";
}

export interface RunSolutionResult {
    /** The program's exit code, or `1` when a signal killed it. */
    exitCode: number;
}

/**
 * Build the solution and hand the terminal to it.
 *
 * Only informational logs go through `stderr`; the program writes its own
 * output directly. `silent` hides those logs but never hides errors.
 */
export async function runSolution(options: RunSolutionOptions): Promise<RunSolutionResult> {
    const cwd = options.cwd ?? process.cwd();
    const stderr = options.stderr ?? process.stderr;
    // neoj's own logs go through consola but stay on standard error, so the
    // program keeps standard output to itself. Consola only writes to the
    // stream it is given, so the capture stream used by tests is enough.
    const logStream = stderr as NodeJS.WriteStream;
    const logger = createConsola({
        stdout: logStream,
        stderr: logStream,
        // Show informational logs even when NODE_ENV=test lowers the default.
        level: LogLevels.info,
        defaults: { level: LogLevels.info },
    });
    const projectRoot = await requireInitializedProject(cwd);
    const config = await loadConfig();
    const silent = options.silent ?? config.run.silent;

    const built = await buildSolution({
        projectRoot,
        config,
        command: "run",
        cwd,
        source: options.source,
        language: options.language,
        cache: options.cache,
        onCompilerOutput: (chunk) => stderr.write(`${chunk}\n`),
        onCompiled: silent ? undefined : (line) => logger.success(line),
        onCached: silent ? undefined : (line) => logger.info(line),
    });

    try {
        const result = await runProgram({
            argv: [...built.runTokens, ...options.programArgs],
            cwd: built.projectRoot,
            stdio: options.stdio,
            onSignal: silent ? undefined : (message) => logger.warn(message),
        });
        return { exitCode: result.exitCode };
    } finally {
        await cleanupBuild(built);
    }
}

/** The user's arguments after the `run` command name or alias. */
function getUserArguments(parent: { args: string[] } | null): string[] {
    // The root command stops parsing at the subcommand, so its operands are the
    // command token followed by everything the user typed for this command.
    const rawArgs = parent?.args ?? [];
    return rawArgs.slice(1);
}

export function createRunCommand(): Command<[string | undefined, string[]]> {
    return new Command("run")
        .alias("r")
        .description("Build the solution and run it without tests")
        .argument("[source]", "Source file to run (defaults to test.source)")
        .argument("[args...]", "Arguments passed to the program")
        .option("-l, --language <key>", "Language definition to use")
        .option("--cache", "Keep compiled binaries in .neoj/build and reuse them")
        .option("--no-cache", "Delete the build directory after the run")
        .option("--silent", "Hide informational logs such as the compile result")
        .passThroughOptions()
        .action(async (_source, _args, options, command) => {
            try {
                const { source, programArgs } = splitRunArguments(getUserArguments(command.parent));
                const result = await runSolution({
                    source,
                    programArgs,
                    language: options.language,
                    cache: options.cache,
                    silent: options.silent,
                });
                process.exitCode = result.exitCode;
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
