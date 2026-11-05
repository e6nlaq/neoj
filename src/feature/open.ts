import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { findProblemSource } from "@/feature/problem-sources";
import { buildAtCoderContestUrl, buildAtCoderSubmissionsUrl } from "@/lib/service/atcoder";
import { buildYukicoderSubmissionsUrl, fetchYukicoderContestUrl } from "@/lib/service/yukicoder";
import { openInBrowser } from "@/lib/util/browser";
import { readProblemMetadata } from "@/lib/util/problem-metadata";
import { requireInitializedProject } from "@/lib/util/project";

export type OpenTarget = "problem" | "contest" | "submissions";

export interface OpenProblemOptions {
    openUrl?: (url: string) => Promise<boolean>;
    fetchContestUrl?: (problemUrl: string) => Promise<URL>;
}

export interface OpenProblemResult {
    target: OpenTarget;
    url: string;
    opened: boolean;
}

export async function resolveOpenUrl(
    target: OpenTarget,
    problemUrl: string,
    options: OpenProblemOptions = {},
): Promise<string> {
    const source = findProblemSource(problemUrl);
    if (target === "problem") {
        return new URL(problemUrl).href;
    }

    switch (source.name) {
        case "atcoder":
            return (
                target === "contest"
                    ? buildAtCoderContestUrl(problemUrl)
                    : buildAtCoderSubmissionsUrl(problemUrl)
            ).href;
        case "yukicoder":
            if (target === "submissions") {
                return buildYukicoderSubmissionsUrl(problemUrl).href;
            }
            return (await (options.fetchContestUrl ?? fetchYukicoderContestUrl)(problemUrl)).href;
        default:
            throw new TypeError(
                "Expected a problem URL from a supported platform (AtCoder, yukicoder).",
            );
    }
}

export async function openProblem(
    target: OpenTarget = "problem",
    options: OpenProblemOptions = {},
): Promise<OpenProblemResult> {
    const projectRoot = await requireInitializedProject(process.cwd());
    const metadata = await readProblemMetadata(projectRoot);
    if (metadata === undefined) {
        throw new Error('No problem is recorded. Run "neoj download <url>" first.');
    }

    const url = await resolveOpenUrl(target, metadata.url, options);
    const opened = await (options.openUrl ?? openInBrowser)(url);
    return { target, url, opened };
}

export function createOpenCommand(): Command {
    return new Command("open")
        .alias("o")
        .description("Open the current problem in the browser")
        .option("-c, --contest", "Open the contest page instead of the problem")
        .option("-s, --submissions", "Open your submissions for the current problem")
        .action(async (options) => {
            try {
                if (options.contest && options.submissions) {
                    throw new Error("--contest and --submissions cannot be used together.");
                }

                const target: OpenTarget = options.contest
                    ? "contest"
                    : options.submissions
                      ? "submissions"
                      : "problem";
                const result = await openProblem(target);
                if (!result.opened) {
                    consola.warn(
                        `Could not open the browser automatically. Open this URL manually: ${result.url}`,
                    );
                    process.exitCode = 1;
                    return;
                }

                consola.success(`Opened ${result.url}`);
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
