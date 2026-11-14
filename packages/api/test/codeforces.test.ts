import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import { deriveProblemKey, USER_AGENT } from "@neoj/api";
import {
    buildCodeforcesContestUrl,
    buildCodeforcesProblemUrl,
    buildCodeforcesSubmitUrl,
    CodeforcesBlockedError,
    CodeforcesClient,
    CodeforcesProblemRequestError,
    extractCodeforcesProblemRoute,
    isCodeforcesBlockedPage,
    normalizeCodeforcesSession,
    parseCodeforcesAccount,
    parseCodeforcesLanguages,
    parseCodeforcesProblem,
    parseCodeforcesProblemUrl,
    stripCodeforcesTitleIndex,
} from "@neoj/api/codeforces";

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
            const html = await Bun.file(
                join(import.meta.dir, "fixtures", "codeforces-problem.html"),
            ).text();
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
            expect(userAgent).toBe(USER_AGENT);
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

        it("reports a browser check instead of a missing problem statement", async () => {
            setFetch(() => Promise.resolve(htmlResponse("<title>Just a moment...</title>", 403)));

            const error = await new CodeforcesClient()
                .getProblem("https://codeforces.com/contest/1900/problem/B")
                .catch((caught: unknown) => caught);

            expect(error instanceof CodeforcesBlockedError).toBe(true);
            expect((error as Error).message).toContain("returned a browser check");
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

const loginPageHtml = `
    <html><body>
        <div class="lang-chooser">
            <div><a href="/profile/tourist">tourist</a><a href="/logout">Logout</a></div>
        </div>
    </body></html>
`;

const signedOutPageHtml = `
    <html><body>
        <div class="lang-chooser">
            <div><a href="/enter">Enter</a><a href="/register">Register</a></div>
        </div>
    </body></html>
`;

const submitHtml = `
    <html>
        <head><meta name="X-Csrf-Token" content="meta-token"></head>
        <body>
            <div class="lang-chooser">
                <div><a href="/profile/tourist">tourist</a><a href="/logout">Logout</a></div>
            </div>
            <form class="submit-form" action="?csrf_token=form-token" method="post">
                <input type="hidden" name="csrf_token" value="form-token">
                <input type="hidden" name="ftaa" value="">
                <input type="hidden" name="bfaa" value="">
                <select name="programTypeId">
                    <option value="">Choose language</option>
                    <option value="54">GNU G++17 7.3.0</option>
                    <option value="73">GNU G++20 13.2</option>
                </select>
                <textarea name="source"></textarea>
            </form>
        </body>
    </html>
`;

describe("normalizeCodeforcesSession", () => {
    it("trims values and accepts a name=value pair", () => {
        expect(
            normalizeCodeforcesSession({
                jsessionId: "  JSESSIONID=abc123  ",
                ftaa: " 70a7c28f3de=xyz789 ",
            }),
        ).toEqual({ jsessionId: "abc123", ftaa: "xyz789" });
    });

    it("rejects empty and header-breaking values", () => {
        expect(() => normalizeCodeforcesSession({ jsessionId: " ", ftaa: "ftaa" })).toThrow(
            "JSESSIONID cannot be empty.",
        );
        expect(() => normalizeCodeforcesSession({ jsessionId: "abc", ftaa: "abc;def" })).toThrow(
            "70a7c28f3de contains invalid characters.",
        );
        expect(() => normalizeCodeforcesSession({ jsessionId: "abc", ftaa: "abc%zz" })).toThrow(
            "70a7c28f3de is not valid percent-encoding.",
        );
    });
});

describe("parseCodeforcesAccount", () => {
    it("reads the handle and the signed-in navigation", () => {
        expect(parseCodeforcesAccount(loginPageHtml)).toEqual({
            username: "tourist",
            signedIn: true,
        });
    });

    it("reports a signed-out page without a handle", () => {
        expect(parseCodeforcesAccount(signedOutPageHtml)).toEqual({
            username: undefined,
            signedIn: false,
        });
    });

    it("falls back to the handle variable", () => {
        expect(parseCodeforcesAccount('<script>handle = "benq";</script>')).toEqual({
            username: "benq",
            signedIn: true,
        });
    });
});

describe("parseCodeforcesLanguages", () => {
    it("reads the language select of the submission form", () => {
        expect(parseCodeforcesLanguages(submitHtml)).toEqual([
            { id: "54", name: "GNU G++17 7.3.0" },
            { id: "73", name: "GNU G++20 13.2" },
        ]);
    });

    it("rejects a page without a language select", () => {
        expect(() => parseCodeforcesLanguages("<html></html>")).toThrow(
            "Codeforces language list was not found in the submit page response.",
        );
    });

    it("rejects a language select without options", () => {
        expect(() =>
            parseCodeforcesLanguages(
                '<html><body><select name="programTypeId"><option value="">pick</option></select></body></html>',
            ),
        ).toThrow("Codeforces language list was empty in the submit page response.");
    });
});

describe("Codeforces URL and page helpers", () => {
    it("builds the submit URL from the route", () => {
        const route = extractCodeforcesProblemRoute(
            "https://codeforces.com/problemset/problem/1900/B",
        );

        expect(buildCodeforcesSubmitUrl(route).href).toBe(
            "https://codeforces.com/contest/1900/submit",
        );
    });

    it("detects Cloudflare and RCPC browser checks", () => {
        expect(isCodeforcesBlockedPage("<title>Just a moment...</title>")).toBe(true);
        expect(isCodeforcesBlockedPage("Please wait. Your browser is being checked.")).toBe(true);
        expect(isCodeforcesBlockedPage('<script src="/aes.min.js"></script>slowAES.decrypt')).toBe(
            true,
        );
        expect(isCodeforcesBlockedPage(loginPageHtml)).toBe(false);
    });
});

describe("CodeforcesClient session requests", () => {
    it("validates the cookies against /settings/general and reads the handle", async () => {
        const requests: Array<{
            url: string;
            cookie: string | null;
            redirect: string | undefined;
        }> = [];
        setFetch(async (input, init) => {
            requests.push({
                url: String(input),
                cookie: new Headers(init?.headers).get("Cookie"),
                redirect: init?.redirect,
            });
            return new Response(loginPageHtml, { status: 200 });
        });

        const client = new CodeforcesClient();
        await expect(client.login({ jsessionId: "abc", ftaa: "xyz" })).resolves.toBe(true);

        expect(client.username).toBe("tourist");
        expect(client.session).toEqual({ jsessionId: "abc", ftaa: "xyz" });
        expect(requests).toEqual([
            {
                url: "https://codeforces.com/settings/general",
                cookie: "JSESSIONID=abc; 70a7c28f3de=xyz",
                redirect: "manual",
            },
        ]);
    });

    it("treats a redirect as a signed-out session", async () => {
        setFetch(async () => new Response(null, { status: 302, headers: { Location: "/enter" } }));

        const client = new CodeforcesClient();
        await expect(client.login({ jsessionId: "abc", ftaa: "xyz" })).resolves.toBe(false);

        expect(client.session).toBeUndefined();
    });

    it("throws a blocked error when Cloudflare answers", async () => {
        setFetch(async () => new Response("<title>Just a moment...</title>", { status: 403 }));

        const error = await new CodeforcesClient()
            .login({ jsessionId: "abc", ftaa: "xyz" })
            .catch((caught: unknown) => caught);

        expect(error instanceof CodeforcesBlockedError).toBe(true);
        expect((error as Error).message).toContain("returned a browser check");
    });

    it("keeps rotated Set-Cookie values", async () => {
        setFetch(
            async () =>
                new Response(loginPageHtml, {
                    status: 200,
                    headers: [
                        ["set-cookie", "JSESSIONID=rotated; Path=/; Secure"],
                        [
                            "set-cookie",
                            "70a7c28f3de=rotated-ftaa; Expires=Wed, 21 Oct 2030 07:28:00 GMT",
                        ],
                    ],
                }),
        );

        const client = new CodeforcesClient();
        await client.login({ jsessionId: "abc", ftaa: "xyz" });

        expect(client.session).toEqual({ jsessionId: "rotated", ftaa: "rotated-ftaa" });
    });

    it("rejects invalid cookies before fetching", async () => {
        let fetched = false;
        setFetch(async () => {
            fetched = true;
            return new Response(loginPageHtml);
        });

        await expect(
            new CodeforcesClient().login({ jsessionId: "abc", ftaa: "a b" }),
        ).rejects.toThrow("70a7c28f3de contains invalid characters.");
        expect(fetched).toBe(false);
    });

    it("reports a redirected submit page as a login problem", async () => {
        setFetch(async () => new Response(null, { status: 302, headers: { Location: "/enter" } }));

        await expect(new CodeforcesClient().getLanguagesForContest("1900")).rejects.toThrow(
            'Codeforces redirected the submit page (302). Log in again with "neoj login codeforces".',
        );
    });

    it("detects a signed-out submit page served with a 200", async () => {
        setFetch(async () => new Response(signedOutPageHtml, { status: 200 }));

        await expect(new CodeforcesClient().getLanguagesForContest("1900")).rejects.toThrow(
            'Codeforces rejected the request because the session is not logged in. Run "neoj login codeforces" and try again.',
        );
    });

    it("lists contest languages without a downloaded problem", async () => {
        let requestedUrl: string | undefined;
        setFetch(async (input) => {
            requestedUrl = String(input);
            return new Response(submitHtml, { status: 200 });
        });

        const languages = await new CodeforcesClient().getLanguagesForContest("1");

        expect(requestedUrl).toBe("https://codeforces.com/contest/1/submit");
        expect(languages.map((language) => language.id)).toEqual(["54", "73"]);
    });

    it("rejects an invalid contest ID before fetching", async () => {
        let called = false;
        setFetch(async () => {
            called = true;
            return new Response(submitHtml);
        });

        await expect(new CodeforcesClient().getLanguagesForContest("abc")).rejects.toThrow(
            'Invalid Codeforces contest ID: "abc".',
        );
        expect(called).toBe(false);
    });
});
