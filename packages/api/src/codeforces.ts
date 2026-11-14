import { parse, type HTMLElement } from "node-html-parser";

import { isTimeoutError } from "./errors.js";
import type { Problem, ProblemSample } from "./problem.js";
import { USER_AGENT } from "./user-agent.js";

const CODEFORCES_ORIGIN = "https://codeforces.com";
// /settings/general redirects to /enter while unauthenticated, so it is a
// stable login check.
const LOGIN_CHECK_URL = `${CODEFORCES_ORIGIN}/settings/general`;
const REQUEST_TIMEOUT_MS = 15_000;
// Codeforces stores its anti-bot token in this evercookie and expects the
// value back as the `ftaa` form field.
const FTAA_COOKIE = "70a7c28f3de";
// A fingerprint hash the browser extension CCHv2 also sends; the server only
// checks that the field is present.
const DEFAULT_BFAA = "f1b3f18c715565b589b7823cda7448ce";
// Cookie-header-safe value: printable text without separators that would split
// the header or inject another cookie.
const COOKIE_VALUE_PATTERN = /^[^\s;,"\\]+$/u;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
// Codeforces answers automated clients with Cloudflare or its own RCPC/pow
// challenge instead of the requested page.
const BLOCKED_PAGE_PATTERNS: readonly RegExp[] = [
    /<title>\s*Just a moment\.\.\.\s*<\/title>/iu,
    /window\._cf_chl_opt/iu,
    /cf-chl-(?:captcha|widget|body)/iu,
    /Please wait\. Your browser is being checked/iu,
    /You are unable to access codeforces\.com/iu,
    /slowAES\.decrypt/iu,
];
const SAME_SOURCE_PATTERN = /You have submitted exactly the same code before/iu;
const SUBMITTED_PATTERN = /submitted successfully/iu;

// Contest IDs are numeric. Problem indices are a letter optionally followed by
// a sub-index, such as "A", "F1", or "B2".
const CONTEST_ID_PATTERN = /^\d+$/u;
const PROBLEM_INDEX_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/u;

/** One input/output pair from a Codeforces statement. */
export type CodeforcesSample = ProblemSample;

/** A Codeforces problem, with the URL that was passed to the client. */
export type CodeforcesProblem = Problem;

/** A non-2xx response from a Codeforces problem page. */
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

/** Parse a problem page into a title and its samples. */
export function parseCodeforcesProblem(html: string, url: string): CodeforcesProblem {
    // Codeforces wraps sample input lines in `div.test-example-line` elements
    // inside the `<pre>`, but node-html-parser keeps `<pre>` content as raw
    // text by default. Empty block elements make the parser expose those divs
    // while entity decoding still applies.
    const document = parse(html, { blockTextElements: {} });
    const statement = document.querySelector(".problem-statement");
    if (!statement) {
        throw new Error(
            "Codeforces problem statement was not found in the response. The problem may require a login; neoj downloads Codeforces problems without a session.",
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

/** Cookies that prove a Codeforces session. */
export interface CodeforcesSession {
    /** The `JSESSIONID` cookie value. */
    jsessionId: string;
    /** The `70a7c28f3de` cookie value, sent back as `ftaa`. */
    ftaa: string;
}

/** One selectable language on the Codeforces submit page. */
export interface CodeforcesLanguage {
    /** The value submitted as `programTypeId`. */
    id: string;
    /** The display name, with whitespace collapsed. */
    name: string;
}

/** The submission form, parsed once and reused for the POST. */
export interface CodeforcesSubmitPage {
    /** The contest that owns the problem. */
    contestId: string;
    /** The problem index, absent when only the language list was requested. */
    index: string | undefined;
    /** The form URL. */
    submitUrl: string;
    /** The hidden `csrf_token` value. */
    csrfToken: string;
    /** Other hidden inputs, such as `ftaa`, `bfaa`, and `_tta`. */
    hiddenFields: Readonly<Record<string, string>>;
    /** The selectable languages. */
    languages: CodeforcesLanguage[];
}

/** The submission created by {@link CodeforcesClient.submit}. */
export interface CodeforcesSubmissionResult {
    /** Missing when the submission succeeded but its ID could not be read. */
    submissionId: string | undefined;
    /** The submission page, or your submissions list when no ID was read. */
    submissionUrl: string;
}

/** Codeforces answered with a browser check instead of the requested page. */
export class CodeforcesBlockedError extends Error {
    constructor(readonly url: string) {
        super(
            `Codeforces returned a browser check instead of the page. Open ${url} in your browser, finish the check, then copy fresh JSESSIONID and ${FTAA_COOKIE} cookies and run "neoj login codeforces" again. If the check keeps appearing, submit from the browser.`,
        );
        this.name = "CodeforcesBlockedError";
    }
}

function normalizeCookieValue(name: string, value: string): string {
    const cookieValue = value.trim().replace(new RegExp(`^${name}=`, "iu"), "");
    if (cookieValue.length === 0) {
        throw new Error(`${name} cannot be empty.`);
    }
    if (!COOKIE_VALUE_PATTERN.test(cookieValue) || CONTROL_CHARACTER_PATTERN.test(cookieValue)) {
        throw new Error(`${name} contains invalid characters.`);
    }

    try {
        decodeURIComponent(cookieValue);
    } catch (error) {
        throw new Error(`${name} is not valid percent-encoding.`, { cause: error });
    }

    return cookieValue;
}

/** Trim and validate the two cookies, accepting a `name=value` pair for each. */
export function normalizeCodeforcesSession(session: CodeforcesSession): CodeforcesSession {
    return {
        jsessionId: normalizeCookieValue("JSESSIONID", session.jsessionId),
        ftaa: normalizeCookieValue(FTAA_COOKIE, session.ftaa),
    };
}

/** The signed-in account a Codeforces page reports. */
export interface CodeforcesAccount {
    /** The handle, when the page exposes it. */
    username: string | undefined;
    /** Whether the page contains the signed-in navigation. */
    signedIn: boolean;
}

/**
 * Read the signed-in handle from a Codeforces page.
 *
 * Signed-out pages link to "Register" and have no logout link. The `handle`
 * variable only appears on signed-in pages, so it is a secondary signal.
 */
export function parseCodeforcesAccount(html: string): CodeforcesAccount {
    const document = parse(html);
    let username: string | undefined;
    let signedIn = false;
    for (const anchor of document.querySelectorAll("a")) {
        const href = anchor.getAttribute("href")?.trim() ?? "";
        if (href.startsWith("/profile/")) {
            const name = anchor.textContent.trim();
            if (name !== "") {
                username ??= name;
            }
        }
        if (/(?:^|\/)logout(?:$|[?#])/u.test(href)) {
            signedIn = true;
        }
    }

    if (!signedIn) {
        const handle = /\bhandle\s*=\s*"([^"]*)"/u.exec(html)?.[1]?.trim();
        if (handle !== undefined && handle !== "") {
            username ??= handle;
            signedIn = true;
        }
    }

    return { username: signedIn ? username : undefined, signedIn };
}

/** Whether the response is a Cloudflare or RCPC browser check. */
export function isCodeforcesBlockedPage(html: string): boolean {
    return BLOCKED_PAGE_PATTERNS.some((pattern) => pattern.test(html));
}

/** The submission form URL for a problem. */
export function buildCodeforcesSubmitUrl(route: Pick<CodeforcesProblemRoute, "contestId">): URL {
    return new URL(`/contest/${route.contestId}/submit`, CODEFORCES_ORIGIN);
}

/** Your own submissions for the contest that published the problem. */
export function buildCodeforcesSubmissionsUrl(
    route: Pick<CodeforcesProblemRoute, "contestId">,
): URL {
    return new URL(`/contest/${route.contestId}/my`, CODEFORCES_ORIGIN);
}

/** Parse the submission form into its CSRF token, hidden fields, and languages. */
export function parseCodeforcesSubmitPage(
    html: string,
    submitUrl: string,
    route: Pick<CodeforcesProblemRoute, "contestId"> & { index?: string },
): CodeforcesSubmitPage {
    const document = parse(html);
    const languageSelect = document.querySelector('select[name="programTypeId"]');
    if (languageSelect === null) {
        throw new Error("Codeforces language list was not found in the submit page response.");
    }

    const form = languageSelect.closest("form");
    const csrfToken =
        form?.querySelector('input[name="csrf_token"]')?.getAttribute("value")?.trim() ??
        document.querySelector('meta[name="X-Csrf-Token"]')?.getAttribute("content")?.trim() ??
        /csrf\s*=\s*'([^']*)'/u.exec(html)?.[1]?.trim();
    if (csrfToken === undefined || csrfToken === "") {
        throw new Error(
            'Codeforces submit page did not contain a CSRF token. Log in again with "neoj login codeforces".',
        );
    }

    const hiddenFields: Record<string, string> = {};
    for (const input of form?.querySelectorAll('input[type="hidden"]') ?? []) {
        const name = input.getAttribute("name")?.trim();
        const value = input.getAttribute("value");
        if (name === undefined || name === "" || value === undefined || value === "") {
            continue;
        }
        hiddenFields[name] = value;
    }

    const languages: CodeforcesLanguage[] = [];
    for (const option of languageSelect.querySelectorAll("option")) {
        const id = option.getAttribute("value")?.trim();
        if (id === undefined || id === "") {
            continue;
        }
        languages.push({ id, name: option.textContent.trim().replace(/\s+/gu, " ") });
    }
    if (languages.length === 0) {
        throw new Error("Codeforces language list was empty in the submit page response.");
    }

    return {
        contestId: route.contestId,
        index: route.index,
        submitUrl,
        csrfToken,
        hiddenFields,
        languages,
    };
}

/** The message in the error banner of a rejected submission, when present. */
export function parseCodeforcesSubmissionError(html: string): string | undefined {
    const document = parse(html);
    for (const element of document.querySelectorAll("span.error, div.error, div.alert-error")) {
        const message = element.textContent.trim().replace(/\s+/gu, " ");
        if (message !== "") {
            return message;
        }
    }

    return undefined;
}

/**
 * Read the submission ID from your submissions page.
 *
 * The page lists the newest submission first; prefer the row whose problem
 * link matches the submitted index so a sidebar row cannot be mistaken for it.
 */
export function parseCodeforcesSubmissionId(
    html: string,
    route: Pick<CodeforcesProblemRoute, "contestId" | "index">,
): string | undefined {
    const document = parse(html);
    let fallback: string | undefined;
    for (const row of document.querySelectorAll("[data-submission-id]")) {
        const id = row.getAttribute("data-submission-id")?.trim();
        if (id === undefined || !/^\d+$/u.test(id)) {
            continue;
        }
        fallback ??= id;

        const problemHref = row.querySelector('a[href*="/problem/"]')?.getAttribute("href");
        if (problemHref === undefined || problemHref === null) {
            continue;
        }
        try {
            const pathname = new URL(problemHref, CODEFORCES_ORIGIN).pathname.toLowerCase();
            if (pathname.endsWith(`/problem/${route.index.toLowerCase()}`)) {
                return id;
            }
        } catch {
            // A malformed link only disqualifies this row.
        }
    }

    return fallback;
}

/**
 * Codeforces pages are served to signed-in clients only. `login()` keeps the
 * cookies for later calls; the problem fetch also works without them.
 */
export class CodeforcesClient {
    private currentSession: CodeforcesSession | undefined;
    private usernameValue: string | undefined;
    private submitPages = new Map<string, CodeforcesSubmitPage>();

    /** The account name reported by the last successful `login()`, when readable. */
    get username(): string | undefined {
        return this.usernameValue;
    }

    /** The cookies after the latest response, including any rotation. */
    get session(): CodeforcesSession | undefined {
        return this.currentSession === undefined ? undefined : { ...this.currentSession };
    }

    private createHeaders(extra?: Record<string, string>): Headers {
        const headers = new Headers(extra);
        headers.set("User-Agent", USER_AGENT);
        if (this.currentSession !== undefined) {
            headers.set(
                "Cookie",
                `JSESSIONID=${this.currentSession.jsessionId}; ${FTAA_COOKIE}=${this.currentSession.ftaa}`,
            );
        }

        return headers;
    }

    private async send(url: URL | string, init: RequestInit): Promise<Response> {
        const response = await request(new URL(url), init);
        this.updateCookies(response);
        return response;
    }

    private updateCookies(response: Response): void {
        if (this.currentSession === undefined) {
            return;
        }

        for (const header of getSetCookieValues(response.headers)) {
            const pair = header.split(";", 1)[0] ?? "";
            const separator = pair.indexOf("=");
            if (separator <= 0) {
                continue;
            }

            const name = pair.slice(0, separator).trim();
            const rawValue = pair.slice(separator + 1).trim();
            const value =
                rawValue.startsWith('"') && rawValue.endsWith('"')
                    ? rawValue.slice(1, -1)
                    : rawValue;
            if (
                !COOKIE_VALUE_PATTERN.test(value) ||
                CONTROL_CHARACTER_PATTERN.test(value) ||
                value.length === 0
            ) {
                continue;
            }

            if (name === "JSESSIONID") {
                this.currentSession.jsessionId = value;
            } else if (name === FTAA_COOKIE) {
                this.currentSession.ftaa = value;
            }
        }
    }

    private clearSession(): void {
        this.currentSession = undefined;
        this.usernameValue = undefined;
        this.submitPages.clear();
    }

    /**
     * Validate a saved session against `/settings/general` and keep it for
     * later requests. Returns `false` when Codeforces reports signed out; a
     * browser check throws {@link CodeforcesBlockedError} instead, because the
     * cookies may still be valid.
     */
    async login(session: CodeforcesSession): Promise<boolean> {
        this.currentSession = normalizeCodeforcesSession(session);
        this.usernameValue = undefined;
        this.submitPages.clear();

        const response = await this.send(LOGIN_CHECK_URL, {
            headers: this.createHeaders(),
            redirect: "manual",
        });
        if (isRedirect(response)) {
            this.clearSession();
            return false;
        }

        const html = await response.text();
        if (isCodeforcesBlockedPage(html)) {
            this.clearSession();
            throw new CodeforcesBlockedError(LOGIN_CHECK_URL);
        }
        if (!response.ok) {
            this.clearSession();
            return false;
        }

        const account = parseCodeforcesAccount(html);
        if (!account.signedIn) {
            this.clearSession();
            return false;
        }

        this.usernameValue = account.username;
        return true;
    }

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

    /** Fetch the submission form once and reuse it for the POST. */
    async getSubmitPage(url: string): Promise<CodeforcesSubmitPage> {
        const route = extractCodeforcesProblemRoute(url);
        const cacheKey = `${route.contestId}${route.index}`;
        const cached = this.submitPages.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        const submitUrl = buildCodeforcesSubmitUrl(route);
        const page = await this.fetchSubmitPage(submitUrl, route);
        this.submitPages.set(cacheKey, page);
        return page;
    }

    /** The languages the submission form accepts for `url`. */
    async getLanguages(url: string): Promise<CodeforcesLanguage[]> {
        return (await this.getSubmitPage(url)).languages;
    }

    /**
     * List the languages of a contest without a downloaded problem.
     *
     * Every contest renders the same language select, so a fallback contest ID
     * is enough when no Codeforces problem is recorded.
     */
    async getLanguagesForContest(contestId: string): Promise<CodeforcesLanguage[]> {
        if (!CONTEST_ID_PATTERN.test(contestId)) {
            throw new TypeError(`Invalid Codeforces contest ID: "${contestId}".`);
        }

        const page = await this.fetchSubmitPage(buildCodeforcesSubmitUrl({ contestId }), {
            contestId,
        });
        return page.languages;
    }

    /**
     * Submit `source` for the problem at `url`.
     *
     * Pass a cached form from `getSubmitPage()` to skip the extra request.
     */
    async submit(
        url: string,
        languageId: string,
        source: string,
        page?: CodeforcesSubmitPage,
    ): Promise<CodeforcesSubmissionResult> {
        const route = extractCodeforcesProblemRoute(url);
        const submitPage = page ?? (await this.getSubmitPage(url));
        if (!submitPage.languages.some((language) => language.id === languageId)) {
            throw new Error(
                `Codeforces does not recognize the language ID "${languageId}". Set a valid ID with "neoj languages codeforces", --platform-language, or languages.<key>.submit.codeforces.`,
            );
        }

        const submitUrl = new URL(submitPage.submitUrl);
        submitUrl.searchParams.set("csrf_token", submitPage.csrfToken);
        const headers = this.createHeaders({
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: submitPage.submitUrl,
        });
        let response = await this.send(submitUrl, {
            method: "POST",
            headers,
            body: buildSubmitBody(submitPage, route, languageId, source, this.currentSession),
            redirect: "manual",
        });

        // A successful post redirects to the contest's "my submissions" page;
        // read that page to find the confirmation and the new submission ID.
        const location = response.headers.get("Location");
        if (isRedirect(response) && location !== null) {
            const redirectUrl = new URL(location, submitUrl);
            if (redirectUrl.origin === CODEFORCES_ORIGIN) {
                response = await this.send(redirectUrl, {
                    headers: this.createHeaders({ Referer: submitUrl.href }),
                    redirect: "manual",
                });
            }
        }

        const html = await response.text();
        if (isCodeforcesBlockedPage(html)) {
            throw new CodeforcesBlockedError(submitPage.submitUrl);
        }
        if (isRedirect(response) || !response.ok) {
            throw new Error(`Codeforces submission failed (${response.status}).`);
        }

        const account = parseCodeforcesAccount(html);
        if (!account.signedIn) {
            throw new Error(
                'Codeforces rejected the submission because the session is not logged in. Run "neoj login codeforces" and try again.',
            );
        }
        if (SAME_SOURCE_PATTERN.test(html)) {
            throw new Error(
                "Codeforces rejected the submission because the same code was already submitted for this problem.",
            );
        }
        if (!SUBMITTED_PATTERN.test(html)) {
            const message = parseCodeforcesSubmissionError(html);
            throw new Error(
                message ??
                    `Codeforces did not confirm the submission. Open ${submitPage.submitUrl} in your browser and submit from there.`,
            );
        }

        const submissionId = parseCodeforcesSubmissionId(html, route);
        return {
            submissionId,
            submissionUrl:
                submissionId === undefined
                    ? buildCodeforcesSubmissionsUrl(route).href
                    : new URL(
                          `/contest/${route.contestId}/submission/${submissionId}`,
                          CODEFORCES_ORIGIN,
                      ).href,
        };
    }

    private async fetchSubmitPage(
        submitUrl: URL,
        route: Pick<CodeforcesProblemRoute, "contestId"> & { index?: string },
    ): Promise<CodeforcesSubmitPage> {
        const response = await this.send(submitUrl, {
            headers: this.createHeaders(),
            redirect: "manual",
        });
        if (isRedirect(response)) {
            throw new Error(
                `Codeforces redirected the submit page (${response.status}). Log in again with "neoj login codeforces".`,
            );
        }

        const html = await response.text();
        if (isCodeforcesBlockedPage(html)) {
            throw new CodeforcesBlockedError(submitUrl.href);
        }
        if (!response.ok) {
            throw new Error(`Codeforces submit page request failed (${response.status}).`);
        }
        if (!parseCodeforcesAccount(html).signedIn) {
            throw new Error(
                'Codeforces rejected the request because the session is not logged in. Run "neoj login codeforces" and try again.',
            );
        }

        return parseCodeforcesSubmitPage(html, submitUrl.href, route);
    }
}

function isRedirect(response: Response): boolean {
    return response.status >= 300 && response.status < 400;
}

function buildSubmitBody(
    page: CodeforcesSubmitPage,
    route: CodeforcesProblemRoute,
    languageId: string,
    source: string,
    session: CodeforcesSession | undefined,
): URLSearchParams {
    const fields = new URLSearchParams();
    for (const [name, value] of Object.entries(page.hiddenFields)) {
        fields.set(name, value);
    }

    // Hidden values win when the form sends them; the session cookie and the
    // browser-extension constant cover forms whose anti-bot fields are empty.
    fields.set("csrf_token", page.csrfToken);
    fields.set("action", "submitSolutionFormSubmitted");
    fields.set("ftaa", page.hiddenFields.ftaa ?? session?.ftaa ?? "");
    fields.set("bfaa", page.hiddenFields.bfaa ?? DEFAULT_BFAA);
    fields.set("submittedProblemIndex", route.index);
    fields.set("programTypeId", languageId);
    fields.set("contestId", route.contestId);
    fields.set("source", source);
    fields.set("sourceFile", "");
    fields.set("tabSize", "4");
    fields.set("sourceCodeConfirmed", "true");

    return fields;
}

function getSetCookieValues(headers: Headers): string[] {
    const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === "function") {
        return getSetCookie.call(headers);
    }

    const combined = headers.get("set-cookie");
    return combined === null ? [] : combined.split(/,(?=\s*[^;,=\s]+=)/u);
}
