import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { parsePositiveInteger } from "@/feature/test";
import { loadConfig } from "@/lib/util/config";
import { GenerateInterruptedError, runGenerate, type GeneratedCase } from "@/lib/util/generate";
import { requireInitializedProject } from "@/lib/util/project";

export interface FormatGeneratedCasesOptions {
    inputOnly: boolean;
    /** List the base names instead of only the count above this many cases. */
    listLimit?: number;
}

/** The success message for a finished run. */
export function formatGeneratedCases(
    cases: readonly GeneratedCase[],
    options: FormatGeneratedCasesOptions,
): string {
    const listLimit = options.listLimit ?? 10;
    const noun = options.inputOnly ? "input file(s)" : "test case(s)";
    if (cases.length <= listLimit) {
        const names = cases.map((testCase) => testCase.baseName).join(", ");
        return `Created ${cases.length} ${noun}: ${names}.`;
    }

    return `Created ${cases.length} ${noun}.`;
}

export function createGenerateCommand(): Command {
    return new Command("generate")
        .alias("g")
        .description("Generate random test cases with a generator and a naive solution")
        .option("-i, --input", "Only create input files; do not run the naive solution")
        .option(
            "-c, --count <count>",
            "Number of test cases to generate (default: generate.count)",
            parsePositiveInteger,
        )
        .option("-J, --jobs <count>", "Number of cases to generate at once", parsePositiveInteger)
        .option("--no-parallel", "Generate one case at a time")
        .option("--cache", "Keep compiled binaries in .neoj/build and reuse them")
        .option("--no-cache", "Delete the build directory after the run")
        .option("--progress", "Draw the progress bar")
        .option("--no-progress", "Do not draw the progress bar")
        .action(async (options) => {
            const controller = new AbortController();
            const abort = () => controller.abort();
            process.on("SIGINT", abort);
            process.on("SIGTERM", abort);
            try {
                const projectRoot = await requireInitializedProject(process.cwd());
                const config = await loadConfig();
                const result = await runGenerate({
                    projectRoot,
                    config,
                    inputOnly: options.input,
                    count: options.count,
                    jobs: options.jobs,
                    parallel: options.parallel,
                    cache: options.cache,
                    progress: options.progress,
                    signal: controller.signal,
                    stderr: process.stderr,
                });
                consola.success(
                    formatGeneratedCases(result.cases, { inputOnly: options.input === true }),
                );
            } catch (error) {
                if (error instanceof GenerateInterruptedError) {
                    consola.warn(error.message);
                    process.exitCode = 130;
                } else {
                    consola.error(error instanceof Error ? error.message : String(error));
                    process.exitCode = 1;
                }
            } finally {
                process.removeListener("SIGINT", abort);
                process.removeListener("SIGTERM", abort);
            }
        });
}
