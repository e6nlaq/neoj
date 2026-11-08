import { afterEach, describe, expect, it } from "bun:test";

import { deriveProblemKey } from "@/feature/problem-sources";
import {
    buildCodeforcesContestUrl,
    buildCodeforcesProblemUrl,
    CodeforcesClient,
    CodeforcesProblemRequestError,
    extractCodeforcesProblemRoute,
    parseCodeforcesProblem,
    parseCodeforcesProblemUrl,
    stripCodeforcesTitleIndex,
} from "@/lib/service/codeforces";

const originalFetch = globalThis.fetch;
type FetchHandler = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

function setFetch(handler: FetchHandler): void {
    globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect });
}

function htmlResponse(html: string, status = 200): Response {
    return new Response(html, {
        status,
        headers: { "Content-Type": "text/html" },
    });
}

function createProblemHtml(options: {
    title?: string;
    inputPre?: string;
    outputPre?: string;
    samplePairs?: number;
}): string {
    const pairs = options.samplePairs ?? 1;
    const blocks: string[] = [];
    for (let position = 0; position < pairs; position++) {
        blocks.push(`
        <div class="input"><div class="title">Input</div><pre>${options.inputPre ?? "2\n1 2\n"}</pre></div>
        <div class="output"><div class="title">Output</div><pre>${options.outputPre ?? "3\n"}</pre></div>`);
    }

    return `
        <html>
            <head><title>Problem - B - Codeforces</title></head>
            <body>
                <div class="problem-statement">
                    <div class="header">
                        <div class="title">${options.title ?? "B. Laura and Operations"}</div>
                    </div>
                    <div class="input-specification"><p>input</p></div>
                    <div class="sample-tests"><div class="section-title">Example</div><div class="sample-test">${blocks.join("\n")}</div></div>
                </div>
            </body>
        </html>
    `;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("parseCodeforcesProblemUrl", () => {
    it("accepts contest and problemset problem URLs", () => {
        expect(
            parseCodeforcesProblemUrl("https://codeforces.com/contest/1900/problem/B").pathname,
        ).toBe("/contest/1900/problem/B");
        expect(
            parseCodeforcesProblemUrl("https://codeforces.com/problemset/problem/1900/B").pathname,
        ).toBe("/problemset/problem/1900/B");
    });

    it("rejects gym, group, mirror, and unrelated URLs", () => {
        expect(() =>
            parseCodeforcesProblemUrl("https://codeforces.com/gym/105000/problem/A"),
        ).toThrow("Expected a Codeforces problem URL");
        expect(() =>
            parseCodeforcesProblemUrl("https://codeforces.com/group/XyZaBc/contest/1/problem/A"),
        ).toThrow("Expected a Codeforces problem URL");
        expect(() =>
            parseCodeforcesProblemUrl("https://m1.codeforces.com/contest/1900/problem/B"),
        ).toThrow("Expected a Codeforces problem URL");
        expect(() => parseCodeforcesProblemUrl("https://codeforces.com/contest/1900")).toThrow(
            "Expected a Codeforces problem URL",
        );
        expect(() => parseCodeforcesProblemUrl("https://codeforces.com/problemset")).toThrow(
            "Expected a Codeforces problem URL",
        );
        expect(() =>
            parseCodeforcesProblemUrl("https://atcoder.jp/contests/abc300/tasks/abc300_a"),
        ).toThrow("Expected a Codeforces problem URL");
    });
});

describe("extractCodeforcesProblemRoute", () => {
    it("returns the same route for contest and problemset URLs", () => {
        expect(
            extractCodeforcesProblemRoute("https://codeforces.com/contest/1900/problem/B"),
        ).toEqual({
            contestId: "1900",
            index: "B",
        });
        expect(
            extractCodeforcesProblemRoute("https://codeforces.com/problemset/problem/1900/B"),
        ).toEqual({ contestId: "1900", index: "B" });
    });

    it("normalizes the index case", () => {
        expect(
            extractCodeforcesProblemRoute("https://codeforces.com/contest/1900/problem/b").index,
        ).toBe("B");
    });

    it("rejects invalid contest IDs and indices", () => {
        expect(() =>
            extractCodeforcesProblemRoute("https://codeforces.com/contest/abc/problem/B"),
        ).toThrow("Expected a Codeforces problem URL");
        expect(() =>
            extractCodeforcesProblemRoute("https://codeforces.com/contest/1900/problem/1B"),
        ).toThrow("Expected a Codeforces problem URL");
    });
});

describe("buildCodeforcesContestUrl and buildCodeforcesProblemUrl", () => {
    it("derives the contest and canonical problem URLs", () => {
        const route = extractCodeforcesProblemRoute(
            "https://codeforces.com/problemset/problem/1900/b",
        );
        expect(buildCodeforcesContestUrl(route).href).toBe("https://codeforces.com/contest/1900");
        expect(buildCodeforcesProblemUrl(route).href).toBe(
            "https://codeforces.com/contest/1900/problem/B",
        );
    });
});

describe("stripCodeforcesTitleIndex", () => {
    it("strips the leading index and keeps unmatched titles as-is", () => {
        expect(stripCodeforcesTitleIndex("B. Laura and Operations")).toBe("Laura and Operations");
        expect(stripCodeforcesTitleIndex("F1. Sports Betting")).toBe("Sports Betting");
        expect(stripCodeforcesTitleIndex("Weird Title Without Index")).toBe(
            "Weird Title Without Index",
        );
    });
});

describe("parseCodeforcesProblem", () => {
    it("parses the title and paired samples", () => {
        const problem = parseCodeforcesProblem(
            createProblemHtml({ samplePairs: 2 }),
            "https://codeforces.com/contest/1900/problem/B",
        );

        expect(problem.title).toBe("Laura and Operations");
        expect(problem.samples).toEqual([
            { input: "2\n1 2", output: "3" },
            { input: "2\n1 2", output: "3" },
        ]);
    });

    it("unwraps test-example-line divs in the input pre", () => {
        const inputPre = [
            '<div class="test-example-line test-example-line-even test-example-line-0">3</div>',
            '<div class="test-example-line test-example-line-odd test-example-line-1">1 1 1</div>',
            '<div class="test-example-line test-example-line-even test-example-line-2">2 3 2</div>',
        ].join("");

        const problem = parseCodeforcesProblem(
            createProblemHtml({ inputPre }),
            "https://codeforces.com/contest/1900/problem/B",
        );

        expect(problem.samples[0]?.input).toBe("3\n1 1 1\n2 3 2");
    });

    it("normalizes CRLF line endings", () => {
        const problem = parseCodeforcesProblem(
            createProblemHtml({ outputPre: "1\r\n2\r\n3\r\n" }),
            "https://codeforces.com/contest/1900/problem/B",
        );

        expect(problem.samples[0]?.output).toBe("1\n2\n3");
    });

    it("throws when a sample pre or the title is missing", () => {
        expect(() =>
            parseCodeforcesProblem(
                createProblemHtml({ inputPre: "" }).replace(/<pre>[^<]*<\/pre>/u, "<code>2</code>"),
                "https://codeforces.com/contest/1900/problem/B",
            ),
        ).toThrow("Codeforces sample 1 input content was not found.");

        expect(() =>
            parseCodeforcesProblem(
                createProblemHtml({ title: "" }),
                "https://codeforces.com/contest/1900/problem/B",
            ),
        ).toThrow("Codeforces problem title was not found in the response.");
    });

    it("throws when the statement is absent, such as a login-only page", () => {
        expect(() =>
            parseCodeforcesProblem(
                '<html><body><div class="error">You are not allowed to view the requested page</div></body></html>',
                "https://codeforces.com/contest/1900/problem/B",
            ),
        ).toThrow("Codeforces problem statement was not found in the response.");
    });
});

describe("CodeforcesClient", () => {
    describe("getProblem", () => {
        it("parses the problem page fixture", async () => {
            const html = await Bun.file("test/fixtures/codeforces-problem.html").text();
            let requestedUrl: string | undefined;
            let userAgent: string | undefined;
            setFetch((input, init) => {
                requestedUrl = input.toString();
                userAgent = new Headers(init?.headers).get("User-Agent") ?? undefined;
                return Promise.resolve(htmlResponse(html));
            });

            const problem = await new CodeforcesClient().getProblem(
                "https://codeforces.com/problemset/problem/1900/B",
            );

            expect(requestedUrl).toBe("https://codeforces.com/problemset/problem/1900/B");
            expect(userAgent).toContain("neoj");
            expect(problem.title).toBe("Example Problem");
            expect(problem.samples[0]?.input).toBe("3\n1 2 3\n4 5 6");
            expect(problem.samples[0]?.output).toBe("1 2 3");
            expect(problem.url).toBe("https://codeforces.com/problemset/problem/1900/B");
        });

        it("rejects unsupported URLs without fetching", async () => {
            let called = false;
            setFetch(() => {
                called = true;
                return Promise.resolve(htmlResponse(createProblemHtml({})));
            });

            await expect(
                new CodeforcesClient().getProblem("https://codeforces.com/enter"),
            ).rejects.toThrow("Expected a Codeforces problem URL");
            expect(called).toBe(false);
        });

        it("throws when the problem request fails", async () => {
            setFetch(() => Promise.resolve(htmlResponse("forbidden", 403)));

            const error = await new CodeforcesClient()
                .getProblem("https://codeforces.com/contest/1900/problem/B")
                .catch((caught: unknown) => caught);
            expect(error instanceof CodeforcesProblemRequestError).toBe(true);
            expect((error as CodeforcesProblemRequestError).status).toBe(403);
        });

        it("reports redirects instead of following them", async () => {
            setFetch(() => Promise.resolve(htmlResponse("", 302)));

            await expect(
                new CodeforcesClient().getProblem("https://codeforces.com/contest/1900/problem/B"),
            ).rejects.toThrow("Codeforces redirected the problem request (302).");
        });
    });
});

describe("deriveProblemKey for Codeforces", () => {
    it("maps contest and problemset URLs of one problem to the same key", () => {
        const contest = deriveProblemKey("https://codeforces.com/contest/1900/problem/B");
        const problemset = deriveProblemKey("https://codeforces.com/problemset/problem/1900/B");

        expect(contest).toEqual({ platform: "codeforces", slug: "1900B" });
        expect(problemset).toEqual(contest);
    });
});
