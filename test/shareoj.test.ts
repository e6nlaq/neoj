import { afterEach, describe, expect, it } from "bun:test";

import { deriveProblemKey } from "@/feature/problem-sources";
import {
    ShareOjApiError,
    ShareOjClient,
    ShareOjProblemRequestError,
    decodeShareOjShortId,
    encodeShareOjProblemLabel,
    encodeShareOjShortId,
    extractShareOjShortId,
    parseShareOjContestProblemUrl,
    parseShareOjProblemLabel,
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

describe("ShareOJ contest problem labels", () => {
    it("maps indices to labels like the site (A, B, ..., Z, AA, AB, ...)", () => {
        expect(encodeShareOjProblemLabel(0)).toBe("A");
        expect(encodeShareOjProblemLabel(25)).toBe("Z");
        expect(encodeShareOjProblemLabel(26)).toBe("AA");
        expect(encodeShareOjProblemLabel(27)).toBe("AB");
        expect(encodeShareOjProblemLabel(51)).toBe("AZ");
        expect(encodeShareOjProblemLabel(52)).toBe("BA");
        for (let index = 0; index < 60; index++) {
            expect(parseShareOjProblemLabel(encodeShareOjProblemLabel(index))).toBe(index);
        }
    });

    it("rejects invalid labels", () => {
        expect(() => parseShareOjProblemLabel("a")).toThrow(TypeError);
        expect(() => parseShareOjProblemLabel("ABCD")).toThrow(TypeError);
        expect(() => parseShareOjProblemLabel("1")).toThrow(TypeError);
    });
});

describe("ShareOJ contest problem URL parsing", () => {
    it("accepts the contest problem URL", () => {
        expect(
            parseShareOjContestProblemUrl(
                "https://www.share-oj.net/contests/6hxOlRWKFEHO8PdlMXxVPN/A",
            ),
        ).toEqual({ contestShortId: "6hxOlRWKFEHO8PdlMXxVPN", label: "A" });
    });

    it("rejects other hosts and paths", () => {
        expect(() =>
            parseShareOjContestProblemUrl(
                "https://evil.example.com/contests/6hxOlRWKFEHO8PdlMXxVPN/A",
            ),
        ).toThrow(TypeError);
        expect(() =>
            parseShareOjContestProblemUrl(
                "https://www.share-oj.net/contests/6hxOlRWKFEHO8PdlMXxVPN",
            ),
        ).toThrow(TypeError);
        expect(() =>
            parseShareOjContestProblemUrl(
                "https://www.share-oj.net/contests/6hxOlRWKFEHO8PdlMXxVPN/a",
            ),
        ).toThrow(TypeError);
    });

    it("matches contest problem URLs as a ShareOJ problem source", () => {
        expect(
            deriveProblemKey("https://www.share-oj.net/problems/04N9rxR9eGNCjAvBNfjU8Z"),
        ).toEqual({ platform: "shareoj", slug: "04N9rxR9eGNCjAvBNfjU8Z" });
        expect(() =>
            deriveProblemKey("https://www.share-oj.net/contests/6hxOlRWKFEHO8PdlMXxVPN/A"),
        ).toThrow(/Could not derive a stash name .* offline/u);
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

describe("ShareOjClient authentication and submission", () => {
    function assertBody(init: RequestInit | undefined, expected: unknown): void {
        expect(JSON.parse(String(init?.body))).toEqual(expected);
    }

    it("logs in and reports challenges", async () => {
        let calls: Array<{ url: string; body?: unknown }> = [];
        setFetch(async (input, init) => {
            const url = String(input);
            calls.push({
                url,
                body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
            });
            if (url.endsWith("/auth/login")) {
                return jsonResponse({ challenge_name: "EMAIL_OTP", session: "sess-1" }, 200);
            }
            if (url.endsWith("/auth/challenge")) {
                return jsonResponse(
                    { access_token: "tok", refresh_token: "ref", expires_in: 3600 },
                    200,
                );
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        const client = new ShareOjClient();

        const first = await client.login("user@example.com", "pw");
        expect(first).toEqual({ name: "EMAIL_OTP", session: "sess-1", parameters: {} });

        const second = await client.continueChallenge("user@example.com", first as never, {
            EMAIL_OTP_CODE: "123456",
        });
        expect(second).toEqual({
            accessToken: "tok",
            refreshToken: "ref",
            expiresAt: expect.anything(),
        });
        expect(calls[1]?.body).toEqual({
            username: "user@example.com",
            challenge_name: "EMAIL_OTP",
            session: "sess-1",
            responses: { EMAIL_OTP_CODE: "123456" },
        });
        calls = [];
    });

    it("refreshes tokens", async () => {
        setFetch(async (input, init) => {
            assertBody(init, { refresh_token: "ref" });
            return jsonResponse({ access_token: "tok2", expires_in: 100 }, 200);
        });

        const tokens = await new ShareOjClient().refresh("ref");
        expect(tokens).toEqual({
            accessToken: "tok2",
            refreshToken: "ref",
            expiresAt: expect.anything(),
        });
    });

    it("checks /auth/me", async () => {
        setFetch(async (input, init) => {
            expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");
            return jsonResponse({ user: { id: "u1" } }, 200);
        });

        await expect(new ShareOjClient().getMe("tok")).resolves.toBe("u1");
    });

    it("submits code and builds the submission URL", async () => {
        setFetch(async (input, init) => {
            expect(String(input)).toBe("https://api.share-oj.net/my/submissions");
            assertBody(init, {
                contestId: "c1",
                problemId: "p1",
                runtime: "cpp23-gcc",
                source: "int main(){}",
            });
            return jsonResponse({ id: "02515831-bafa-45f1-8ab7-ff8ffd7b5c13" }, 202);
        });

        const submission = await new ShareOjClient().submit("tok", {
            problemId: "p1",
            contestId: "c1",
            runtime: "cpp23-gcc",
            source: "int main(){}",
        });
        expect(submission.id).toBe("02515831-bafa-45f1-8ab7-ff8ffd7b5c13");
        expect(ShareOjClient.submissionUrl(submission.id)).toBe(
            "https://www.share-oj.net/my/submissions/04N9rxR9eGNCjAvBNfjU8Z",
        );
        expect(ShareOjClient.submissionUrl(submission.id, "6hxOlRWKFEHO8PdlMXxVPN")).toBe(
            "https://www.share-oj.net/contests/6hxOlRWKFEHO8PdlMXxVPN/my-submissions/04N9rxR9eGNCjAvBNfjU8Z",
        );
    });

    it("lists runtimes", async () => {
        setFetch(async () =>
            jsonResponse(
                { items: [{ id: "cpp23-gcc", label: "C++23 (GCC)" }], maintenance: false },
                200,
            ),
        );

        await expect(new ShareOjClient().getRuntimes()).resolves.toEqual([
            { id: "cpp23-gcc", label: "C++23 (GCC)" },
        ]);
    });

    it("maps API error codes to ShareOjApiError", async () => {
        setFetch(async () => jsonResponse({ error: "contest_participation_required" }, 400));

        await expect(
            new ShareOjClient().submit("tok", { problemId: "p", runtime: "r", source: "s" }),
        ).rejects.toThrow(/contest_participation_required/u);
        await expect(
            new ShareOjClient().submit("tok", { problemId: "p", runtime: "r", source: "s" }),
        ).rejects.toBeInstanceOf(ShareOjApiError);
    });
});

describe("ShareOjClient contest problems", () => {
    const contestUrl = "https://www.share-oj.net/contests/6hxOlRWKFEHO8PdlMXxVPN/A";
    const contestId = "dc6fc9dd-4019-463a-a486-12c3fc10af59";
    const problemId = "7f4a5126-a79a-47a0-a523-4f476156ba7e";

    function mockContestFetch(options?: { problems?: unknown }): FetchHandler {
        return async (input) => {
            const url = String(input);
            if (url === `https://api.share-oj.net/contests/${contestId}`) {
                return jsonResponse({
                    id: contestId,
                    title: "ShareOJ Programming Contest vol.1",
                    problems: options?.problems ?? [{ id: problemId }],
                });
            }
            if (url === `https://api.share-oj.net/contests/${contestId}/problems/${problemId}`) {
                return jsonResponse({ id: problemId, title: "Welcome to ShareOJ!" });
            }
            if (url === `https://api.share-oj.net/problems/${problemId}/samples`) {
                return jsonResponse({
                    items: [{ name: "case_001.txt", input: "5\n", output: "\n" }],
                });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        };
    }

    it("resolves the contest problem through the contest API and records the problem key", async () => {
        setFetch(mockContestFetch());

        const problem = await new ShareOjClient().getProblem(contestUrl);
        expect(problem.title).toBe("Welcome to ShareOJ!");
        expect(problem.url).toBe(contestUrl);
        expect(problem.key).toEqual({ platform: "shareoj", slug: encodeShareOjShortId(problemId) });
        expect(problem.samples).toEqual([{ input: "5", output: "" }]);
    });

    it("reports an unresolvable problem when the contest hides the problem ID", async () => {
        setFetch(mockContestFetch({ problems: [{}] }));

        await expect(new ShareOjClient().getProblem(contestUrl)).rejects.toThrow(
            /could not be resolved/u,
        );
    });

    it("reports a label beyond the contest's problem list", async () => {
        setFetch(mockContestFetch({ problems: [{ id: problemId }] }));

        await expect(
            new ShareOjClient().getProblem(
                "https://www.share-oj.net/contests/6hxOlRWKFEHO8PdlMXxVPN/Z",
            ),
        ).rejects.toThrow(/could not be resolved/u);
    });
});
