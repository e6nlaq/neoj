import { afterEach, describe, expect, it } from "bun:test";

import { AtCoderClient } from "@/lib/service/atcoder";

const problemUrl = "https://atcoder.jp/contests/abc001/tasks/abc001_1";
const formatContestTime = (date: Date) =>
    date.toISOString().replace("T", " ").replace("Z", "+0000");
const problemHtml = createProblemHtml(
    formatContestTime(new Date(Date.now() - 60_000)),
    formatContestTime(new Date(Date.now() + 60_000)),
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

describe("AtCoderClient", () => {
    describe("login", () => {
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
                    url: "https://atcoder.jp/contests/abc100/submit",
                    cookie: "REVEL_SESSION=test-session",
                    redirect: "manual",
                },
            ]);
        });

        it("rejects a redirected login and clears the session", async () => {
            const requests: Array<{ url: string; cookie: string | null }> = [];
            setFetch(async (input, init) => {
                requests.push({
                    url: String(input),
                    cookie: new Headers(init?.headers).get("Cookie"),
                });
                if (String(input).endsWith("/submit")) {
                    return new Response(null, {
                        status: 302,
                        headers: { Location: "/login" },
                    });
                }
                return new Response(problemHtml, { status: 200 });
            });

            const client = new AtCoderClient();
            await expect(client.login("invalid-session")).resolves.toBe(false);
            await client.getProblem(problemUrl);

            expect(requests[1]?.cookie).toBeNull();
        });
    });

    describe("getProblem", () => {
        it("parses the problem title and ordered Japanese and English samples", async () => {
            setFetch(async () => new Response(problemHtml, { status: 200 }));

            const problem = await new AtCoderClient().getProblem(problemUrl);

            expect(problem).toEqual({
                url: problemUrl,
                title: "A - Sample & Problem",
                isContestRunning: true,
                samples: [
                    { input: "foo", output: "bar" },
                    { input: "15 & 10", output: "5 < 6" },
                ],
            });
        });

        it("returns false when the contest end time is in the year 3000 or later", async () => {
            const startTime = formatContestTime(new Date(Date.now() - 60_000));
            const endTime = "3000-01-01 00:00:00+0000";
            setFetch(
                async () => new Response(createProblemHtml(startTime, endTime), { status: 200 }),
            );

            const problem = await new AtCoderClient().getProblem(problemUrl);

            expect(problem.isContestRunning).toBe(false);
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

            await expect(
                new AtCoderClient().getProblem(
                    "https://example.com/contests/abc001/tasks/abc001_1",
                ),
            ).rejects.toThrow("Expected an AtCoder contest task URL.");
            expect(fetched).toBe(false);
        });

        it("throws when the problem request fails", async () => {
            setFetch(async () => new Response("Not found", { status: 404 }));

            await expect(new AtCoderClient().getProblem(problemUrl)).rejects.toThrow(
                "AtCoder problem request failed (404).",
            );
        });
    });
});
