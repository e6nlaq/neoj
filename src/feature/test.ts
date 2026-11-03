import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { consola } from "consola";

import { loadConfig } from "@/lib/util/config";
import { requireInitializedProject } from "@/lib/util/project";
import { runTests } from "@/lib/util/test-runner";

function parsePositiveInteger(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new InvalidArgumentError(`Expected a positive integer, got "${value}".`);
    }

    return parsed;
}

function parsePositiveSeconds(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new InvalidArgumentError(`Expected a positive number of seconds, got "${value}".`);
    }

    return parsed;
}

export function createTestCommand(): Command<[string | undefined]> {
    return new Command("test")
        .alias("t")
        .description("Build the solution and run it against the sample tests")
        .argument("[source]", "Source file to test (defaults to test.source)")
        .option("-l, --language <key>", "Language definition to use")
        .option("-j, --jobs <count>", "Number of test cases to run at once", parsePositiveInteger)
        .option("--no-parallel", "Run the test cases one at a time")
        .option("-t, --timeout <seconds>", "Time limit per test case", parsePositiveSeconds)
        .option("-m, --memory <MiB>", "Memory limit per test case", parsePositiveInteger)
        .option("-f, --filter <name...>", "Only run the named test cases")
        .option("--cache", "Keep compiled binaries in .neoj/build and reuse them")
        .option("--no-cache", "Delete the build directory after the run")
        .option("-S, --ignore-trailing-space", "Ignore whitespace at the end of each output line")
        .option("--no-ignore-trailing-space", "Compare trailing whitespace strictly")
        .option("-N, --ignore-trailing-newline", "Ignore newlines at the end of the output")
        .option("--no-ignore-trailing-newline", "Compare trailing newlines strictly")
        .option("--progress", "Draw the progress bar")
        .option("--no-progress", "Do not draw the progress bar")
        .option("-v, --verbose", "Print input and output for passing cases too")
        .action(async (source, options) => {
            try {
                const projectRoot = await requireInitializedProject(process.cwd());
                const config = await loadConfig();
                const result = await runTests({
                    projectRoot,
                    config,
                    cwd: process.cwd(),
                    source,
                    language: options.language,
                    jobs: options.jobs,
                    parallel: options.parallel,
                    timeoutSeconds: options.timeout,
                    memoryMiB: options.memory,
                    filters: options.filter,
                    cache: options.cache,
                    ignoreTrailingSpace: options.ignoreTrailingSpace,
                    ignoreTrailingNewline: options.ignoreTrailingNewline,
                    progress: options.progress,
                    verbose: options.verbose,
                    stdout: process.stdout,
                    stderr: process.stderr,
                });
                process.exitCode = result.exitCode;
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
