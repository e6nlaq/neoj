import { isTimeoutError } from "./errors.js";
import type { Problem, ProblemSample } from "./problem.js";
import { USER_AGENT } from "./user-agent.js";

/** The public API origin, documented at https://www.share-oj.net/docs/api. */
const API_ORIGIN = "https://api.share-oj.net";
/** The site origin that serves problem pages with the 22-character IDs. */
const SITE_ORIGIN = "https://www.share-oj.net";
const REQUEST_TIMEOUT_MS = 15_000;

/** UUIDs as used by the public API. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** The 22-character base62 short IDs carried by the site page URLs. */
const SHORT_ID_PATTERN = /^[0-9A-Za-z]{22}$/u;

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Convert the 22-character base62 site short ID into the UUID used by the API.
 *
 * This mirrors the site's own `web/shared/utils/short-id.ts` conversion. The
 * result must still look like a UUID so that malformed input is rejected.
 */
export function decodeShareOjShortId(shortId: string): string {
    if (!SHORT_ID_PATTERN.test(shortId)) {
        throw new TypeError(`Expected a ShareOJ ID: "${shortId}".`);
    }

    let value = 0n;
    for (const character of shortId) {
        value = value * 62n + BigInt(BASE62_ALPHABET.indexOf(character));
    }

    const hex = value.toString(16).padStart(32, "0");
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    if (!UUID_PATTERN.test(uuid)) {
        throw new TypeError(`Expected a ShareOJ ID: "${shortId}".`);
    }

    return uuid;
}

/** Convert the API UUID back into the 22-character site short ID. */
export function encodeShareOjShortId(uuid: string): string {
    if (!UUID_PATTERN.test(uuid)) {
        throw new TypeError(`Expected a ShareOJ problem UUID: "${uuid}".`);
    }

    let value = BigInt(`0x${uuid.replaceAll("-", "")}`);
    const base = 62n;
    let out = "";
    for (let index = 0; index < 22; index++) {
        out = BASE62_ALPHABET[Number(value % base)] + out;
        value /= base;
    }

    return out;
}

/** Validate and normalize a UUID string taken from user input. */
export function parseShareOjUuid(value: string): string {
    const uuid = value.trim();
    if (!UUID_PATTERN.test(uuid)) {
        throw new TypeError(`Expected a ShareOJ UUID: "${value}".`);
    }

    return uuid;
}

/**
 * Parse one of the accepted problem identifiers:
 *
 * - site URL: `https://www.share-oj.net/problems/<22-char base62 ID>`
 * - bare UUID: `02515831-bafa-45f1-8ab7-ff8ffd7b5c13`
 * - bare short ID: `04N9rxR9eGNCjAvBNfjU8Z`
 *
 * The normalized result is the API UUID.
 */
export function parseShareOjProblemId(value: string): string {
    const trimmed = value.trim();
    if (UUID_PATTERN.test(trimmed)) {
        return parseShareOjUuid(trimmed);
    }
    if (SHORT_ID_PATTERN.test(trimmed)) {
        return decodeShareOjShortId(trimmed);
    }

    return decodeShareOjShortId(extractShareOjShortId(trimmed));
}

/** Parse and validate a ShareOJ problem page URL. */
export function parseShareOjProblemUrl(value: string): URL {
    const problemUrl = parseShareOjSiteUrl(value);

    const segments = problemUrl.pathname.split("/").filter((segment) => segment.length > 0);
    if (segments.length !== 2 || segments[0] !== "problems") {
        throw new TypeError(`Expected a ShareOJ problem URL: "${value}".`);
    }
    decodeShareOjShortId(segments[1] ?? "");

    return problemUrl;
}

function parseShareOjSiteUrl(value: string): URL {
    let problemUrl: URL;
    try {
        problemUrl = new URL(value);
    } catch {
        throw new TypeError(`Expected a ShareOJ problem URL: "${value}".`);
    }
    if (problemUrl.username || problemUrl.password || problemUrl.origin !== SITE_ORIGIN) {
        throw new TypeError(`Expected a ShareOJ problem URL: "${value}".`);
    }

    return problemUrl;
}

// A, B, ..., Z, AA, AB, ... in contest order, mirroring the site's own labeling.
const CONTEST_PROBLEM_LABEL_PATTERN = /^[A-Z]{1,3}$/u;

/** The zero-based contest order of a problem label; the inverse of `encodeShareOjProblemLabel`. */
export function parseShareOjProblemLabel(label: string): number {
    if (!CONTEST_PROBLEM_LABEL_PATTERN.test(label)) {
        throw new TypeError(`Expected a ShareOJ contest problem label: "${label}".`);
    }

    let index = 0;
    for (const character of label) {
        index = index * 26 + (character.charCodeAt(0) - 64);
    }

    return index - 1;
}

/** The contest problem label of a zero-based contest order, `A, B, ..., Z, AA, AB, ...`. */
export function encodeShareOjProblemLabel(index: number): string {
    if (!Number.isInteger(index) || index < 0) {
        throw new TypeError(`Expected a non-negative contest problem index: "${index}".`);
    }

    return index < 26
        ? String.fromCharCode(65 + index)
        : encodeShareOjProblemLabel(Math.floor(index / 26) - 1) +
              encodeShareOjProblemLabel(index % 26);
}

export interface ShareOjContestProblemRoute {
    /** The validated 22-character site short ID of the contest. */
    contestShortId: string;
    label: string;
}

/** Parse and validate a ShareOJ contest problem URL (`/contests/<id>/<label>`). */
export function parseShareOjContestProblemUrl(value: string): ShareOjContestProblemRoute {
    const contestUrl = parseShareOjSiteUrl(value);
    const segments = contestUrl.pathname.split("/").filter((segment) => segment.length > 0);
    if (segments.length !== 3 || segments[0] !== "contests") {
        throw new TypeError(`Expected a ShareOJ contest problem URL: "${value}".`);
    }
    decodeShareOjShortId(segments[1] ?? "");
    parseShareOjProblemLabel(segments[2] ?? "");

    return { contestShortId: segments[1] ?? "", label: segments[2] ?? "" };
}

/** The contest page of a contest problem's contest. */
export function buildShareOjContestUrl(contestShortId: string): URL {
    return new URL(`/contests/${contestShortId}`, SITE_ORIGIN);
}

/** The problem's own submissions view, which needs a login. */
export function buildShareOjProblemSubmissionsUrl(shortId: string): URL {
    const url = new URL(`/problems/${shortId}`, SITE_ORIGIN);
    url.searchParams.set("view", "my-submissions");

    return url;
}

/** The contest's submissions list narrowed to one problem label, for the current user. */
export function buildShareOjContestSubmissionsUrl(contestShortId: string, label: string): URL {
    const url = new URL(`/contests/${contestShortId}`, SITE_ORIGIN);
    url.searchParams.set("view", "my-submissions");
    url.searchParams.set("problem", label);

    return url;
}

/** The validated 22-character site short ID of a ShareOJ problem URL. */
export function extractShareOjShortId(value: string | URL): string {
    const problemUrl = parseShareOjProblemUrl(value.toString());

    // `parseShareOjProblemUrl` validated the segment, so it can be reused as is.
    return problemUrl.pathname.split("/").filter((segment) => segment.length > 0)[1] ?? "";
}

interface ShareOjProblemDetail {
    title?: string;
}

interface ShareOjDownload {
    url?: string;
    size?: number;
    sha256?: string;
}

interface RawShareOjSample {
    name?: string;
    input?: string;
    output?: string;
    inputFile?: ShareOjDownload;
    outputFile?: ShareOjDownload;
}

/** One sample, with the inline input/output text resolved. */
export type ShareOjResolvedSample = ProblemSample;

export type ShareOjProblem = Problem;

export class ShareOjSampleDownloadError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "ShareOjSampleDownloadError";
    }
}

async function request(url: URL, init: RequestInit): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
        if (isTimeoutError(error)) {
            throw new Error(
                `ShareOJ request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. Check your connection and try again.`,
                { cause: error },
            );
        }
        throw new Error("Failed to connect to ShareOJ.", { cause: error });
    }
}

async function requestJson<T>(url: URL, errorMessage: string): Promise<T> {
    const response = await request(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!response.ok) {
        throw await parseErrorResponse(response);
    }

    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) {
        throw new Error(errorMessage);
    }

    return body as T;
}

/**
 * Resolve the text of one side (input or output) of a sample.
 *
 * A sample side is either inline text or a file reference. When a file is
 * referenced, the inline text is an empty placeholder (the site's own editor
 * and generator write `""` there), so the file is authoritative. The download
 * is validated against the reported size and SHA-256 hash before it is used.
 */
async function resolveSampleText(
    inline: string | undefined,
    file: ShareOjDownload | undefined,
    label: string,
    sampleName: string,
): Promise<string> {
    if (file?.url === undefined) {
        if (typeof inline === "string") {
            return inline;
        }
        throw new Error(`ShareOJ sample "${sampleName}" is missing its ${label}.`);
    }

    // The URL comes from the API, but only an HTTPS download is accepted.
    let fileUrl: URL;
    try {
        fileUrl = new URL(file.url);
    } catch {
        throw new ShareOjSampleDownloadError(
            `The ${label} of ShareOJ sample "${sampleName}" has an invalid download URL.`,
        );
    }
    if (fileUrl.protocol !== "https:") {
        throw new ShareOjSampleDownloadError(
            `The ${label} of ShareOJ sample "${sampleName}" has a non-HTTPS download URL.`,
        );
    }

    const response = await request(fileUrl, {
        headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
        throw new ShareOjSampleDownloadError(
            `Downloading the ${label} of ShareOJ sample "${sampleName}" failed (${response.status}).`,
        );
    }

    // Compare the raw bytes: a text length counts UTF-16 units, and decoding
    // and re-encoding would not reproduce the original file byte for byte.
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (file.size !== undefined && bytes.byteLength !== file.size) {
        throw new ShareOjSampleDownloadError(
            `The downloaded ${label} of ShareOJ sample "${sampleName}" has an unexpected size (${bytes.byteLength}, expected ${file.size}).`,
        );
    }

    if (file.sha256 !== undefined) {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const hash = [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        if (hash !== file.sha256) {
            throw new ShareOjSampleDownloadError(
                `The downloaded ${label} of ShareOJ sample "${sampleName}" does not match its SHA-256 hash.`,
            );
        }
    }

    return new TextDecoder().decode(bytes);
}

function normalizeSampleText(value: string): string {
    return value.replaceAll("\r\n", "\n").replace(/\n$/u, "");
}

export class ShareOjApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string | undefined,
    ) {
        super(
            code === undefined
                ? `ShareOJ request failed (${status}).`
                : `ShareOJ request failed (${status}, "${code}").`,
        );
        this.name = "ShareOjApiError";
    }
}

/** Tokens returned by `/auth/login`, `/auth/challenge`, and `/auth/refresh`. */
export interface ShareOjTokens {
    accessToken: string;
    /** Long-lived; absent when the server did not return one. */
    refreshToken?: string;
    /** Absolute expiry instant of the access token, when reported. */
    expiresAt?: Temporal.Instant;
}

interface RawAuthResult {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    challenge_name?: string;
    session?: string;
    challenge_parameters?: Record<string, string>;
}

/** A Cognito-style login challenge that must be continued with `/auth/challenge`. */
export interface ShareOjChallenge {
    name: string;
    session: string;
    parameters: Record<string, string>;
}

export interface ShareOjRuntime {
    id: string;
    label: string;
}

export interface ShareOjSubmissionRequest {
    problemId: string;
    /** Set when the problem belongs to a contest and the user participates. */
    contestId?: string;
    runtime: string;
    source: string;
}

export interface ShareOjSubmission {
    id: string;
}

/** Map a non-2xx API response with a JSON error body into `ShareOjApiError`. */
async function parseErrorResponse(response: Response): Promise<ShareOjApiError> {
    let code: string | undefined;
    try {
        const body: unknown = await response.json();
        if (
            typeof body === "object" &&
            body !== null &&
            typeof (body as { error?: unknown }).error === "string"
        ) {
            code = (body as { error: string }).error;
        }
    } catch {
        // A non-JSON body still yields a status-only error.
    }

    return new ShareOjApiError(response.status, code);
}

async function parseAuthResult(
    response: Response,
    refreshToken: string | undefined,
): Promise<ShareOjTokens | ShareOjChallenge> {
    if (!response.ok) {
        throw await parseErrorResponse(response);
    }

    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) {
        throw new Error("ShareOJ login response was malformed.");
    }
    const raw = body as RawAuthResult;
    if (typeof raw.challenge_name === "string" && typeof raw.session === "string") {
        return {
            name: raw.challenge_name,
            session: raw.session,
            parameters: raw.challenge_parameters ?? {},
        };
    }
    if (typeof raw.access_token !== "string" || raw.access_token === "") {
        throw new Error("ShareOJ login did not return an access token.");
    }

    return {
        accessToken: raw.access_token,
        refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : refreshToken,
        expiresAt:
            typeof raw.expires_in === "number"
                ? Temporal.Now.instant().add({ seconds: raw.expires_in })
                : undefined,
    };
}

/**
 * Post a JSON body to an authenticated endpoint. Returns the parsed body and
 * throws `ShareOjApiError` on a non-2xx response.
 */
async function requestAuthJson(
    url: URL,
    token: string,
    init: RequestInit & { body: string },
): Promise<unknown> {
    const response = await request(url, {
        ...init,
        headers: {
            ...init.headers,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        throw await parseErrorResponse(response);
    }

    return response.json();
}

/** The submission page displayed after a successful submission. */
export function buildShareOjSubmissionUrl(submissionUuid: string, contestShortId?: string): string {
    const id = encodeShareOjShortId(submissionUuid);
    return contestShortId === undefined
        ? `${SITE_ORIGIN}/my/submissions/${id}`
        : `${SITE_ORIGIN}/contests/${contestShortId}/my-submissions/${id}`;
}

interface ShareOjContestProblems {
    problems?: Array<{ id?: string } | undefined> | null;
}

interface ResolvedProblem {
    /** The API UUID of the problem itself. */
    problemId: string;
    title: string;
}

export class ShareOjClient {
    /**
     * Resolve a direct problem identifier or a contest problem URL into the
     * API UUID and title of the underlying problem.
     */
    private async resolveProblem(url: string): Promise<ResolvedProblem> {
        let contestRoute: ShareOjContestProblemRoute;
        try {
            contestRoute = parseShareOjContestProblemUrl(url);
        } catch {
            // Not a contest problem URL; fall back to a direct problem.
            const uuid = parseShareOjProblemId(url);
            return {
                problemId: uuid,
                title: await this.fetchProblemTitle(uuid, `/problems/${uuid}`),
            };
        }

        const contestId = decodeShareOjShortId(contestRoute.contestShortId);
        const index = parseShareOjProblemLabel(contestRoute.label);
        const contest = await requestJson<ShareOjContestProblems>(
            new URL(`/contests/${contestId}`, API_ORIGIN),
            "ShareOJ contest response was malformed.",
        );
        const contestProblems = Array.isArray(contest.problems) ? contest.problems : [];
        const contestProblem = contestProblems[index];
        const problemId = typeof contestProblem?.id === "string" ? contestProblem.id : undefined;
        if (problemId === undefined) {
            throw new Error(
                `ShareOJ contest problem "${contestRoute.label}" could not be resolved. The contest may not have started yet, or the problem is not visible without logging in.`,
            );
        }

        return {
            problemId,
            title: await this.fetchProblemTitle(
                problemId,
                `/contests/${contestId}/problems/${problemId}`,
            ),
        };
    }

    private async fetchProblemTitle(problemId: string, apiPath: string): Promise<string> {
        const detail = await requestJson<ShareOjProblemDetail>(
            new URL(apiPath, API_ORIGIN),
            "ShareOJ problem response was malformed.",
        );
        const title = typeof detail.title === "string" ? detail.title : undefined;
        if (!title) {
            throw new Error("ShareOJ problem title was not found in the response.");
        }

        return title;
    }

    /**
     * Fetch the problem detail and its public samples from the official API.
     *
     * The input URL is preserved in the result so that `.neoj/problem.json`
     * records the URL the user downloaded. The `key` field carries the stable
     * problem key, because a contest problem URL cannot be mapped to one
     * synchronously.
     */
    async getProblem(url: string): Promise<ShareOjProblem> {
        const { problemId, title } = await this.resolveProblem(url);

        const samplesResponse = await requestJson<{ items?: RawShareOjSample[] }>(
            new URL(`/problems/${problemId}/samples`, API_ORIGIN),
            "ShareOJ samples response was malformed.",
        );
        const rawSamples = Array.isArray(samplesResponse.items) ? samplesResponse.items : [];

        const samples = await Promise.all(
            rawSamples.map(async (raw, index): Promise<ShareOjResolvedSample> => {
                const sampleName = typeof raw.name === "string" ? raw.name : `#${index + 1}`;
                return {
                    input: normalizeSampleText(
                        await resolveSampleText(raw.input, raw.inputFile, "input", sampleName),
                    ),
                    output: normalizeSampleText(
                        await resolveSampleText(raw.output, raw.outputFile, "output", sampleName),
                    ),
                };
            }),
        );

        return {
            url,
            title,
            samples,
            key: { platform: "shareoj", slug: encodeShareOjShortId(problemId) },
        };
    }

    /**
     * Start an email + password login. Returns tokens, or a challenge that
     * must be continued with `continueChallenge` (MFA, new password, ...).
     */
    async login(username: string, password: string): Promise<ShareOjTokens | ShareOjChallenge> {
        const response = await request(new URL("/auth/login", API_ORIGIN), {
            method: "POST",
            headers: {
                "User-Agent": USER_AGENT,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({ username, password }),
        });

        return await parseAuthResult(response, undefined);
    }

    /** Continue a login challenge with the user's responses. */
    async continueChallenge(
        username: string,
        challenge: ShareOjChallenge,
        responses: Record<string, string>,
    ): Promise<ShareOjTokens | ShareOjChallenge> {
        const response = await request(new URL("/auth/challenge", API_ORIGIN), {
            method: "POST",
            headers: {
                "User-Agent": USER_AGENT,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                username,
                challenge_name: challenge.name,
                session: challenge.session,
                responses,
            }),
        });

        return await parseAuthResult(response, undefined);
    }

    /** Exchange a refresh token for new tokens. */
    async refresh(refreshToken: string): Promise<ShareOjTokens> {
        const response = await request(new URL("/auth/refresh", API_ORIGIN), {
            method: "POST",
            headers: {
                "User-Agent": USER_AGENT,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });

        const result = await parseAuthResult(response, refreshToken);
        if ("name" in result) {
            throw new Error("ShareOJ token refresh returned an unexpected challenge.");
        }

        return result;
    }

    /** Check an access token against `/auth/me` and return the user ID. */
    async getMe(token: string): Promise<string | undefined> {
        const response = await request(new URL("/auth/me", API_ORIGIN), {
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
            },
        });
        if (!response.ok) {
            throw await parseErrorResponse(response);
        }

        const body: unknown = await response.json();
        if (typeof body !== "object" || body === null) {
            return undefined;
        }
        const user = (body as { user?: unknown }).user;
        if (typeof user !== "object" || user === null) {
            return undefined;
        }

        return typeof (user as { id?: unknown }).id === "string"
            ? (user as { id: string }).id
            : undefined;
    }

    /** The language runtimes available for submissions. */
    async getRuntimes(): Promise<ShareOjRuntime[]> {
        const response = await requestJson<{ items?: ShareOjRuntime[] }>(
            new URL("/runtimes", API_ORIGIN),
            "ShareOJ runtimes response was malformed.",
        );

        return Array.isArray(response.items) ? response.items : [];
    }

    /**
     * Submit a source file. The server accepts the submission immediately
     * (HTTP 202) and returns it with an ID for later status checks.
     */
    async submit(token: string, request: ShareOjSubmissionRequest): Promise<ShareOjSubmission> {
        const body: unknown = await requestAuthJson(new URL("/my/submissions", API_ORIGIN), token, {
            method: "POST",
            body: JSON.stringify({
                contestId: request.contestId,
                problemId: request.problemId,
                runtime: request.runtime,
                source: request.source,
            }),
        });
        if (typeof body !== "object" || body === null) {
            throw new Error("ShareOJ submission response was malformed.");
        }
        const id = (body as { id?: unknown }).id;
        if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
            throw new Error("ShareOJ submission response has no submission ID.");
        }

        return { id };
    }
}
