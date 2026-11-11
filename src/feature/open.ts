import { Command } from "@commander-js/extra-typings";
import { buildAtCoderContestUrl, buildAtCoderSubmissionsUrl } from "@neoj/api/atcoder";
import { buildCodeforcesContestUrl, extractCodeforcesProblemRoute } from "@neoj/api/codeforces";
import {
    buildShareOjContestSubmissionsUrl,
    buildShareOjContestUrl,
    buildShareOjProblemSubmissionsUrl,
    extractShareOjShortId,
    parseShareOjContestProblemUrl,
} from "@neoj/api/shareoj";
import { buildYukicoderSubmissionsUrl, fetchYukicoderContestUrl } from "@neoj/api/yukicoder";
import { consola } from "consola";

import { findProblemSource } from "@/feature/problem-sources";
import { openInBrowser } from "@/lib/util/browser";
import { copyToClipboard } from "@/lib/util/clipboard";
import { readProblemMetadata } from "@/lib/util/problem-metadata";
import { requireInitializedProject } from "@/lib/util/project";

export type OpenTarget = "problem" | "contest" | "submissions";

export type OpenOutput = "browser" | "clipboard" | "url";

export interface OpenProblemOptions {
    openUrl?: (url: string) => Promise<boolean>;
    copyUrl?: (url: string) => Promise<boolean>;
    fetchContestUrl?: (problemUrl: string) => Promise<URL>;
}

export interface OpenProblemResult {
    target: OpenTarget;
    output: OpenOutput;
    url: string;
    completed: boolean;
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
        case "aoj":
            throw new TypeError(
                'AOJ does not support "neoj open --contest" or "neoj open --submissions" yet.',
            );
        case "shareoj": {
            try {
                const route = parseShareOjContestProblemUrl(problemUrl);
                if (target === "contest") {
                    return buildShareOjContestUrl(route.contestShortId).href;
                }
                return buildShareOjContestSubmissionsUrl(route.contestShortId, route.label).href;
            } catch {
                if (target === "contest") {
                    throw new TypeError(
                        'ShareOJ does not support "neoj open --contest" for a standalone problem URL.',
                    );
                }
                return buildShareOjProblemSubmissionsUrl(extractShareOjShortId(problemUrl)).href;
            }
        }
        case "codeforces":
            if (target === "submissions") {
                throw new TypeError('Codeforces does not support "neoj open --submissions" yet.');
            }
            return buildCodeforcesContestUrl(extractCodeforcesProblemRoute(problemUrl)).href;
        default:
            throw new TypeError(
                "Expected a problem URL from a supported platform (AtCoder, yukicoder, Aizu Online Judge, Codeforces, ShareOJ).",
            );
    }
}

export async function openProblem(
    target: OpenTarget = "problem",
    output: OpenOutput = "browser",
    options: OpenProblemOptions = {},
): Promise<OpenProblemResult> {
    const projectRoot = await requireInitializedProject(process.cwd());
    const metadata = await readProblemMetadata(projectRoot);
    if (metadata === undefined) {
        throw new Error('No problem is recorded. Run "neoj download <url>" first.');
    }

    const url = await resolveOpenUrl(target, metadata.url, options);
    const completed =
        output === "clipboard"
            ? await (options.copyUrl ?? copyToClipboard)(url)
            : output === "browser"
              ? await (options.openUrl ?? openInBrowser)(url)
              : true;
    return { target, output, url, completed };
}

export function createOpenCommand(): Command {
    return new Command("open")
        .alias("o")
        .description("Open the current problem in the browser")
        .option("-c, --contest", "Open the contest page instead of the problem")
        .option("-s, --submissions", "Open your submissions for the current problem")
        .option("--clip", "Copy the URL to the clipboard instead of opening it")
        .option("--url", "Print the URL instead of opening it")
        .action(async (options) => {
            try {
                if (options.contest && options.submissions) {
                    throw new Error("--contest and --submissions cannot be used together.");
                }
                if (options.clip && options.url) {
                    throw new Error("--clip and --url cannot be used together.");
                }

                const target: OpenTarget = options.contest
                    ? "contest"
                    : options.submissions
                      ? "submissions"
                      : "problem";
                const output: OpenOutput = options.clip
                    ? "clipboard"
                    : options.url
                      ? "url"
                      : "browser";
                const result = await openProblem(target, output);

                switch (output) {
                    case "url":
                        process.stdout.write(`${result.url}\n`);
                        return;
                    case "clipboard":
                        if (!result.completed) {
                            consola.error(`Could not copy the URL to the clipboard: ${result.url}`);
                            process.exitCode = 1;
                            return;
                        }
                        consola.success(`Copied ${result.url}`);
                        return;
                    case "browser":
                        if (!result.completed) {
                            consola.warn(
                                `Could not open the browser automatically. Open this URL manually: ${result.url}`,
                            );
                            process.exitCode = 1;
                            return;
                        }
                        consola.success(`Opened ${result.url}`);
                        return;
                }
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
