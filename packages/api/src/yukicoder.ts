import { parse, type HTMLElement } from "node-html-parser";
import * as v from "valibot";

import { isTimeoutError } from "./errors.js";
import type { Problem, ProblemSample } from "./problem.js";
import { USER_AGENT } from "./user-agent.js";

const YUKICODER_ORIGIN = "https://yukicoder.me";
const API_ORIGIN = `${YUKICODER_ORIGIN}/api`;
const REQUEST_TIMEOUT_MS = 15_000;
const PROBLEM_PATH_PATTERN = /^\/problems\/(?:no\/\d+|\d+)\/?$/;
const INVALID_CREDENTIAL_PATTERN = /[\s\p{Cc}]/u;
const BEARER_PREFIX_PATTERN = /^Bearer\s+/i;

const verificationUrlSchema = v.pipe(
    v.string(),
    v.url(),
    v.check(
        (value) => new URL(value).origin === YUKICODER_ORIGIN,
        "Expected a yukicoder verification URL.",
    ),
);

const deviceCodeSchema = v.object({
    device_code: v.pipe(v.string(), v.nonEmpty()),
    user_code: v.pipe(v.string(), v.nonEmpty()),
    verification_uri: verificationUrlSchema,
    verification_uri_complete: v.optional(verificationUrlSchema),
    expires_in: v.pipe(v.number(), v.integer(), v.minValue(1)),
    interval: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

const deviceTokenSchema = v.object({
    access_token: v.pipe(v.string(), v.nonEmpty()),
    token_type: v.optional(v.string()),
    expires_in: v.pipe(v.number(), v.integer(), v.minValue(1)),
    scope: v.optional(v.string()),
});

const deviceErrorSchema = v.object({
    error: v.pipe(v.string(), v.nonEmpty()),
    error_description: v.optional(v.string()),
});

const languageSchema = v.object({
    Id: v.union([v.pipe(v.number(), v.integer()), v.pipe(v.string(), v.nonEmpty())]),
    Name: v.pipe(v.string(), v.nonEmpty()),
    Ver: v.optional(v.nullable(v.string())),
});

const languagesSchema = v.array(languageSchema);

const submissionSchema = v.object({
    SubmissionId: v.union([v.pipe(v.number(), v.integer()), v.pipe(v.string(), v.nonEmpty())]),
});

export type YukicoderProblem = Problem;

export interface YukicoderDeviceCode {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
}

export interface YukicoderDeviceToken {
    accessToken: string;
    expiresAt: Temporal.Instant;
}

export interface YukicoderLanguage {
    id: string;
    name: string;
    version: string | undefined;
}

export interface YukicoderSubmissionResult {
    submissionId: string;
    submissionUrl: string;
}

export interface PollDeviceTokenOptions {
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
}

export class YukicoderProblemRequestError extends Error {
    constructor(readonly status: number) {
        super(`yukicoder problem request failed (${status}).`);
        this.name = "YukicoderProblemRequestError";
    }
}

export function parseYukicoderProblemUrl(value: string): URL {
    const problemUrl = new URL(value);
    if (
        problemUrl.origin !== YUKICODER_ORIGIN ||
        problemUrl.username ||
        problemUrl.password ||
        !PROBLEM_PATH_PATTERN.test(problemUrl.pathname)
    ) {
        throw new TypeError("Expected a yukicoder problem URL.");
    }

    return problemUrl;
}

export function normalizeYukicoderCredential(value: string): string {
    const credential = value.trim().replace(BEARER_PREFIX_PATTERN, "").trim();
    if (credential.length === 0) {
        throw new Error("yukicoder credential cannot be empty.");
    }
    if (INVALID_CREDENTIAL_PATTERN.test(credential)) {
        throw new Error("yukicoder credential contains invalid characters.");
    }

    return credential;
}

async function request(url: string, init: RequestInit): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
        if (isTimeoutError(error)) {
            throw new Error(
                `yukicoder request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. Check your connection and try again.`,
                { cause: error },
            );
        }
        throw new Error("Failed to connect to yukicoder.", { cause: error });
    }
}

async function readJson(response: Response, context: string): Promise<unknown> {
    try {
        return (await response.json()) as unknown;
    } catch (error) {
        throw new Error(`yukicoder ${context} response was not valid JSON.`, { cause: error });
    }
}

function parseJsonWithSchema<TSchema extends v.GenericSchema>(
    value: unknown,
    schema: TSchema,
    context: string,
): v.InferOutput<TSchema> {
    const result = v.safeParse(schema, value);
    if (!result.success) {
        throw new Error(`yukicoder ${context} response was invalid.`, { cause: result.issues });
    }

    return result.output;
}

const problemSummarySchema = v.object({
    No: v.pipe(v.number(), v.integer()),
    ContestId: v.optional(v.nullable(v.pipe(v.number(), v.integer()))),
});

export interface YukicoderProblemRoute {
    /** `no` for /problems/no/<No>, `id` for /problems/<ProblemId>. */
    kind: "no" | "id";
    number: number;
}

/** Distinguish the problem number (`no`) URL from the internal ID URL. */
export function parseYukicoderProblemRoute(value: string): YukicoderProblemRoute {
    const problemUrl = parseYukicoderProblemUrl(value);
    const match = /^\/problems\/(no\/)?(\d+)\/?$/u.exec(problemUrl.pathname);
    if (match === null) {
        throw new TypeError(`Expected a yukicoder problem URL with a problem number: "${value}".`);
    }

    return { kind: match[1] === undefined ? "id" : "no", number: Number(match[2]) };
}

async function fetchProblemSummary(route: YukicoderProblemRoute) {
    const path = route.kind === "no" ? `no/${route.number}` : String(route.number);
    const response = await request(`${API_ORIGIN}/v1/problems/${path}`, {
        headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
        throw new Error(`yukicoder problem request failed (${response.status}).`);
    }

    return parseJsonWithSchema(
        await readJson(response, "problem"),
        problemSummarySchema,
        "problem",
    );
}

/** Resolve either URL form to the problem No. used by the submission API. */
async function resolveProblemNumber(value: string): Promise<number> {
    const route = parseYukicoderProblemRoute(value);
    if (route.kind === "no") {
        return route.number;
    }

    return (await fetchProblemSummary(route)).No;
}

export function buildYukicoderSubmissionsUrl(value: string): URL {
    const route = parseYukicoderProblemRoute(value);
    const path =
        route.kind === "no"
            ? `/problems/no/${route.number}/submissions`
            : `/problems/${route.number}/submissions`;
    const submissionsUrl = new URL(path, YUKICODER_ORIGIN);
    submissionsUrl.searchParams.set("my_submission", "enabled");
    return submissionsUrl;
}

/**
 * Resolve the contest page of a problem.
 *
 * The contest ID is not part of the problem URL, so it comes from the public
 * yukicoder API. Problems that are not part of a contest cannot be resolved.
 */
export async function fetchYukicoderContestUrl(value: string): Promise<URL> {
    const problem = await fetchProblemSummary(parseYukicoderProblemRoute(value));
    if (problem.ContestId === null || problem.ContestId === undefined) {
        throw new Error("This yukicoder problem does not belong to a contest.");
    }

    return new URL(`/contests/${problem.ContestId}`, YUKICODER_ORIGIN);
}

function normalizePre(value: string): string {
    return value.trim().replaceAll("\r\n", "\n");
}

function findPreAfter(element: HTMLElement): HTMLElement | undefined {
    let sibling = element.nextElementSibling;
    while (sibling) {
        if (sibling.tagName === "PRE") {
            return sibling;
        }
        if (sibling.tagName === "H6") {
            return undefined;
        }
        sibling = sibling.nextElementSibling;
    }

    return undefined;
}

function parseSamples(document: HTMLElement): ProblemSample[] {
    return document.querySelectorAll(".sample").map((element, index) => {
        const paragraph = element.querySelector(".paragraph") ?? element;
        const sample: { input?: string; output?: string } = {};

        for (const heading of paragraph.querySelectorAll("h6")) {
            const pre = findPreAfter(heading);
            if (pre === undefined) {
                continue;
            }

            const label = heading.textContent.trim();
            if (/^(入力|input|sample input)$/i.test(label)) {
                sample.input = normalizePre(pre.textContent);
            } else if (/^(出力|output|sample output)$/i.test(label)) {
                sample.output = normalizePre(pre.textContent);
            }
        }

        const preElements = paragraph.querySelectorAll("pre");
        if (sample.input === undefined && preElements[0] !== undefined) {
            sample.input = normalizePre(preElements[0].textContent);
        }
        if (sample.output === undefined && preElements[1] !== undefined) {
            sample.output = normalizePre(preElements[1].textContent);
        }

        if (sample.input === undefined || sample.output === undefined) {
            throw new Error(`yukicoder sample ${index + 1} is missing its input or output.`);
        }

        return { input: sample.input, output: sample.output };
    });
}

function parseProblem(html: string, url: string): YukicoderProblem {
    const document = parse(html);
    if (!document.querySelector("#content[data-problem-id]")) {
        throw new Error("yukicoder problem was not found in the response.");
    }

    const title = document.querySelector("title")?.textContent.trim();
    if (!title) {
        throw new Error("yukicoder problem title was not found in the response.");
    }

    return {
        url,
        title,
        samples: parseSamples(document),
    };
}

export class YukicoderClient {
    async getProblem(url: string): Promise<YukicoderProblem> {
        const problemUrl = parseYukicoderProblemUrl(url);
        const response = await request(problemUrl.href, {
            headers: { "User-Agent": USER_AGENT },
        });
        if (!response.ok) {
            throw new YukicoderProblemRequestError(response.status);
        }

        return parseProblem(await response.text(), problemUrl.href);
    }

    async requestDeviceCode(clientName: string): Promise<YukicoderDeviceCode> {
        const response = await request(`${API_ORIGIN}/v1/device/code`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": USER_AGENT,
            },
            body: new URLSearchParams({ client_name: clientName }),
        });
        if (!response.ok) {
            throw new Error(`yukicoder device authorization request failed (${response.status}).`);
        }

        const parsed = parseJsonWithSchema(
            await readJson(response, "device authorization"),
            deviceCodeSchema,
            "device authorization",
        );
        return {
            deviceCode: parsed.device_code,
            userCode: parsed.user_code,
            verificationUri: parsed.verification_uri,
            verificationUriComplete: parsed.verification_uri_complete ?? parsed.verification_uri,
            expiresIn: parsed.expires_in,
            interval: parsed.interval,
        };
    }

    async pollDeviceToken(
        deviceCode: YukicoderDeviceCode,
        options: PollDeviceTokenOptions = {},
    ): Promise<YukicoderDeviceToken> {
        const sleep =
            options.sleep ??
            ((milliseconds: number) =>
                new Promise<void>((resolve) => {
                    setTimeout(resolve, milliseconds);
                }));
        const now = options.now ?? (() => Date.now());
        const deadline = now() + deviceCode.expiresIn * 1000;
        let intervalMilliseconds = deviceCode.interval * 1000;
        let attempts = 0;
        const maxAttempts = Math.ceil(deviceCode.expiresIn / deviceCode.interval) + 5;

        while (now() < deadline && attempts < maxAttempts) {
            attempts += 1;
            await sleep(intervalMilliseconds);

            const response = await request(`${API_ORIGIN}/v1/device/token`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": USER_AGENT,
                },
                body: new URLSearchParams({
                    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                    device_code: deviceCode.deviceCode,
                }),
            });

            if (response.ok) {
                const token = parseJsonWithSchema(
                    await readJson(response, "device token"),
                    deviceTokenSchema,
                    "device token",
                );
                return {
                    accessToken: token.access_token,
                    expiresAt: Temporal.Instant.fromEpochMilliseconds(
                        now() + token.expires_in * 1000,
                    ),
                };
            }

            if (response.status !== 400) {
                throw new Error(`yukicoder device token request failed (${response.status}).`);
            }

            const error = parseJsonWithSchema(
                await readJson(response, "device token error"),
                deviceErrorSchema,
                "device token error",
            );
            switch (error.error) {
                case "authorization_pending":
                    break;
                case "slow_down":
                    intervalMilliseconds += 5000;
                    break;
                case "access_denied":
                    throw new Error("yukicoder authorization was denied.");
                case "expired_token":
                    throw new Error(
                        'yukicoder device code expired. Run "neoj login yukicoder" again.',
                    );
                case "invalid_grant":
                    throw new Error("yukicoder device code is invalid or was already used.");
                case "unsupported_grant_type":
                    throw new Error("yukicoder rejected the device authorization grant type.");
                default:
                    throw new Error(
                        `yukicoder device authorization failed: ${
                            error.error_description ?? error.error
                        }`,
                    );
            }
        }

        throw new Error(
            'yukicoder device authorization timed out. Run "neoj login yukicoder" again.',
        );
    }

    /** Public language list; the submission form uses the same IDs. */
    async getLanguages(): Promise<YukicoderLanguage[]> {
        const response = await request(`${API_ORIGIN}/v1/languages`, {
            headers: { "User-Agent": USER_AGENT },
        });
        if (!response.ok) {
            throw new Error(`yukicoder language request failed (${response.status}).`);
        }

        const languages = parseJsonWithSchema(
            await readJson(response, "language"),
            languagesSchema,
            "language",
        );
        return languages.map((language) => ({
            id: String(language.Id),
            name: language.Name,
            version: language.Ver ?? undefined,
        }));
    }

    async submit(
        problemUrl: string,
        credential: string,
        languageId: string,
        source: string,
    ): Promise<YukicoderSubmissionResult> {
        const normalized = normalizeYukicoderCredential(credential);
        const number = await resolveProblemNumber(problemUrl);
        const body = new FormData();
        body.set("lang", languageId);
        body.set("source", source);

        const response = await request(`${API_ORIGIN}/v1/problems/no/${number}/submit`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${normalized}`,
                "User-Agent": USER_AGENT,
            },
            body,
        });
        if (!response.ok) {
            throw await this.createSubmissionError(response.status, normalized, languageId);
        }

        const submission = parseJsonWithSchema(
            await readJson(response, "submission"),
            submissionSchema,
            "submission",
        );
        const submissionId = String(submission.SubmissionId);
        return {
            submissionId,
            submissionUrl: new URL(`/submissions/${submissionId}`, YUKICODER_ORIGIN).href,
        };
    }

    /**
     * Explain a rejected submission without blaming the login when the
     * credential is still valid. yukicoder can reject a request with 401/403
     * for other reasons, such as an unknown language ID.
     */
    private async createSubmissionError(
        status: number,
        credential: string,
        languageId: string,
    ): Promise<Error> {
        let credentialValid: boolean | undefined;
        if (status === 401 || status === 403) {
            try {
                credentialValid = await this.checkCredential(credential);
            } catch {
                credentialValid = undefined;
            }
            if (credentialValid === false) {
                return new Error(
                    'yukicoder rejected the submission because the login is not valid. Run "neoj login yukicoder" and try again.',
                );
            }
        }

        if (status >= 400 && status < 500) {
            let languageKnown: boolean | undefined;
            try {
                languageKnown = (await this.getLanguages()).some(
                    (language) => language.id === languageId,
                );
            } catch {
                languageKnown = undefined;
            }
            if (languageKnown === false) {
                return new Error(
                    `yukicoder does not recognize the language ID "${languageId}". Set a valid ID with "neoj languages yukicoder", --platform-language, or languages.<key>.submit.yukicoder.`,
                );
            }
        }

        if (credentialValid === true) {
            return new Error(
                `yukicoder rejected the submission (${status}) even though the login is valid. Check the language ID ("${languageId}") and the source, then try again.`,
            );
        }
        if (credentialValid === undefined && (status === 401 || status === 403)) {
            return new Error(
                `yukicoder rejected the submission (${status}) and the login could not be verified. Run "neoj login yukicoder" and try again, or check the language ID ("${languageId}").`,
            );
        }

        return new Error(`yukicoder submission failed (${status}).`);
    }

    async checkCredential(credential: string): Promise<boolean> {
        const normalized = normalizeYukicoderCredential(credential);
        const response = await request(`${API_ORIGIN}/v1/authUser`, {
            headers: {
                Authorization: `Bearer ${normalized}`,
                "User-Agent": USER_AGENT,
            },
        });

        if (response.status === 401 || response.status === 403) {
            return false;
        }
        if (!response.ok) {
            throw new Error(`yukicoder login check failed (${response.status}).`);
        }

        return true;
    }
}
