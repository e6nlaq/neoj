import type { Problem, ProblemSample } from "@/lib/service/problem";
import { isTimeoutError } from "@/lib/util/errors";
import { USER_AGENT } from "@/lib/util/user-agent";

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
        throw new TypeError(`Expected a ShareOJ problem ID: "${shortId}".`);
    }

    let value = 0n;
    for (const character of shortId) {
        value = value * 62n + BigInt(BASE62_ALPHABET.indexOf(character));
    }

    const hex = value.toString(16).padStart(32, "0");
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    if (!UUID_PATTERN.test(uuid)) {
        throw new TypeError(`Expected a ShareOJ problem ID: "${shortId}".`);
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
        throw new TypeError(`Expected a ShareOJ problem UUID: "${value}".`);
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

    const bare = trimmed.match(UUID_PATTERN) ?? trimmed.match(SHORT_ID_PATTERN);
    if (bare !== null) {
        return UUID_PATTERN.test(trimmed)
            ? parseShareOjUuid(trimmed)
            : decodeShareOjShortId(trimmed);
    }

    const problemUrl = parseShareOjProblemUrl(trimmed);
    return decodeShareOjShortId(
        problemUrl.pathname.split("/").filter((segment) => segment.length > 0)[1] ?? "",
    );
}

/** Parse and validate a ShareOJ problem page URL. */
export function parseShareOjProblemUrl(value: string): URL {
    let problemUrl: URL;
    try {
        problemUrl = new URL(value);
    } catch {
        throw new TypeError(`Expected a ShareOJ problem URL: "${value}".`);
    }
    if (problemUrl.username || problemUrl.password || problemUrl.origin !== SITE_ORIGIN) {
        throw new TypeError(`Expected a ShareOJ problem URL: "${value}".`);
    }

    const segments = problemUrl.pathname.split("/").filter((segment) => segment.length > 0);
    if (segments.length !== 2 || segments[0] !== "problems") {
        throw new TypeError(`Expected a ShareOJ problem URL: "${value}".`);
    }
    decodeShareOjShortId(segments[1] ?? "");

    return problemUrl;
}

/** The validated 22-character site short ID of a ShareOJ problem URL. */
export function extractShareOjShortId(value: string | URL): string {
    const problemUrl = parseShareOjProblemUrl(value.toString());
    const segments = problemUrl.pathname.split("/").filter((segment) => segment.length > 0);
    const shortId = segments[1] ?? "";
    decodeShareOjShortId(shortId);

    return shortId;
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

export class ShareOjProblemRequestError extends Error {
    constructor(readonly status: number) {
        super(`ShareOJ problem request failed (${status}).`);
        this.name = "ShareOjProblemRequestError";
    }
}

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
        throw new ShareOjProblemRequestError(response.status);
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
 * Samples normally carry the text inline, but large cases reference a file
 * instead. The file is downloaded through its URL and validated against the
 * reported size and SHA-256 hash.
 */
async function resolveSampleText(
    inline: string | undefined,
    file: ShareOjDownload | undefined,
    label: string,
    sampleName: string,
): Promise<string> {
    if (typeof inline === "string") {
        return inline;
    }
    if (file?.url === undefined) {
        throw new Error(`ShareOJ sample "${sampleName}" is missing its ${label}.`);
    }

    const response = await request(new URL(file.url), {
        headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
        throw new ShareOjSampleDownloadError(
            `Downloading the ${label} of ShareOJ sample "${sampleName}" failed (${response.status}).`,
        );
    }

    const text = await response.text();
    if (text.length !== file.size) {
        throw new ShareOjSampleDownloadError(
            `The downloaded ${label} of ShareOJ sample "${sampleName}" has an unexpected size (${text.length}, expected ${file.size}).`,
        );
    }

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const hash = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    if (hash !== file.sha256) {
        throw new ShareOjSampleDownloadError(
            `The downloaded ${label} of ShareOJ sample "${sampleName}" does not match its SHA-256 hash.`,
        );
    }

    return text;
}

function normalizeSampleText(value: string): string {
    return value.replaceAll("\r\n", "\n").replace(/\n$/u, "");
}

export class ShareOjClient {
    /**
     * Fetch the problem detail and its public samples from the official API.
     *
     * The input URL is preserved in the result so that `.neoj/problem.json`
     * records the URL the user downloaded.
     */
    async getProblem(url: string): Promise<ShareOjProblem> {
        const uuid = parseShareOjProblemId(url);

        const detail = await requestJson<ShareOjProblemDetail>(
            new URL(`/problems/${uuid}`, API_ORIGIN),
            "ShareOJ problem response was malformed.",
        );
        const title = typeof detail.title === "string" ? detail.title : undefined;
        if (!title) {
            throw new Error("ShareOJ problem title was not found in the response.");
        }

        const samplesResponse = await requestJson<{ items?: RawShareOjSample[] }>(
            new URL(`/problems/${uuid}/samples`, API_ORIGIN),
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
        };
    }
}
