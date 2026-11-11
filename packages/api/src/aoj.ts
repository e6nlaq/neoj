import { parse, type HTMLElement } from "node-html-parser";

import { isTimeoutError } from "./errors.js";
import type { Problem, ProblemSample } from "./problem.js";
import { USER_AGENT } from "./user-agent.js";

/** The legacy (v1) site, which serves the problem statement HTML with samples. */
const AOJ_V1_ORIGIN = "https://judge.u-aizu.ac.jp";
/** The current (v2) site. Its problem pages are rendered client-side. */
const AOJ_V2_ORIGIN = "https://onlinejudge.u-aizu.ac.jp";
const REQUEST_TIMEOUT_MS = 15_000;

// Volume IDs such as "0001", course IDs such as "ALDS1_1_A", and contest IDs
// such as "JOI2010ho" all share this shape.
const PROBLEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;

export type AojSample = ProblemSample;

export type AojProblem = Problem;

export class AojProblemRequestError extends Error {
    constructor(readonly status: number) {
        super(`AOJ problem request failed (${status}).`);
        this.name = "AojProblemRequestError";
    }
}

/**
 * Validate a problem ID such as `ALDS1_1_A` or `0001`.
 *
 * The same ID is used by both the v1 `description.jsp` page and v2 URLs, so it
 * is also the slug that identifies the problem within `neoj`.
 */
export function parseAojProblemId(value: string): string {
    const id = value.trim();
    if (!PROBLEM_ID_PATTERN.test(id)) {
        throw new TypeError(`Expected an AOJ problem ID: "${value}".`);
    }

    return id;
}

function parseV1ProblemUrl(problemUrl: URL): URL {
    if (problemUrl.pathname !== "/onlinejudge/description.jsp") {
        throw new TypeError("Expected an AOJ problem URL.");
    }
    const id = problemUrl.searchParams.get("id");
    if (id === null) {
        throw new TypeError("Expected an AOJ problem URL with an id query parameter.");
    }
    parseAojProblemId(id);

    return problemUrl;
}

function parseV2ProblemPath(problemUrl: URL): URL {
    const segments = problemUrl.pathname.split("/").filter((segment) => segment.length > 0);
    // `/problems/<id>` and `/courses/lesson/<...path>/<id>`. The problem ID is
    // always the last segment.
    const isProblemPath =
        (segments[0] === "problems" && segments.length === 2) ||
        (segments[0] === "courses" &&
            segments[1] === "lesson" &&
            // lesson/<lessonNo>/<courseId>/<...>/<problemId>: the problem ID is
            // never the course level itself, so at least three segments follow
            // "lesson".
            segments.length >= 5);
    if (!isProblemPath) {
        throw new TypeError("Expected an AOJ problem URL.");
    }
    parseAojProblemId(segments[segments.length - 1] ?? "");

    return problemUrl;
}

/**
 * Parse one of the AOJ problem URL forms:
 *
 * - v1: `https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=<id>`
 * - v2: `https://onlinejudge.u-aizu.ac.jp/problems/<id>`
 * - v2 course: `https://onlinejudge.u-aizu.ac.jp/courses/lesson/<...>/<id>`
 */
export function parseAojProblemUrl(value: string): URL {
    const problemUrl = new URL(value);
    if (problemUrl.username || problemUrl.password) {
        throw new TypeError("Expected an AOJ problem URL.");
    }

    if (problemUrl.origin === AOJ_V1_ORIGIN) {
        return parseV1ProblemUrl(problemUrl);
    }
    if (problemUrl.origin === AOJ_V2_ORIGIN) {
        return parseV2ProblemPath(problemUrl);
    }

    throw new TypeError("Expected an AOJ problem URL.");
}

/** The problem ID of a validated AOJ problem URL. */
export function extractAojProblemId(value: string | URL): string {
    const problemUrl = parseAojProblemUrl(value.toString());
    const id =
        problemUrl.origin === AOJ_V1_ORIGIN
            ? (problemUrl.searchParams.get("id") ?? "")
            : (problemUrl.pathname
                  .split("/")
                  .filter((segment) => segment.length > 0)
                  .at(-1) ?? "");
    return parseAojProblemId(id);
}

/**
 * The page language for the v1 statement.
 *
 * AOJ URLs carry the language only on v1 (`lang=ja` / `lang=en`). Anything
 * other than `ja` falls back to `en`, which is the v1 default. Sample headings
 * are English on both language versions, so this only changes the title.
 */
export function resolveAojPageLanguage(problemUrl: URL): "ja" | "en" {
    return problemUrl.searchParams.get("lang")?.toLowerCase() === "ja" ? "ja" : "en";
}

/** The v1 statement URL that serves the HTML with the samples. */
export function buildAojDescriptionUrl(problemId: string, lang: "ja" | "en"): URL {
    const url = new URL("/onlinejudge/description.jsp", AOJ_V1_ORIGIN);
    url.searchParams.set("id", parseAojProblemId(problemId));
    url.searchParams.set("lang", lang);

    return url;
}

function parseSampleHeading(heading: HTMLElement):
    | {
          kind: "input" | "output";
          number: number;
      }
    | undefined {
    const match = heading.textContent.trim().match(/^(Sample Input|Sample Output)\s*(\d+)$/i);
    if (match === null) {
        return undefined;
    }

    return {
        kind:
            match[1] === undefined || match[1].toLowerCase() === "sample input"
                ? "input"
                : "output",
        number: Number(match[2]),
    };
}

export function parseAojProblem(html: string, url: string): AojProblem {
    const document = parse(html);
    const description = document.querySelector(".description");
    const title = description?.querySelector("h1")?.textContent.trim();
    if (description === null || !title) {
        throw new Error("AOJ problem title was not found in the response.");
    }

    const samples = new Map<number, Partial<AojSample>>();
    for (const heading of description.querySelectorAll("h2")) {
        const parsed = parseSampleHeading(heading);
        if (parsed === undefined) {
            continue;
        }

        const pre = heading.nextElementSibling;
        if (pre?.tagName.toLowerCase() !== "pre") {
            throw new Error(`AOJ sample ${parsed.number} content was not found.`);
        }

        const sample = samples.get(parsed.number) ?? {};
        const value = pre.textContent.trim().replaceAll("\r\n", "\n");
        if (parsed.kind === "input") {
            sample.input = value;
        } else {
            sample.output = value;
        }
        samples.set(parsed.number, sample);
    }

    const orderedSamples = [...samples.entries()].sort(([a], [b]) => a - b);
    const resultSamples = orderedSamples.map(([number, sample]) => {
        if (sample.input === undefined || sample.output === undefined) {
            throw new Error(`AOJ sample ${number} is missing its input or output.`);
        }
        return { input: sample.input, output: sample.output };
    });

    return {
        url,
        title,
        samples: resultSamples,
    };
}

async function request(url: URL, init: RequestInit): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
        if (isTimeoutError(error)) {
            throw new Error(
                `AOJ request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. Check your connection and try again.`,
                { cause: error },
            );
        }
        throw new Error("Failed to connect to AOJ.", { cause: error });
    }
}

export class AojClient {
    /**
     * Fetch the problem from the v1 statement page.
     *
     * The v2 site renders problem pages client-side, so the samples can only be
     * read from the v1 HTML. The input URL is preserved in the result so that
     * `.neoj/problem.json` records the URL the user downloaded.
     */
    async getProblem(url: string): Promise<AojProblem> {
        const problemUrl = parseAojProblemUrl(url);
        const descriptionUrl = buildAojDescriptionUrl(
            extractAojProblemId(problemUrl),
            resolveAojPageLanguage(problemUrl),
        );

        const response = await request(descriptionUrl, {
            headers: { "User-Agent": USER_AGENT },
            redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
            throw new Error(`AOJ redirected the problem request (${response.status}).`);
        }
        if (!response.ok) {
            throw new AojProblemRequestError(response.status);
        }

        return parseAojProblem(await response.text(), problemUrl.href);
    }
}
