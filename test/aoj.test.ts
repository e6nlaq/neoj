import { afterEach, describe, expect, it } from "bun:test";

import { deriveProblemKey } from "@/feature/problem-sources";
import {
    AojClient,
    AojProblemRequestError,
    buildAojDescriptionUrl,
    extractAojProblemId,
    parseAojProblem,
    parseAojProblemId,
    parseAojProblemUrl,
    resolveAojPageLanguage,
} from "@/lib/service/aoj";

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
    samples?: Array<{ number: number; input: string; output: string }>;
}): string {
    const samples = options.samples ?? [{ number: 1, input: "2", output: "8" }];
    const sections = samples
        .map(
            (sample) => `
        <H2>Sample Input ${sample.number}</H2>
        <pre>${sample.input}
</pre>
<H2>Sample Output ${sample.number}</H2>
        <pre>${sample.output}
</pre>`,
        )
        .join("\n");

    return `
        <html>
            <body>
                <div class="description">
                    <H1>${options.title ?? "X Cubic"}</H1>
                    <H2>Input</H2>
                    <p>An integer is given.</p>
                    ${sections}
                </div>
            </body>
        </html>
    `;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("parseAojProblemId", () => {
    it("accepts course and volume problem IDs", () => {
        expect(parseAojProblemId("ALDS1_1_A")).toBe("ALDS1_1_A");
        expect(parseAojProblemId("0001")).toBe("0001");
    });

    it("rejects empty and invalid IDs", () => {
        expect(() => parseAojProblemId("")).toThrow("Expected an AOJ problem ID");
        expect(() => parseAojProblemId("ITP1_1_A?x=1")).toThrow("Expected an AOJ problem ID");
    });
});

describe("parseAojProblemUrl", () => {
    it("accepts v1 and v2 problem URLs", () => {
        expect(
            parseAojProblemUrl(
                "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ALDS1_1_A",
            ).searchParams.get("id"),
        ).toBe("ALDS1_1_A");
        expect(
            parseAojProblemUrl("https://onlinejudge.u-aizu.ac.jp/problems/ALDS1_1_A").pathname,
        ).toBe("/problems/ALDS1_1_A");
        expect(
            parseAojProblemUrl(
                "https://onlinejudge.u-aizu.ac.jp/courses/lesson/1/ALDS1/1/ALDS1_1_A",
            ).pathname,
        ).toBe("/courses/lesson/1/ALDS1/1/ALDS1_1_A");
    });

    it("rejects other origins and pages", () => {
        expect(() =>
            parseAojProblemUrl("https://atcoder.jp/contests/abc300/tasks/abc300_a"),
        ).toThrow("Expected an AOJ problem URL");
        expect(() =>
            parseAojProblemUrl("https://judge.u-aizu.ac.jp/onlinejudge/status.jsp"),
        ).toThrow("Expected an AOJ problem URL");
        expect(() =>
            parseAojProblemUrl("https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?cid=ITP1"),
        ).toThrow("Expected an AOJ problem URL");
        expect(() => parseAojProblemUrl("https://onlinejudge.u-aizu.ac.jp/courses/list")).toThrow(
            "Expected an AOJ problem URL",
        );
        expect(() =>
            parseAojProblemUrl("https://onlinejudge.u-aizu.ac.jp/courses/lesson/1/ALDS1"),
        ).toThrow("Expected an AOJ problem URL");
    });
});

describe("extractAojProblemId", () => {
    it("returns the same ID for v1 and v2 URLs of one problem", () => {
        expect(
            extractAojProblemId(
                "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ALDS1_1_A",
            ),
        ).toBe("ALDS1_1_A");
        expect(extractAojProblemId("https://onlinejudge.u-aizu.ac.jp/problems/ALDS1_1_A")).toBe(
            "ALDS1_1_A",
        );
        expect(
            extractAojProblemId(
                "https://onlinejudge.u-aizu.ac.jp/courses/lesson/1/ALDS1/1/ALDS1_1_A",
            ),
        ).toBe("ALDS1_1_A");
    });
});

describe("resolveAojPageLanguage", () => {
    it("honors the v1 lang parameter and falls back to en", () => {
        expect(
            resolveAojPageLanguage(
                parseAojProblemUrl(
                    "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ALDS1_1_A&lang=ja",
                ),
            ),
        ).toBe("ja");
        expect(
            resolveAojPageLanguage(
                parseAojProblemUrl(
                    "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ALDS1_1_A&lang=en",
                ),
            ),
        ).toBe("en");
        expect(
            resolveAojPageLanguage(
                parseAojProblemUrl(
                    "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ALDS1_1_A",
                ),
            ),
        ).toBe("en");
        expect(
            resolveAojPageLanguage(
                parseAojProblemUrl("https://onlinejudge.u-aizu.ac.jp/problems/ALDS1_1_A"),
            ),
        ).toBe("en");
    });
});

describe("buildAojDescriptionUrl", () => {
    it("builds the v1 statement URL with the requested language", () => {
        expect(buildAojDescriptionUrl("ALDS1_1_A", "ja").href).toBe(
            "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ALDS1_1_A&lang=ja",
        );
        expect(buildAojDescriptionUrl("0001", "en").href).toBe(
            "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=0001&lang=en",
        );
    });
});

describe("parseAojProblem", () => {
    it("parses the title and paired samples", () => {
        const problem = parseAojProblem(
            createProblemHtml({
                samples: [
                    { number: 1, input: "2", output: "8" },
                    { number: 2, input: "3", output: "27" },
                ],
            }),
            "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ITP1_1_B",
        );

        expect(problem.title).toBe("X Cubic");
        expect(problem.samples).toEqual([
            { input: "2", output: "8" },
            { input: "3", output: "27" },
        ]);
    });

    it("orders samples by their number, not by appearance", () => {
        const problem = parseAojProblem(
            createProblemHtml({
                samples: [
                    { number: 2, input: "3", output: "27" },
                    { number: 1, input: "2", output: "8" },
                ],
            }),
            "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ITP1_1_B",
        );

        expect(problem.samples.map((sample) => sample.input)).toEqual(["2", "3"]);
    });

    it("normalizes CRLF line endings", () => {
        const problem = parseAojProblem(
            createProblemHtml({
                samples: [{ number: 1, input: "1\r\n2\r\n3", output: "6" }],
            }),
            "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ITP1_1_B",
        );

        expect(problem.samples[0]?.input).toBe("1\n2\n3");
    });

    it("returns no samples for a page without sample headings", () => {
        const problem = parseAojProblem(
            createProblemHtml({ samples: [] }),
            "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ITP1_1_B",
        );

        expect(problem.samples).toEqual([]);
    });

    it("throws when a sample lacks its counterpart or pre", () => {
        expect(() =>
            parseAojProblem(
                `
                <html><body><div class="description">
                    <H1>X Cubic</H1>
                    <H2>Sample Input 1</H2>
                    <pre>2</pre>
                    <H2>Sample Output 1</H2>
                    <pre>8</pre>
                    <H2>Sample Output 3</H2>
                    <pre>125</pre>
                </div></body></html>
            `,
                "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ITP1_1_B",
            ),
        ).toThrow("AOJ sample 3 is missing its input or output.");

        const broken = createProblemHtml({}).replace(/<pre>\s*2\s*<\/pre>/u, "<code>2</code>");
        expect(() =>
            parseAojProblem(
                broken,
                "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ITP1_1_B",
            ),
        ).toThrow("AOJ sample 1 content was not found.");
    });

    it("throws when the title is missing", () => {
        expect(() =>
            parseAojProblem(
                '<html><body><div class="description"><p>no title</p></div></body></html>',
                "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ITP1_1_B",
            ),
        ).toThrow("AOJ problem title was not found in the response.");
    });
});

describe("AojClient", () => {
    describe("getProblem", () => {
        it("parses the v1 problem page fixture", async () => {
            const html = await Bun.file("test/fixtures/aoj-problem.html").text();
            let requestedUrl: URL | undefined;
            setFetch((input) => {
                requestedUrl = new URL(input.toString());
                return Promise.resolve(htmlResponse(html));
            });

            const problem = await new AojClient().getProblem(
                "https://onlinejudge.u-aizu.ac.jp/courses/lesson/1/ALDS1/1/ALDS1_1_A",
            );

            expect(requestedUrl?.href).toBe(
                "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ALDS1_1_A&lang=en",
            );
            expect(requestedUrl?.origin).toBe("https://judge.u-aizu.ac.jp");
            expect(problem.title).toBe("Example Problem");
            expect(problem.samples).toEqual([
                { input: "1", output: "2" },
                { input: "3", output: "6" },
            ]);
            expect(problem.url).toBe(
                "https://onlinejudge.u-aizu.ac.jp/courses/lesson/1/ALDS1/1/ALDS1_1_A",
            );
        });

        it("keeps the lang parameter of a v1 URL", async () => {
            let requestedUrl: URL | undefined;
            setFetch((input) => {
                requestedUrl = new URL(input.toString());
                return Promise.resolve(htmlResponse(createProblemHtml({ title: "x の 3 乗" })));
            });

            const problem = await new AojClient().getProblem(
                "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ITP1_1_B&lang=ja",
            );

            expect(requestedUrl?.searchParams.get("lang")).toBe("ja");
            expect(problem.title).toBe("x の 3 乗");
        });

        it("rejects unsupported URLs without fetching", async () => {
            let called = false;
            setFetch(() => {
                called = true;
                throw new Error("fetch should not be called");
            });

            await expect(
                new AojClient().getProblem("https://judge.u-aizu.ac.jp/index.jsp"),
            ).rejects.toThrow("Expected an AOJ problem URL");
            expect(called).toBe(false);
        });

        it("throws when the problem request fails", async () => {
            setFetch(() => Promise.resolve(htmlResponse("not found", 404)));

            const error = await new AojClient()
                .getProblem("https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=NO_PROBLEM")
                .catch((caught: unknown) => caught);
            expect(error instanceof AojProblemRequestError).toBe(true);
            expect((error as AojProblemRequestError).status).toBe(404);
        });

        it("reports redirects instead of following them", async () => {
            setFetch(() => Promise.resolve(htmlResponse("", 302)));

            await expect(
                new AojClient().getProblem(
                    "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ALDS1_1_A",
                ),
            ).rejects.toThrow("AOJ redirected the problem request (302).");
        });
    });
});

describe("deriveProblemKey for AOJ", () => {
    it("maps v1 and v2 URLs of one problem to the same key", () => {
        const v1 = deriveProblemKey(
            "https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=ALDS1_1_A",
        );
        const v2 = deriveProblemKey(
            "https://onlinejudge.u-aizu.ac.jp/courses/lesson/1/ALDS1/1/ALDS1_1_A",
        );

        expect(v1).toEqual({ platform: "aoj", slug: "ALDS1_1_A" });
        expect(v2).toEqual(v1);
    });
});
