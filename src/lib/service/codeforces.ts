import { parse, type HTMLElement } from "node-html-parser";

import type { Problem, ProblemSample } from "@/lib/service/problem";
import { isTimeoutError } from "@/lib/util/errors";

const CODEFORCES_ORIGIN = "https://codeforces.com";
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "neoj (+https://github.com/e6nlaq/neoj)";

// Contest IDs are numeric. Problem indices are a letter optionally followed by
// a sub-index, such as "A", "F1", or "B2".
const CONTEST_ID_PATTERN = /^\d+$/u;
const PROBLEM_INDEX_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/u;

export type CodeforcesSample = ProblemSample;

export type CodeforcesProblem = Problem;

export class CodeforcesProblemRequestError extends Error {
    constructor(readonly status: number) {
        super(`Codeforces problem request failed (${status}).`);
        this.name = "CodeforcesProblemRequestError";
    }
}

/** Contest ID and uppercase problem index of a Codeforces problem URL. */
export interface CodeforcesProblemRoute {
    contestId: string;
    index: string;
}

function parseProblemRoute(segments: readonly string[]): CodeforcesProblemRoute {
    const [kind, second, third, fourth] = segments;
    const isContestPath = kind === "contest" && third === "problem" && segments.length === 4;
    const isProblemsetPath = kind === "problemset" && second === "problem" && segments.length === 4;

    const contestId = isContestPath ? second : isProblemsetPath ? third : undefined;
    const index = isContestPath || isProblemsetPath ? fourth : undefined;
    if (
        contestId === undefined ||
        index === undefined ||
        !CONTEST_ID_PATTERN.test(contestId) ||
        !PROBLEM_INDEX_PATTERN.test(index)
    ) {
        throw new TypeError("Expected a Codeforces problem URL.");
    }

    return { contestId, index: index.toUpperCase() };
}

/**
 * Parse one of the Codeforces problem URL forms:
 *
 * - `https://codeforces.com/contest/<contestId>/problem/<index>`
 * - `https://codeforces.com/problemset/problem/<contestId>/<index>`
 *
 * Gym, group, and mirror URLs require a login or a different origin, so they
 * are rejected instead of being fetched.
 */
export function parseCodeforcesProblemUrl(value: string): URL {
    const problemUrl = new URL(value);
    if (problemUrl.origin !== CODEFORCES_ORIGIN || problemUrl.username || problemUrl.password) {
        throw new TypeError("Expected a Codeforces problem URL.");
    }

    parseProblemRoute(problemUrl.pathname.split("/").filter((segment) => segment.length > 0));

    return problemUrl;
}

/** The contest ID and problem index of a validated Codeforces problem URL. */
export function extractCodeforcesProblemRoute(value: string | URL): CodeforcesProblemRoute {
    const problemUrl = parseCodeforcesProblemUrl(value.toString());
    return parseProblemRoute(
        problemUrl.pathname.split("/").filter((segment) => segment.length > 0),
    );
}

/** The contest page that published the problem. */
export function buildCodeforcesContestUrl(route: CodeforcesProblemRoute): URL {
    return new URL(`/contest/${route.contestId}`, CODEFORCES_ORIGIN);
}

/** The problem statement of the v1-style contest path, which serves the HTML. */
export function buildCodeforcesProblemUrl(route: CodeforcesProblemRoute): URL {
    return new URL(`/contest/${route.contestId}/problem/${route.index}`, CODEFORCES_ORIGIN);
}

/**
 * Read a sample `<pre>` as plain text.
 *
 * Codeforces sometimes wraps every input line in a
 * `<div class="test-example-line">` element without separators, in which case
 * each div is one line. Otherwise the `<pre>` is plain text.
 */
function readSamplePre(pre: HTMLElement): string {
    const wrappedLines = pre.querySelectorAll("div.test-example-line");
    if (wrappedLines.length > 0) {
        return wrappedLines.map((line) => line.textContent.replaceAll("\r\n", "\n")).join("\n");
    }

    return pre.textContent;
}

function parseSampleValue(
    container: HTMLElement,
    kind: "input" | "output",
    position: number,
): string {
    const pre = container.querySelector("pre");
    if (!pre) {
        throw new Error(`Codeforces sample ${position} ${kind} content was not found.`);
    }

    return readSamplePre(pre).trim().replaceAll("\r\n", "\n");
}

/** Strip the leading problem index from a title such as "B. Laura and Operations". */
export function stripCodeforcesTitleIndex(title: string): string {
    const match = title.trim().match(/^[A-Za-z][A-Za-z0-9]*\.\s*(.+)$/s);
    return match === null ? title.trim() : (match[1] ?? "").trim();
}

export function parseCodeforcesProblem(html: string, url: string): CodeforcesProblem {
    // Codeforces wraps sample input lines in `div.test-example-line` elements
    // inside the `<pre>`, but node-html-parser keeps `<pre>` content as raw
    // text by default. Empty block elements make the parser expose those divs
    // while entity decoding still applies.
    const document = parse(html, { blockTextElements: {} });
    const statement = document.querySelector(".problem-statement");
    if (!statement) {
        throw new Error(
            "Codeforces problem statement was not found in the response. The problem may require a login, which neoj does not support for Codeforces yet.",
        );
    }

    const titleElement = statement.querySelector(".header .title");
    const title =
        titleElement === undefined || titleElement === null
            ? undefined
            : stripCodeforcesTitleIndex(titleElement.textContent);
    if (!title) {
        throw new Error("Codeforces problem title was not found in the response.");
    }

    const inputs = [...document.querySelectorAll(".sample-test .input")];
    const outputs = [...document.querySelectorAll(".sample-test .output")];
    if (inputs.length !== outputs.length) {
        throw new Error(
            `Codeforces samples are malformed: ${inputs.length} input block(s) and ${outputs.length} output block(s).`,
        );
    }

    const samples = inputs.map((input, position) => {
        const output = outputs[position];
        if (output === undefined) {
            throw new Error(
                `Codeforces samples are malformed: sample ${position + 1} has no output block.`,
            );
        }
        return {
            input: parseSampleValue(input, "input", position + 1),
            output: parseSampleValue(output, "output", position + 1),
        };
    });

    return {
        url,
        title,
        samples,
    };
}

async function request(url: URL, init: RequestInit): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
        if (isTimeoutError(error)) {
            throw new Error(
                `Codeforces request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. Check your connection and try again.`,
                { cause: error },
            );
        }
        throw new Error("Failed to connect to Codeforces.", { cause: error });
    }
}

export class CodeforcesClient {
    /**
     * Fetch the problem page and parse the samples.
     *
     * Both URL forms are served from the same HTML, so the input URL is used
     * directly and preserved in the result so that `.neoj/problem.json` records
     * the URL the user downloaded.
     */
    async getProblem(url: string): Promise<CodeforcesProblem> {
        const problemUrl = parseCodeforcesProblemUrl(url);

        const response = await request(problemUrl, {
            headers: { "User-Agent": USER_AGENT },
            redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
            throw new Error(`Codeforces redirected the problem request (${response.status}).`);
        }
        if (!response.ok) {
            throw new CodeforcesProblemRequestError(response.status);
        }

        return parseCodeforcesProblem(await response.text(), problemUrl.href);
    }
}
