import { afterEach, describe, expect, it } from "bun:test";

import { deriveProblemKey } from "@/feature/problem-sources";
import {
    ShareOjClient,
    ShareOjProblemRequestError,
    decodeShareOjShortId,
    encodeShareOjShortId,
    extractShareOjShortId,
    parseShareOjProblemUrl,
} from "@/lib/service/shareoj";

const originalFetch = globalThis.fetch;
type FetchHandler = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

function setFetch(handler: FetchHandler): void {
    globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect });
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("ShareOJ short ID conversion", () => {
    it("round-trips UUIDs and 22-character site IDs", () => {
        const uuid = decodeShareOjShortId("04N9rxR9eGNCjAvBNfjU8Z");
        expect(uuid).toBe("02515831-bafa-45f1-8ab7-ff8ffd7b5c13");
        expect(encodeShareOjShortId(uuid)).toBe("04N9rxR9eGNCjAvBNfjU8Z");
    });

    it("rejects malformed short IDs", () => {
        expect(() => decodeShareOjShortId("short")).toThrow(TypeError);
        expect(() => decodeShareOjShortId("!!!!!!!!!!!!!!!!!!!!!!")).toThrow(TypeError);
    });
});

describe("ShareOJ problem URL parsing", () => {
    it("accepts the site problem URL", () => {
        const url = parseShareOjProblemUrl(
            "https://www.share-oj.net/problems/04N9rxR9eGNCjAvBNfjU8Z",
        );
        expect(extractShareOjShortId(url)).toBe("04N9rxR9eGNCjAvBNfjU8Z");
    });

    it("rejects other hosts and paths", () => {
        expect(() =>
            parseShareOjProblemUrl("https://share-oj.net/problems/04N9rxR9eGNCjAvBNfjU8Z"),
        ).toThrow(TypeError);
        expect(() =>
            parseShareOjProblemUrl("https://www.share-oj.net/contests/04N9rxR9eGNCjAvBNfjU8Z"),
        ).toThrow(TypeError);
        expect(() =>
            parseShareOjProblemUrl("https://www.share-oj.net/problems/not-a-shareoj-id"),
        ).toThrow(TypeError);
        expect(() => parseShareOjProblemUrl("not a url")).toThrow(TypeError);
    });

    it("derives the stash key from the site URL", () => {
        expect(
            deriveProblemKey("https://www.share-oj.net/problems/04N9rxR9eGNCjAvBNfjU8Z"),
        ).toEqual({ platform: "shareoj", slug: "04N9rxR9eGNCjAvBNfjU8Z" });
    });
});

describe("ShareOjClient", () => {
    const problemUrl = "https://www.share-oj.net/problems/04N9rxR9eGNCjAvBNfjU8Z";

    it("fetches the problem and its samples", async () => {
        setFetch(async (input) => {
            const url = String(input);
            if (url === "https://api.share-oj.net/problems/02515831-bafa-45f1-8ab7-ff8ffd7b5c13") {
                return jsonResponse({
                    id: "02515831-bafa-45f1-8ab7-ff8ffd7b5c13",
                    title: "Many Digit Sum Problems",
                });
            }
            if (
                url ===
                "https://api.share-oj.net/problems/02515831-bafa-45f1-8ab7-ff8ffd7b5c13/samples"
            ) {
                return jsonResponse({
                    items: [
                        { name: "sample_001.txt", input: "2 3\r\n12\r\n", output: "3\n" },
                        { name: "sample_002.txt", input: "30 5\n", output: "686449235\n" },
                    ],
                });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const problem = await new ShareOjClient().getProblem(problemUrl);
        expect(problem.title).toBe("Many Digit Sum Problems");
        expect(problem.url).toBe(problemUrl);
        expect(problem.samples).toEqual([
            { input: "2 3\n12", output: "3" },
            { input: "30 5", output: "686449235" },
        ]);
    });

    it("downloads file-backed samples and verifies their hashes", async () => {
        setFetch(async (input) => {
            const url = String(input);
            if (url.endsWith("/problems/02515831-bafa-45f1-8ab7-ff8ffd7b5c13")) {
                return jsonResponse({ id: "x", title: "Big Samples" });
            }
            if (url.endsWith("/samples")) {
                return jsonResponse({
                    items: [
                        {
                            name: "big_001.txt",
                            inputFile: {
                                url: "https://api.share-oj.net/files/input.bin",
                                size: 5,
                                sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
                            },
                            output: "3\n",
                        },
                    ],
                });
            }
            if (url === "https://api.share-oj.net/files/input.bin") {
                return new Response("hello", { status: 200 });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const problem = await new ShareOjClient().getProblem(problemUrl);
        expect(problem.samples).toEqual([{ input: "hello", output: "3" }]);
    });

    it("rejects tampered file-backed samples", async () => {
        setFetch(async (input) => {
            const url = String(input);
            if (url.endsWith("/problems/02515831-bafa-45f1-8ab7-ff8ffd7b5c13")) {
                return jsonResponse({ id: "x", title: "Tampered" });
            }
            if (url.endsWith("/samples")) {
                return jsonResponse({
                    items: [
                        {
                            name: "bad.txt",
                            inputFile: {
                                url: "https://api.share-oj.net/files/input.bin",
                                size: 5,
                                sha256: "0".repeat(64),
                            },
                            output: "3",
                        },
                    ],
                });
            }
            if (url === "https://api.share-oj.net/files/input.bin") {
                return new Response("hello", { status: 200 });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        await expect(new ShareOjClient().getProblem(problemUrl)).rejects.toThrow(
            /does not match its SHA-256 hash/u,
        );
    });

    it("reports API errors through ShareOjProblemRequestError", async () => {
        setFetch(async () => jsonResponse({ error: "problem_not_found" }, 404));

        await expect(new ShareOjClient().getProblem(problemUrl)).rejects.toBeInstanceOf(
            ShareOjProblemRequestError,
        );
    });
});
