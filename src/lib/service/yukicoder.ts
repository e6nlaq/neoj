import { parse, type HTMLElement } from "node-html-parser";
import * as v from "valibot";

import type { Problem, ProblemSample } from "@/lib/service/problem";
import { isTimeoutError } from "@/lib/util/errors";

const YUKICODER_ORIGIN = "https://yukicoder.me";
const API_ORIGIN = `${YUKICODER_ORIGIN}/api`;
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "neoj (+https://github.com/e6nlaq/neoj)";
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
