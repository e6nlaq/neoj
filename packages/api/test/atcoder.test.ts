import { afterEach, describe, expect, it } from "bun:test";

import { USER_AGENT } from "@neoj/api";
import {
    AtCoderClient,
    AtCoderProblemRequestError,
    buildAtCoderSubmitUrl,
    normalizeRevelSession,
    parseAtCoderLatestSubmission,
    parseAtCoderSubmitPage,
} from "@neoj/api/atcoder";

const problemUrl = "https://atcoder.jp/contests/abc001/tasks/abc001_1";
const formatContestTime = (date: Date) =>
    date.toISOString().replace("T", " ").replace("Z", "+0000");
const contestStartTime = new Date(Date.now() - 60_000);
const contestEndTime = new Date(Date.now() + 60_000);
const expectedContestStartTime = Temporal.Instant.from(contestStartTime.toISOString());
const expectedContestEndTime = Temporal.Instant.from(contestEndTime.toISOString());
const problemHtml = createProblemHtml(
    formatContestTime(contestStartTime),
    formatContestTime(contestEndTime),
);

function createProblemHtml(startTime: string, endTime: string): string {
    return `
    <html>
        <head><title>A - Sample &amp; Problem</title></head>
        <body>
            <div id="contest-nav-tabs">
                <small class="contest-duration">
                    <time class="fixtime-full">${startTime}</time>
                    -
                    <time class="fixtime-full">${endTime}</time>
                </small>
            </div>
            <div id="task-statement">
                <div class="part">
                    <h3>入力例 2</h3>
                    <section><pre>
15 &amp; 10
</pre></section>
                </div>
                <div class="part">
                    <h3>出力例 2</h3>
                    <section><pre>
5 &lt; 6
</pre></section>
                </div>
                <div class="part">
                    <h3>Sample Input 1</h3>
                    <section><pre>foo</pre></section>
                </div>
                <div class="part">
                    <h3>Sample Output 1</h3>
                    <section><pre>bar</pre></section>
                </div>
            </div>
        </body>
    </html>
`;
}

const originalFetch = globalThis.fetch;
type FetchHandler = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

function setFetch(handler: FetchHandler): void {
    globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect });
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("normalizeRevelSession", () => {
    it("strips the cookie name and surrounding whitespace", () => {
        expect(normalizeRevelSession("  REVEL_SESSION=abc%00def/+=  ")).toBe("abc%00def/+=");
    });

    it("rejects an empty value", () => {
        expect(() => normalizeRevelSession("REVEL_SESSION=")).toThrow(
            "REVEL_SESSION cannot be empty.",
        );
    });

    it("rejects characters that cannot appear in a cookie", () => {
        expect(() => normalizeRevelSession("abc;def")).toThrow(
            "REVEL_SESSION contains invalid characters.",
        );
        expect(() => normalizeRevelSession("abc\ndef")).toThrow(
            "REVEL_SESSION contains invalid characters.",
        );
    });

    it("rejects malformed percent-encoding", () => {
        expect(() => normalizeRevelSession("abc%")).toThrow(
            "REVEL_SESSION is not valid percent-encoding.",
        );
    });
});

describe("AtCoderClient", () => {
    describe("login", () => {
        it("retains the csrf_token from the encoded session cookie", async () => {
            const requests: Array<{ cookie: string | null }> = [];
            setFetch(async (_input, init) => {
                requests.push({ cookie: new Headers(init?.headers).get("Cookie") });
                return new Response(null, { status: 200 });
            });
            const client = new AtCoderClient();
            const session =
                "REVEL_SESSION=opaque-%00w%3Afalse%00%00csrf_token%3Atest%2Btoken%3D%00";

            await expect(client.login(session)).resolves.toBe(true);

            expect(client.csrfToken).toBe("test+token=");
            expect(requests).toEqual([
                { cookie: `REVEL_SESSION=${session.slice("REVEL_SESSION=".length)}` },
            ]);
        });

        it("sends the session cookie and succeeds without a redirect", async () => {
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
                return new Response(null, { status: 200 });
            });

            await expect(new AtCoderClient().login("test-session")).resolves.toBe(true);

            expect(requests).toEqual([
                {
                    url: "https://atcoder.jp/settings",
                    cookie: "REVEL_SESSION=test-session",
                    redirect: "manual",
                },
            ]);
        });

        it("reads the account name from the login check page", async () => {
            setFetch(
                async () =>
                    new Response('<script>var userScreenName = "kenkoooo";</script>', {
                        status: 200,
                    }),
            );
            const client = new AtCoderClient();

            await expect(client.login("test-session")).resolves.toBe(true);

            expect(client.username).toBe("kenkoooo");
        });

        it("leaves the account name undefined when the page omits it", async () => {
            setFetch(async () => new Response(null, { status: 200 }));
            const client = new AtCoderClient();

            await expect(client.login("test-session")).resolves.toBe(true);

            expect(client.username).toBeUndefined();
        });

        it("clears the account name when a later login fails", async () => {
            setFetch(async () => new Response('<script>var userScreenName = "kenkoooo";</script>'));
            const client = new AtCoderClient();
            await client.login("test-session");

            setFetch(
                async () => new Response(null, { status: 302, headers: { Location: "/login" } }),
            );
            await expect(client.login("expired-session")).resolves.toBe(false);

            expect(client.username).toBeUndefined();
        });

        it("rejects a redirected login and clears the session", async () => {
            const requests: Array<{ url: string; cookie: string | null }> = [];
            let loginAttempts = 0;
            setFetch(async (input, init) => {
                requests.push({
                    url: String(input),
                    cookie: new Headers(init?.headers).get("Cookie"),
                });
                if (String(input).endsWith("/settings")) {
                    loginAttempts += 1;
                    if (loginAttempts === 1) {
                        return new Response(null, { status: 200 });
                    }
                    return new Response(null, {
                        status: 302,
                        headers: { Location: "/login" },
                    });
                }
                return new Response(problemHtml, { status: 200 });
            });

            const client = new AtCoderClient();
            await expect(client.login("opaque-%00csrf_token%3Aold-token%00")).resolves.toBe(true);
            expect(client.csrfToken).toBe("old-token");
            await expect(client.login("invalid-session")).resolves.toBe(false);
            expect(client.csrfToken).toBeUndefined();
            await client.getProblem(problemUrl);

            expect(requests[2]?.cookie).toBeNull();
        });

        it("rejects an invalid session before contacting AtCoder", async () => {
            let fetched = false;
            setFetch(async () => {
                fetched = true;
                return new Response(null, { status: 200 });
            });

            await expect(new AtCoderClient().login("abc;def")).rejects.toThrow(
                "REVEL_SESSION contains invalid characters.",
            );
            expect(fetched).toBe(false);
        });

        it("sends a User-Agent header and a request timeout", async () => {
            let requestInit: RequestInit | undefined;
            setFetch(async (_input, init) => {
                requestInit = init;
                return new Response(null, { status: 200 });
            });

            await new AtCoderClient().login("test-session");

            expect(new Headers(requestInit?.headers).get("User-Agent")).toBe(USER_AGENT);
            expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
        });

        it("reports connection failures as actionable errors", async () => {
            setFetch(async () => {
                throw new TypeError("fetch failed");
            });

            await expect(new AtCoderClient().login("test-session")).rejects.toThrow(
                "Failed to connect to AtCoder.",
            );
        });

        it("reports timeouts as timeouts", async () => {
            setFetch(async () => {
                throw new DOMException("The operation timed out.", "TimeoutError");
            });

            await expect(new AtCoderClient().login("test-session")).rejects.toThrow(
                "AtCoder request timed out after 15 seconds. Check your connection and try again.",
            );
        });
    });

    describe("getProblem", () => {
        it("parses the problem title and ordered Japanese and English samples", async () => {
            setFetch(async () => new Response(problemHtml, { status: 200 }));

            const problem = await new AtCoderClient().getProblem(problemUrl);

            expect(problem).toEqual({
                url: problemUrl,
                title: "A - Sample & Problem",
                startTime: expectedContestStartTime,
                endTime: expectedContestEndTime,
                samples: [
                    { input: "foo", output: "bar" },
                    { input: "15 & 10", output: "5 < 6" },
                ],
            });
        });

        it("returns contest times in the year 3000 or later", async () => {
            const startTime = formatContestTime(new Date(Date.now() - 60_000));
            const endTime = "3000-01-01 00:00:00+0000";
            setFetch(
                async () => new Response(createProblemHtml(startTime, endTime), { status: 200 }),
            );

            const problem = await new AtCoderClient().getProblem(problemUrl);

            expect(problem.endTime).toEqual(Temporal.Instant.from("3000-01-01T00:00:00Z"));
        });

        it("normalizes CRLF line endings in sample input and output", async () => {
            const html = problemHtml
                .replace("15 &amp; 10", "15\r\n&amp; 10")
                .replace("5 &lt; 6", "5\r\n&lt; 6");
            setFetch(async () => new Response(html, { status: 200 }));

            const problem = await new AtCoderClient().getProblem(problemUrl);

            expect(problem.samples[1]).toEqual({
                input: "15\n& 10",
                output: "5\n< 6",
            });
        });

        it("sends the logged-in session cookie with the problem request", async () => {
            const requests: Array<{ url: string; cookie: string | null }> = [];
            setFetch(async (input, init) => {
                requests.push({
                    url: String(input),
                    cookie: new Headers(init?.headers).get("Cookie"),
                });
                return new Response(problemHtml, { status: 200 });
            });

            const client = new AtCoderClient();
            await client.login("test-session");
            requests.length = 0;

            await client.getProblem(problemUrl);

            expect(requests).toEqual([{ url: problemUrl, cookie: "REVEL_SESSION=test-session" }]);
        });

        it("rejects URLs outside AtCoder task pages without fetching", async () => {
            let fetched = false;
            setFetch(async () => {
                fetched = true;
                return new Response(problemHtml, { status: 200 });
            });

            for (const url of [
                "https://example.com/contests/abc001/tasks/abc001_1",
                "https://user:pass@atcoder.jp/contests/abc001/tasks/abc001_1",
            ]) {
                await expect(new AtCoderClient().getProblem(url)).rejects.toThrow(
                    "Expected an AtCoder contest task URL.",
                );
            }
            expect(fetched).toBe(false);
        });

        it("throws when the problem request fails", async () => {
            setFetch(async () => new Response("Not found", { status: 404 }));

            await expect(new AtCoderClient().getProblem(problemUrl)).rejects.toBeInstanceOf(
                AtCoderProblemRequestError,
            );
            await expect(new AtCoderClient().getProblem(problemUrl)).rejects.toMatchObject({
                message: "AtCoder problem request failed (404).",
                status: 404,
            });
        });
    });
});

const submitHtml = `
    <html>
        <body>
            <form action="/contests/abc001/submit" method="post">
                <input type="hidden" name="csrf_token" value="csrf-token">
                <input type="hidden" name="data.TaskScreenName" value="abc001_1">
                <select name="data.LanguageId">
                    <option value="">Choose a language</option>
                    <optgroup label="C++">
                        <option value="5001">C++ 20 (gcc 12.2.0)</option>
                    </optgroup>
                    <optgroup label="Python">
                        <option value="5002">Python (CPython 3.11.4)</option>
                    </optgroup>
                </select>
                <div class="cf-turnstile" data-sitekey="test"></div>
            </form>
        </body>
    </html>
`;

describe("AtCoder submission helpers", () => {
    it("builds a submit URL that preselects the task", () => {
        expect(buildAtCoderSubmitUrl(problemUrl).href).toBe(
            "https://atcoder.jp/contests/abc001/submit?taskScreenName=abc001_1",
        );
    });

    it("parses the form, languages, groups, and Turnstile", () => {
        const page = parseAtCoderSubmitPage(
            submitHtml,
            "https://atcoder.jp/contests/abc001/submit",
            {
                contestId: "abc001",
                taskId: "abc001_1",
            },
        );

        expect(page.csrfToken).toBe("csrf-token");
        expect(page.taskScreenName).toBe("abc001_1");
        expect(page.hasTurnstile).toBe(true);
        expect(page.languages).toEqual([
            { id: "5001", name: "C++ 20 (gcc 12.2.0)", group: "C++" },
            { id: "5002", name: "Python (CPython 3.11.4)", group: "Python" },
        ]);
    });

    it("rejects a form without a CSRF token", () => {
        expect(() =>
            parseAtCoderSubmitPage("<html></html>", "https://atcoder.jp/contests/abc001/submit", {
                contestId: "abc001",
                taskId: "abc001_1",
            }),
        ).toThrow("AtCoder submit page did not contain a CSRF token");
    });

    it("finds the newest submission link on a submissions page", () => {
        const html = `
            <table>
                <tr><td><a href="/contests/abc001/submissions/123456">123456</a></td></tr>
                <tr><td><a href="/contests/abc001/submissions/123455">123455</a></td></tr>
            </table>
        `;

        expect(parseAtCoderLatestSubmission(html, "abc001")).toBe("123456");
        expect(parseAtCoderLatestSubmission("<html></html>", "abc001")).toBeUndefined();
    });
});

describe("AtCoderClient submission requests", () => {
    it("fetches the submit page with the session cookie and task query", async () => {
        const requests: Array<{ url: string; cookie: string | null }> = [];
        setFetch(async (input, init) => {
            requests.push({
                url: String(input),
                cookie: new Headers(init?.headers).get("Cookie"),
            });
            if (String(input).endsWith("/settings")) {
                return new Response(null, { status: 200 });
            }
            return new Response(submitHtml, { status: 200 });
        });

        const client = new AtCoderClient();
        await client.login("test-session");
        requests.length = 0;

        const page = await client.getSubmitPage(problemUrl);

        expect(page.languages).toHaveLength(2);
        expect(requests).toEqual([
            {
                url: "https://atcoder.jp/contests/abc001/submit?taskScreenName=abc001_1",
                cookie: "REVEL_SESSION=test-session",
            },
        ]);
    });

    it("reports a redirected submit page as a login problem", async () => {
        setFetch(async () => new Response(null, { status: 302, headers: { Location: "/login" } }));

        await expect(new AtCoderClient().getSubmitPage(problemUrl)).rejects.toThrow(
            'AtCoder redirected the submit page (302). Log in again with "neoj login atcoder".',
        );
    });

    it("posts the form and reads the newest submission", async () => {
        const page = parseAtCoderSubmitPage(
            submitHtml.replace('<div class="cf-turnstile" data-sitekey="test"></div>', ""),
            "https://atcoder.jp/contests/abc001/submit?taskScreenName=abc001_1",
            { contestId: "abc001", taskId: "abc001_1" },
        );
        const requests: Array<{
            url: string;
            method: string | undefined;
            cookie: string | null;
            body: URLSearchParams | undefined;
        }> = [];
        setFetch(async (input, init) => {
            if (init?.method === "POST") {
                requests.push({
                    url: String(input),
                    method: init.method,
                    cookie: new Headers(init.headers).get("Cookie"),
                    body: init.body instanceof URLSearchParams ? init.body : undefined,
                });
                return new Response(null, {
                    status: 302,
                    headers: { Location: "/contests/abc001/submissions/me" },
                });
            }

            return new Response('<a href="/contests/abc001/submissions/123456">123456</a>', {
                status: 200,
            });
        });

        const client = new AtCoderClient();
        await client.login("test-session");
        const result = await client.submit(problemUrl, "5001", "int main() {}", page);

        expect(result).toEqual({
            submissionId: "123456",
            submissionUrl: "https://atcoder.jp/contests/abc001/submissions/123456",
        });
        expect(requests).toEqual([
            {
                url: "https://atcoder.jp/contests/abc001/submit?taskScreenName=abc001_1",
                method: "POST",
                cookie: "REVEL_SESSION=test-session",
                body: expect.any(URLSearchParams),
            },
        ]);
        expect(requests[0]?.body?.get("csrf_token")).toBe("csrf-token");
        expect(requests[0]?.body?.get("data.TaskScreenName")).toBe("abc001_1");
        expect(requests[0]?.body?.get("data.LanguageId")).toBe("5001");
        expect(requests[0]?.body?.get("sourceCode")).toBe("int main() {}");
    });

    it("uses a submission ID from the redirect when AtCoder returns one", async () => {
        const page = parseAtCoderSubmitPage(
            submitHtml,
            "https://atcoder.jp/contests/abc001/submit",
            {
                contestId: "abc001",
                taskId: "abc001_1",
            },
        );
        setFetch(
            async () =>
                new Response(null, {
                    status: 302,
                    headers: { Location: "/contests/abc001/submissions/987654" },
                }),
        );

        await expect(
            new AtCoderClient().submit(problemUrl, "5001", "source", page),
        ).resolves.toEqual({
            submissionId: "987654",
            submissionUrl: "https://atcoder.jp/contests/abc001/submissions/987654",
        });
    });

    it("reports an unknown language ID before posting the form", async () => {
        const page = parseAtCoderSubmitPage(
            submitHtml,
            "https://atcoder.jp/contests/abc001/submit",
            {
                contestId: "abc001",
                taskId: "abc001_1",
            },
        );
        const requests: string[] = [];
        setFetch(async (input) => {
            requests.push(String(input));
            return new Response(null, {
                status: 302,
                headers: { Location: "/contests/abc001/submissions/me" },
            });
        });

        await expect(
            new AtCoderClient().submit(problemUrl, "9999", "source", page),
        ).rejects.toThrow(
            'AtCoder does not recognize the language ID "9999". Set a valid ID with "neoj languages atcoder", --platform-language, or languages.<key>.submit.atcoder.',
        );
        expect(requests).toEqual([]);
    });

    it("reports a Turnstile rejection with a browser fallback", async () => {
        const page = parseAtCoderSubmitPage(
            submitHtml,
            "https://atcoder.jp/contests/abc001/submit",
            {
                contestId: "abc001",
                taskId: "abc001_1",
            },
        );
        setFetch(async () => new Response(submitHtml, { status: 200 }));

        await expect(
            new AtCoderClient().submit(problemUrl, "5001", "source", page),
        ).rejects.toThrow("AtCoder rejected the submission because of Turnstile.");
    });

    it("reports a non-redirect rejection with an actionable URL", async () => {
        const page = parseAtCoderSubmitPage(
            submitHtml,
            "https://atcoder.jp/contests/abc001/submit",
            {
                contestId: "abc001",
                taskId: "abc001_1",
            },
        );
        setFetch(async () => new Response("<html>error</html>", { status: 200 }));

        await expect(
            new AtCoderClient().submit(problemUrl, "5001", "source", page),
        ).rejects.toThrow(
            "Open https://atcoder.jp/contests/abc001/submit in your browser and submit from there.",
        );
    });
});

describe("AtCoderClient contest languages", () => {
    it("lists the languages from a contest submit page without a task", async () => {
        const requests: Array<{ url: string; cookie: string | null }> = [];
        setFetch(async (input, init) => {
            requests.push({
                url: String(input),
                cookie: new Headers(init?.headers).get("Cookie"),
            });
            if (String(input).endsWith("/settings")) {
                return new Response(null, { status: 200 });
            }
            return new Response(submitHtml, { status: 200 });
        });

        const client = new AtCoderClient();
        await client.login("test-session");
        requests.length = 0;

        const languages = await client.getLanguagesForContest("abc001");

        expect(languages).toEqual([
            { id: "5001", name: "C++ 20 (gcc 12.2.0)", group: "C++" },
            { id: "5002", name: "Python (CPython 3.11.4)", group: "Python" },
        ]);
        expect(requests).toEqual([
            {
                url: "https://atcoder.jp/contests/abc001/submit",
                cookie: "REVEL_SESSION=test-session",
            },
        ]);
    });

    it("lists languages from unnamed per-task selects on the contest submit page", async () => {
        const html = `
            <form>
                <select id="select-task" name="data.TaskScreenName">
                    <option value="abc001_a">A</option>
                </select>
                <div id="select-lang" data-name="data.LanguageId">
                    <div id="select-lang-abc001_a">
                        <select>
                            <option></option>
                            <option value="6001">C++23 (GCC 15.2.0)</option>
                            <option value="6002">Python (CPython 3.13.7)</option>
                        </select>
                    </div>
                    <div id="select-lang-abc001_b">
                        <select>
                            <option></option>
                            <option value="6001">C++23 (GCC 15.2.0)</option>
                            <option value="6002">Python (CPython 3.13.7)</option>
                        </select>
                    </div>
                </div>
            </form>
        `;
        setFetch(async () => new Response(html, { status: 200 }));

        const languages = await new AtCoderClient().getLanguagesForContest("abc001");

        expect(languages).toEqual([
            { id: "6001", name: "C++23 (GCC 15.2.0)", group: undefined },
            { id: "6002", name: "Python (CPython 3.13.7)", group: undefined },
        ]);
    });

    it("reports a redirected contest submit page as a login problem", async () => {
        setFetch(async () => new Response(null, { status: 302, headers: { Location: "/login" } }));

        await expect(new AtCoderClient().getLanguagesForContest("abc001")).rejects.toThrow(
            'AtCoder redirected the submit page (302). Log in again with "neoj login atcoder".',
        );
    });

    it("rejects an invalid contest ID before requesting", async () => {
        setFetch(async () => {
            throw new Error("should not fetch");
        });

        await expect(new AtCoderClient().getLanguagesForContest("../login")).rejects.toThrow(
            'Invalid AtCoder contest ID: "../login".',
        );
    });
});
