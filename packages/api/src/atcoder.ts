import { parse } from "node-html-parser";

import { isTimeoutError } from "./errors.js";
import type { Problem, ProblemSample } from "./problem.js";
import { USER_AGENT } from "./user-agent.js";

const ATCODER_ORIGIN = "https://atcoder.jp";
// /settings redirects to /login while unauthenticated, so it is a stable login check.
const LOGIN_CHECK_URL = `${ATCODER_ORIGIN}/settings`;
const REQUEST_TIMEOUT_MS = 15_000;
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

/** One selectable language on the AtCoder submission form. */
export interface AtCoderLanguage {
    id: string;
    name: string;
    group: string | undefined;
}

/** The submission form, parsed once and reused for the POST. */
export interface AtCoderSubmitPage {
    contestId: string;
    taskId: string;
    submitUrl: string;
    csrfToken: string;
    taskScreenName: string;
    languages: AtCoderLanguage[];
    hasTurnstile: boolean;
}

export interface AtCoderSubmissionResult {
    /** Missing when the submission succeeded but its ID could not be read yet. */
    submissionId: string | undefined;
    submissionUrl: string;
}

const TURNSTILE_PATTERN = /cf-turnstile|turnstile/iu;

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
        problemUrl.username ||
        problemUrl.password ||
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

/** The submission form for the task, with the task preselected. */
export function buildAtCoderSubmitUrl(value: string): URL {
    const { contestId, taskId } = parseTaskPath(value);
    const submitUrl = new URL(`/contests/${contestId}/submit`, ATCODER_ORIGIN);
    submitUrl.searchParams.set("taskScreenName", taskId);
    return submitUrl;
}

/** Contest and task IDs of an AtCoder task URL. */
export function parseAtCoderTask(value: string): { contestId: string; taskId: string } {
    return parseTaskPath(value);
}

function parseLanguages(document: ReturnType<typeof parse>): AtCoderLanguage[] {
    const select =
        document.querySelector('select[name="data.LanguageId"]') ??
        document.querySelector('#select-lang[data-name="data.LanguageId"] select');
    if (!select) {
        throw new Error("AtCoder language list was not found in the submit page response.");
    }

    const languages: AtCoderLanguage[] = [];
    for (const option of select.querySelectorAll("option")) {
        const id = option.getAttribute("value")?.trim();
        if (id === undefined || id === "") {
            continue;
        }

        const group = option.closest("optgroup")?.getAttribute("label")?.trim();
        languages.push({
            id,
            name: option.textContent.trim().replace(/\s+/gu, " "),
            group: group === undefined || group === "" ? undefined : group,
        });
    }

    if (languages.length === 0) {
        throw new Error("AtCoder language list was empty in the submit page response.");
    }

    return languages;
}

/**
 * Parse the submission form.
 *
 * AtCoder puts the CSRF token and the task screen name in hidden inputs when
 * the form was opened for one task. The expected task ID is authoritative, so
 * a stale form cannot submit to a different task.
 */
export function parseAtCoderSubmitPage(
    html: string,
    submitUrl: string,
    task: { contestId: string; taskId: string },
): AtCoderSubmitPage {
    const document = parse(html);
    const csrfToken = document
        .querySelector('input[name="csrf_token"]')
        ?.getAttribute("value")
        ?.trim();
    if (csrfToken === undefined || csrfToken === "") {
        throw new Error(
            'AtCoder submit page did not contain a CSRF token. Log in again with "neoj login atcoder".',
        );
    }

    const hiddenTaskScreenName = document
        .querySelector('input[name="data.TaskScreenName"]')
        ?.getAttribute("value")
        ?.trim();
    const selectedTaskScreenName = [
        ...document.querySelectorAll('select[name="data.TaskScreenName"] option'),
    ]
        .find((option) => option.hasAttribute("selected"))
        ?.getAttribute("value")
        ?.trim();
    const taskScreenName =
        task.taskId !== ""
            ? task.taskId
            : (hiddenTaskScreenName ?? selectedTaskScreenName ?? task.taskId);
    if (taskScreenName === "") {
        throw new Error("AtCoder submit page did not contain the task screen name.");
    }

    return {
        contestId: task.contestId,
        taskId: task.taskId,
        submitUrl,
        csrfToken,
        taskScreenName,
        languages: parseLanguages(document),
        hasTurnstile: TURNSTILE_PATTERN.test(html),
    };
}

/** The newest submission link on a submissions page, when there is one. */
export function parseAtCoderLatestSubmission(html: string, contestId: string): string | undefined {
    const document = parse(html);
    const prefix = `/contests/${contestId}/submissions/`;
    for (const anchor of document.querySelectorAll("a[href]")) {
        const href = anchor.getAttribute("href") ?? "";
        if (!href.startsWith(prefix)) {
            continue;
        }

        const id = href.slice(prefix.length).replace(/\/$/u, "");
        if (/^\d+$/u.test(id)) {
            return id;
        }
    }

    return undefined;
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

function parseLocationSubmissionId(location: string, contestId: string): string | undefined {
    let pathname: string;
    try {
        pathname = new URL(location, ATCODER_ORIGIN).pathname;
    } catch {
        return undefined;
    }

    const prefix = `/contests/${contestId}/submissions/`;
    if (!pathname.startsWith(prefix)) {
        return undefined;
    }

    const id = pathname.slice(prefix.length).replace(/\/$/u, "");
    return /^\d+$/u.test(id) ? id : undefined;
}

export class AtCoderClient {
    private session: string | undefined;
    private csrfTokenValue: string | undefined;
    private submitPages = new Map<string, AtCoderSubmitPage>();

    get csrfToken(): string | undefined {
        return this.csrfTokenValue;
    }

    private createHeaders(): Headers {
        const headers = new Headers();
        headers.set("User-Agent", USER_AGENT);
        if (this.session !== undefined) {
            headers.set("Cookie", `REVEL_SESSION=${this.session}`);
        }

        return headers;
    }

    async login(revelSession: string): Promise<boolean> {
        const session = normalizeRevelSession(revelSession);
        const decodedSession = decodeURIComponent(session);
        const csrfToken = decodedSession.match(/(?:^|\0)csrf_token:([^\0]*)/i)?.[1];
        this.session = session;
        this.csrfTokenValue = csrfToken || undefined;
        this.submitPages.clear();

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
            this.submitPages.clear();
            return false;
        }

        return true;
    }

    async getProblem(url: string): Promise<AtCoderProblem> {
        const problemUrl = parseAtCoderProblemUrl(url);

        const response = await request(problemUrl, {
            headers: this.createHeaders(),
            redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
            throw new Error(`AtCoder redirected the problem request (${response.status}).`);
        }
        if (!response.ok) {
            throw new AtCoderProblemRequestError(response.status);
        }

        const html = await response.text();
        return parseProblem(html, problemUrl.href);
    }

    /** Fetch the submission form once and reuse it for the POST. */
    async getSubmitPage(url: string): Promise<AtCoderSubmitPage> {
        const cached = this.submitPages.get(url);
        if (cached !== undefined) {
            return cached;
        }

        const task = parseTaskPath(url);
        const submitUrl = buildAtCoderSubmitUrl(url);
        const response = await request(submitUrl, {
            headers: this.createHeaders(),
            redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
            throw new Error(
                `AtCoder redirected the submit page (${response.status}). Log in again with "neoj login atcoder".`,
            );
        }
        if (!response.ok) {
            throw new Error(`AtCoder submit page request failed (${response.status}).`);
        }

        const page = parseAtCoderSubmitPage(await response.text(), submitUrl.href, task);
        this.submitPages.set(url, page);
        return page;
    }

    async getLanguages(url: string): Promise<AtCoderLanguage[]> {
        return (await this.getSubmitPage(url)).languages;
    }

    /**
     * List the languages of a contest without a task.
     *
     * The submit page for a contest shows the same language select even when no
     * task is preselected, so this works without a downloaded problem.
     */
    async getLanguagesForContest(contestId: string): Promise<AtCoderLanguage[]> {
        if (!/^[\w-]+$/u.test(contestId)) {
            throw new TypeError(`Invalid AtCoder contest ID: "${contestId}".`);
        }

        const submitUrl = new URL(`/contests/${contestId}/submit`, ATCODER_ORIGIN);
        const response = await request(submitUrl, {
            headers: this.createHeaders(),
            redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
            throw new Error(
                `AtCoder redirected the submit page (${response.status}). Log in again with "neoj login atcoder".`,
            );
        }
        if (!response.ok) {
            throw new Error(`AtCoder submit page request failed (${response.status}).`);
        }

        return parseLanguages(parse(await response.text()));
    }

    async submit(
        url: string,
        languageId: string,
        source: string,
        page?: AtCoderSubmitPage,
    ): Promise<AtCoderSubmissionResult> {
        const task = parseTaskPath(url);
        const submitPage = page ?? (await this.getSubmitPage(url));
        if (!submitPage.languages.some((language) => language.id === languageId)) {
            throw new Error(
                `AtCoder does not recognize the language ID "${languageId}". Set a valid ID with "neoj languages atcoder", --platform-language, or languages.<key>.submit.atcoder.`,
            );
        }

        const body = new URLSearchParams({
            csrf_token: submitPage.csrfToken,
            "data.TaskScreenName": submitPage.taskScreenName,
            "data.LanguageId": languageId,
            sourceCode: source,
        });
        const headers = this.createHeaders();
        headers.set("Content-Type", "application/x-www-form-urlencoded");

        const response = await request(submitPage.submitUrl, {
            method: "POST",
            headers,
            body,
            redirect: "manual",
        });

        const submissionsUrl = buildAtCoderSubmissionsUrl(url);
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("Location") ?? "";
            if (location.includes("/login")) {
                throw new Error(
                    'AtCoder rejected the submission because the session is not logged in. Run "neoj login atcoder" and try again.',
                );
            }

            const directId = parseLocationSubmissionId(location, task.contestId);
            if (directId !== undefined) {
                return {
                    submissionId: directId,
                    submissionUrl: new URL(
                        `/contests/${task.contestId}/submissions/${directId}`,
                        ATCODER_ORIGIN,
                    ).href,
                };
            }

            return (
                (await this.findLatestSubmission(task.contestId, submissionsUrl)) ?? {
                    submissionId: undefined,
                    submissionUrl: submissionsUrl.href,
                }
            );
        }

        if (!response.ok) {
            throw new Error(`AtCoder submission failed (${response.status}).`);
        }

        const html = await response.text();
        if (TURNSTILE_PATTERN.test(html)) {
            throw new Error(
                `AtCoder rejected the submission because of Turnstile. Open ${submitPage.submitUrl} in your browser and submit from there.`,
            );
        }

        throw new Error(
            `AtCoder rejected the submission. Open ${submitPage.submitUrl} in your browser and submit from there.`,
        );
    }

    private async findLatestSubmission(
        contestId: string,
        submissionsUrl: URL,
    ): Promise<AtCoderSubmissionResult | undefined> {
        const response = await request(submissionsUrl, {
            headers: this.createHeaders(),
            redirect: "manual",
        });
        if (!response.ok) {
            return undefined;
        }

        const submissionId = parseAtCoderLatestSubmission(await response.text(), contestId);
        if (submissionId === undefined) {
            return undefined;
        }

        return {
            submissionId,
            submissionUrl: new URL(
                `/contests/${contestId}/submissions/${submissionId}`,
                ATCODER_ORIGIN,
            ).href,
        };
    }
}
