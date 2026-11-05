import { parse } from "node-html-parser";

import type { Problem, ProblemSample } from "@/lib/service/problem";
import { isTimeoutError } from "@/lib/util/errors";

const ATCODER_ORIGIN = "https://atcoder.jp";
// /settings redirects to /login while unauthenticated, so it is a stable login check.
const LOGIN_CHECK_URL = `${ATCODER_ORIGIN}/settings`;
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "neoj (+https://github.com/e6nlaq/neoj)";
// Cookie-header-safe value: printable text without separators that would split
// the header or inject another cookie. Control characters are checked separately
// so the pattern stays free of literal control escapes.
const REVEL_SESSION_PATTERN = /^[^\s;,"\\]+$/;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

export type AtCoderSample = ProblemSample;

export interface AtCoderProblem extends Problem {
    samples: AtCoderSample[];
    startTime: Temporal.Instant;
    endTime: Temporal.Instant;
}

export class AtCoderProblemRequestError extends Error {
    constructor(readonly status: number) {
        super(`AtCoder problem request failed (${status}).`);
        this.name = "AtCoderProblemRequestError";
    }
}

function parseContestTime(value: string): Temporal.Instant {
    const isoValue = value.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    try {
        return Temporal.Instant.from(isoValue);
    } catch (error) {
        throw new Error("AtCoder contest start or end time is invalid.", { cause: error });
    }
}

export function normalizeRevelSession(value: string): string {
    const session = value.trim().replace(/^REVEL_SESSION=/i, "");
    if (session.length === 0) {
        throw new Error("REVEL_SESSION cannot be empty.");
    }
    if (!REVEL_SESSION_PATTERN.test(session) || CONTROL_CHARACTER_PATTERN.test(session)) {
        throw new Error("REVEL_SESSION contains invalid characters.");
    }

    try {
        decodeURIComponent(session);
    } catch (error) {
        throw new Error("REVEL_SESSION is not valid percent-encoding.", { cause: error });
    }

    return session;
}

export function parseAtCoderProblemUrl(value: string): URL {
    const problemUrl = new URL(value);
    if (
        problemUrl.origin !== ATCODER_ORIGIN ||
        !/^\/contests\/[^/]+\/tasks\/[^/]+\/?$/.test(problemUrl.pathname)
    ) {
        throw new TypeError("Expected an AtCoder contest task URL.");
    }

    return problemUrl;
}

function parseTaskPath(value: string): { contestId: string; taskId: string } {
    const problemUrl = parseAtCoderProblemUrl(value);
    const segments = problemUrl.pathname.split("/").filter((segment) => segment.length > 0);
    const contestId = segments[1];
    const taskId = segments[3];
    if (contestId === undefined || taskId === undefined) {
        throw new TypeError("Expected an AtCoder contest task URL.");
    }

    return { contestId, taskId };
}

export function buildAtCoderContestUrl(value: string): URL {
    const { contestId } = parseTaskPath(value);
    return new URL(`/contests/${contestId}`, ATCODER_ORIGIN);
}

export function buildAtCoderSubmissionsUrl(value: string): URL {
    const { contestId, taskId } = parseTaskPath(value);
    const submissionsUrl = new URL(`/contests/${contestId}/submissions/me`, ATCODER_ORIGIN);
    submissionsUrl.searchParams.set("f.Task", taskId);
    return submissionsUrl;
}

async function request(url: URL | string, init: RequestInit): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
        if (isTimeoutError(error)) {
            throw new Error(
                `AtCoder request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. Check your connection and try again.`,
                { cause: error },
            );
        }
        throw new Error("Failed to connect to AtCoder.", { cause: error });
    }
}

function parseProblem(html: string, url: string): AtCoderProblem {
    const document = parse(html);
    if (!document.querySelector("#task-statement")) {
        throw new Error("AtCoder problem statement was not found in the response.");
    }

    const title = document.querySelector("title")?.textContent.trim();
    if (!title) {
        throw new Error("AtCoder problem title was not found in the response.");
    }

    const contestTimes = document.querySelectorAll(".contest-duration time");
    const startTimeText = contestTimes[0]?.textContent.trim();
    const endTimeText = contestTimes[contestTimes.length - 1]?.textContent.trim();
    if (!startTimeText || !endTimeText) {
        throw new Error("AtCoder contest start and end times were not found in the response.");
    }

    const startTime = parseContestTime(startTimeText);
    const endTime = parseContestTime(endTimeText);

    const samples = new Map<number, Partial<AtCoderSample>>();
    for (const heading of document.querySelectorAll("h3")) {
        const match = heading.textContent
            .trim()
            .match(/^(入力例|出力例|Sample Input|Sample Output)\s*(\d+)$/i);
        if (!match) {
            continue;
        }

        const sampleNumber = Number(match[2]);
        const pre = heading.closest(".part")?.querySelector("pre");
        if (!pre) {
            throw new Error(`AtCoder sample ${sampleNumber} content was not found.`);
        }

        const sample = samples.get(sampleNumber) ?? {};
        const value = pre.textContent.trim().replaceAll("\r\n", "\n");
        if (/^(入力例|Sample Input)$/i.test(match[1] ?? "")) {
            sample.input = value;
        } else {
            sample.output = value;
        }
        samples.set(sampleNumber, sample);
    }

    const orderedSamples = [...samples.entries()].sort(([a], [b]) => a - b);
    const resultSamples = orderedSamples.map(([number, sample]) => {
        if (sample.input === undefined || sample.output === undefined) {
            throw new Error(`AtCoder sample ${number} is missing its input or output.`);
        }
        return { input: sample.input, output: sample.output };
    });

    return {
        url,
        title,
        samples: resultSamples,
        startTime,
        endTime,
    };
}

export class AtCoderClient {
    private session: string | undefined;
    private csrfTokenValue: string | undefined;

    get csrfToken(): string | undefined {
        return this.csrfTokenValue;
    }

    async login(revelSession: string): Promise<boolean> {
        const session = normalizeRevelSession(revelSession);
        const decodedSession = decodeURIComponent(session);
        const csrfToken = decodedSession.match(/(?:^|\0)csrf_token:([^\0]*)/i)?.[1];
        this.session = session;
        this.csrfTokenValue = csrfToken || undefined;

        // Unauthenticated requests to /settings redirect to /login, so a plain 200
        // means the session is valid. This does not detect a 200 sign-in page;
        // switch to a DOM marker if AtCoder changes that behavior.
        const response = await request(LOGIN_CHECK_URL, {
            headers: { Cookie: `REVEL_SESSION=${session}`, "User-Agent": USER_AGENT },
            redirect: "manual",
        });
        const redirected =
            response.redirected ||
            response.type === "opaqueredirect" ||
            (response.status >= 300 && response.status < 400);

        if (redirected || !response.ok) {
            this.session = undefined;
            this.csrfTokenValue = undefined;
            return false;
        }

        return true;
    }

    async getProblem(url: string): Promise<AtCoderProblem> {
        const problemUrl = parseAtCoderProblemUrl(url);

        const headers = new Headers();
        headers.set("User-Agent", USER_AGENT);
        if (this.session !== undefined) {
            headers.set("Cookie", `REVEL_SESSION=${this.session}`);
        }

        const response = await request(problemUrl, { headers, redirect: "manual" });
        if (response.status >= 300 && response.status < 400) {
            throw new Error(`AtCoder redirected the problem request (${response.status}).`);
        }
        if (!response.ok) {
            throw new AtCoderProblemRequestError(response.status);
        }

        const html = await response.text();
        return parseProblem(html, problemUrl.href);
    }
}
