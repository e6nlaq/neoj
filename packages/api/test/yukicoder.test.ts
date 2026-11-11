import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import { USER_AGENT } from "@neoj/api";
import {
    fetchYukicoderContestUrl,
    normalizeYukicoderCredential,
    parseYukicoderProblemUrl,
    YukicoderClient,
    YukicoderProblemRequestError,
    type YukicoderDeviceCode,
} from "@neoj/api/yukicoder";

const originalFetch = globalThis.fetch;
type FetchHandler = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

function setFetch(handler: FetchHandler): void {
    globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect });
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function createProblemHtml(sampleContents = "3", sampleOutput = "6"): string {
    return `
        <html>
            <head><title> No.480 合計 - yukicoder</title></head>
            <body>
                <div id="content" data-problem-id="1480">
                    <div class="block">
                        <h4>サンプル</h4>
                        <div class="sample">
                            <h5>サンプル1</h5>
                            <div class="paragraph">
                                <h6>入力</h6>
                                <pre>${sampleContents}
</pre>
                                <h6>出力</h6>
                                <pre>${sampleOutput}
</pre>
                                <p>1+2+3=6です。</p>
                            </div>
                        </div>
                        <div class="sample">
                            <h5>サンプル2</h5>
                            <div class="paragraph">
                                <h6>入力</h6>
                                <pre>1 &amp; 2
</pre>
                                <h6>出力</h6>
                                <pre>3 &lt; 4
</pre>
                            </div>
                        </div>
                    </div>
                </div>
            </body>
        </html>
    `;
}

const deviceCode: YukicoderDeviceCode = {
    deviceCode: "ydc_secret",
    userCode: "WDJB-MJHT",
    verificationUri: "https://yukicoder.me/device",
    verificationUriComplete: "https://yukicoder.me/device?user_code=WDJB-MJHT",
    expiresIn: 600,
    interval: 5,
};

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("parseYukicoderProblemUrl", () => {
    it("accepts problem number and problem id URLs", () => {
        expect(parseYukicoderProblemUrl("https://yukicoder.me/problems/no/480").pathname).toBe(
            "/problems/no/480",
        );
        expect(
            parseYukicoderProblemUrl("https://yukicoder.me/problems/1/?from=list#sample").pathname,
        ).toBe("/problems/1/");
    });

    it("rejects other origins and pages", () => {
        for (const url of [
            "https://example.com/problems/no/480",
            "https://yukicoder.me/problems",
            "https://yukicoder.me/contests/157",
            "https://user:pass@yukicoder.me/problems/no/480",
        ]) {
            expect(() => parseYukicoderProblemUrl(url)).toThrow(
                "Expected a yukicoder problem URL.",
            );
        }
    });
});

describe("normalizeYukicoderCredential", () => {
    it("trims whitespace and removes a Bearer prefix", () => {
        expect(normalizeYukicoderCredential("  Bearer ysb_token  ")).toBe("ysb_token");
    });

    it("rejects empty and whitespace-containing credentials", () => {
        expect(() => normalizeYukicoderCredential("   ")).toThrow(
            "yukicoder credential cannot be empty.",
        );
        expect(() => normalizeYukicoderCredential("abc def")).toThrow(
            "yukicoder credential contains invalid characters.",
        );
    });
});

describe("YukicoderClient", () => {
    describe("getProblem", () => {
        it("parses the title and samples from the problem page", async () => {
            const requests: Array<{ url: string; userAgent: string | null }> = [];
            setFetch(async (input, init) => {
                requests.push({
                    url: String(input),
                    userAgent: new Headers(init?.headers).get("User-Agent"),
                });
                return new Response(createProblemHtml(), { status: 200 });
            });

            const problem = await new YukicoderClient().getProblem(
                "https://yukicoder.me/problems/no/480",
            );

            expect(problem).toEqual({
                url: "https://yukicoder.me/problems/no/480",
                title: "No.480 合計 - yukicoder",
                samples: [
                    { input: "3", output: "6" },
                    { input: "1 & 2", output: "3 < 4" },
                ],
            });
            expect(requests).toEqual([
                {
                    url: "https://yukicoder.me/problems/no/480",
                    userAgent: USER_AGENT,
                },
            ]);
        });

        it("parses the problem page fixture", async () => {
            const html = await Bun.file(
                join(import.meta.dir, "fixtures", "yukicoder-problem.html"),
            ).text();
            setFetch(async () => new Response(html, { status: 200 }));

            const problem = await new YukicoderClient().getProblem(
                "https://yukicoder.me/problems/no/480",
            );

            expect(problem.samples).toEqual([
                { input: "3", output: "6" },
                { input: "1", output: "1" },
                { input: "10", output: "55" },
            ]);
        });

        it("normalizes CRLF line endings", async () => {
            setFetch(
                async () => new Response(createProblemHtml("1\r\n2", "3\r\n4"), { status: 200 }),
            );

            const problem = await new YukicoderClient().getProblem(
                "https://yukicoder.me/problems/no/480",
            );

            expect(problem.samples[0]).toEqual({ input: "1\n2", output: "3\n4" });
        });

        it("throws when the response is not a problem page", async () => {
            setFetch(
                async () =>
                    new Response("<html><title>問題一覧 - yukicoder</title></html>", {
                        status: 200,
                    }),
            );

            await expect(
                new YukicoderClient().getProblem("https://yukicoder.me/problems/no/99999"),
            ).rejects.toThrow("yukicoder problem was not found in the response.");
        });

        it("throws when the problem request fails", async () => {
            setFetch(async () => new Response("Not found", { status: 404 }));

            await expect(
                new YukicoderClient().getProblem("https://yukicoder.me/problems/no/480"),
            ).rejects.toBeInstanceOf(YukicoderProblemRequestError);
            await expect(
                new YukicoderClient().getProblem("https://yukicoder.me/problems/no/480"),
            ).rejects.toMatchObject({
                message: "yukicoder problem request failed (404).",
                status: 404,
            });
        });

        it("rejects unsupported URLs without fetching", async () => {
            let fetched = false;
            setFetch(async () => {
                fetched = true;
                return new Response(createProblemHtml(), { status: 200 });
            });

            await expect(
                new YukicoderClient().getProblem("https://example.com/problems/no/480"),
            ).rejects.toThrow("Expected a yukicoder problem URL.");
            expect(fetched).toBe(false);
        });
    });

    describe("requestDeviceCode", () => {
        it("requests a device code with the CLI name", async () => {
            const requests: Array<{ url: string; method: string | undefined; body: string }> = [];
            setFetch(async (input, init) => {
                requests.push({
                    url: String(input),
                    method: init?.method,
                    body: String(init?.body),
                });
                return jsonResponse({
                    device_code: "ydc_secret",
                    user_code: "WDJB-MJHT",
                    verification_uri: "https://yukicoder.me/device",
                    verification_uri_complete: "https://yukicoder.me/device?user_code=WDJB-MJHT",
                    expires_in: 600,
                    interval: 5,
                });
            });

            await expect(new YukicoderClient().requestDeviceCode("neoj")).resolves.toEqual(
                deviceCode,
            );
            expect(requests).toEqual([
                {
                    url: "https://yukicoder.me/api/v1/device/code",
                    method: "POST",
                    body: "client_name=neoj",
                },
            ]);
        });

        it("reports a failed device code request", async () => {
            setFetch(async () => new Response("error", { status: 500 }));

            await expect(new YukicoderClient().requestDeviceCode("neoj")).rejects.toThrow(
                "yukicoder device authorization request failed (500).",
            );
        });

        it("rejects a verification URL outside yukicoder", async () => {
            setFetch(async () =>
                jsonResponse({
                    device_code: "ydc_secret",
                    user_code: "WDJB-MJHT",
                    verification_uri: "https://example.com/device",
                    expires_in: 600,
                    interval: 5,
                }),
            );

            await expect(new YukicoderClient().requestDeviceCode("neoj")).rejects.toThrow(
                "yukicoder device authorization response was invalid.",
            );
        });
    });

    describe("pollDeviceToken", () => {
        function clock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
            let time = 0;
            return {
                now: () => time,
                sleep: async (ms) => {
                    time += ms;
                },
            };
        }

        it("polls until the token is issued and records its expiry", async () => {
            let attempts = 0;
            setFetch(async (input, init) => {
                expect(String(input)).toBe("https://yukicoder.me/api/v1/device/token");
                expect(String(init?.body)).toContain(
                    "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code",
                );
                attempts += 1;
                if (attempts === 1) {
                    return jsonResponse({ error: "authorization_pending" }, 400);
                }

                return jsonResponse({
                    access_token: "ysb_token",
                    token_type: "Bearer",
                    expires_in: 86_400,
                    scope: "submit",
                });
            });

            const { now, sleep } = clock();
            const token = await new YukicoderClient().pollDeviceToken(deviceCode, {
                now,
                sleep,
            });

            expect(token).toEqual({
                accessToken: "ysb_token",
                expiresAt: Temporal.Instant.fromEpochMilliseconds(10_000 + 86_400_000),
            });
        });

        it("extends the interval when the server asks to slow down", async () => {
            const delays: number[] = [];
            let time = 0;
            let attempts = 0;
            setFetch(async () => {
                attempts += 1;
                return attempts === 1
                    ? jsonResponse({ error: "slow_down" }, 400)
                    : jsonResponse({ access_token: "ysb_token", expires_in: 86_400 });
            });

            await new YukicoderClient().pollDeviceToken(deviceCode, {
                now: () => time,
                sleep: async (ms) => {
                    delays.push(ms);
                    time += ms;
                },
            });

            expect(delays).toEqual([5_000, 10_000]);
        });

        it("stops with an actionable message for terminal errors", async () => {
            const cases = [
                ["access_denied", "yukicoder authorization was denied."],
                [
                    "expired_token",
                    'yukicoder device code expired. Run "neoj login yukicoder" again.',
                ],
                ["invalid_grant", "yukicoder device code is invalid or was already used."],
                [
                    "unsupported_grant_type",
                    "yukicoder rejected the device authorization grant type.",
                ],
                ["unexpected", "yukicoder device authorization failed: unexpected"],
            ] as const;

            for (const [error, message] of cases) {
                setFetch(async () => jsonResponse({ error, error_description: error }, 400));
                const { now, sleep } = clock();

                await expect(
                    new YukicoderClient().pollDeviceToken(deviceCode, { now, sleep }),
                ).rejects.toThrow(message);
            }
        });

        it("times out when authorization never completes", async () => {
            setFetch(async () => jsonResponse({ error: "authorization_pending" }, 400));
            const { now, sleep } = clock();

            await expect(
                new YukicoderClient().pollDeviceToken(
                    { ...deviceCode, expiresIn: 10, interval: 5 },
                    { now, sleep },
                ),
            ).rejects.toThrow(
                'yukicoder device authorization timed out. Run "neoj login yukicoder" again.',
            );
        });
    });

    describe("checkCredential", () => {
        it("sends the Bearer token and accepts a 200 response", async () => {
            const requests: Array<{ url: string; authorization: string | null }> = [];
            setFetch(async (input, init) => {
                requests.push({
                    url: String(input),
                    authorization: new Headers(init?.headers).get("Authorization"),
                });
                return jsonResponse({ Id: 1, Name: "user" });
            });

            await expect(new YukicoderClient().checkCredential("Bearer ysb_token")).resolves.toBe(
                true,
            );
            expect(requests).toEqual([
                {
                    url: "https://yukicoder.me/api/v1/authUser",
                    authorization: "Bearer ysb_token",
                },
            ]);
        });

        it("returns false for rejected credentials", async () => {
            for (const status of [401, 403]) {
                setFetch(async () => new Response("denied", { status }));
                await expect(new YukicoderClient().checkCredential("ysb_token")).resolves.toBe(
                    false,
                );
            }
        });

        it("reports connection failures and server errors", async () => {
            setFetch(async () => {
                throw new TypeError("fetch failed");
            });
            await expect(new YukicoderClient().checkCredential("ysb_token")).rejects.toThrow(
                "Failed to connect to yukicoder.",
            );

            setFetch(async () => new Response("error", { status: 500 }));
            await expect(new YukicoderClient().checkCredential("ysb_token")).rejects.toThrow(
                "yukicoder login check failed (500).",
            );
        });

        it("reports timeouts as timeouts", async () => {
            setFetch(async () => {
                throw new DOMException("The operation timed out.", "TimeoutError");
            });

            await expect(new YukicoderClient().checkCredential("ysb_token")).rejects.toThrow(
                "yukicoder request timed out after 15 seconds. Check your connection and try again.",
            );
        });
    });
});

describe("fetchYukicoderContestUrl", () => {
    it("uses the URL form to request the matching problem", async () => {
        const requests: string[] = [];
        setFetch(async (input) => {
            requests.push(String(input));
            return jsonResponse({ No: 12, ContestId: 12 });
        });

        await expect(
            fetchYukicoderContestUrl("https://yukicoder.me/problems/no/12"),
        ).resolves.toHaveProperty("href", "https://yukicoder.me/contests/12");
        await expect(
            fetchYukicoderContestUrl("https://yukicoder.me/problems/12"),
        ).resolves.toHaveProperty("href", "https://yukicoder.me/contests/12");
        expect(requests).toEqual([
            "https://yukicoder.me/api/v1/problems/no/12",
            "https://yukicoder.me/api/v1/problems/12",
        ]);
    });
});

describe("YukicoderClient language and submission requests", () => {
    const problemUrl = "https://yukicoder.me/problems/no/480";

    it("lists languages from the public endpoint", async () => {
        const requests: Array<{ url: string; method: string | undefined }> = [];
        setFetch(async (input, init) => {
            requests.push({ url: String(input), method: init?.method });
            return jsonResponse([
                { Id: 5001, Name: "C++17", Ver: "g++ 12.2" },
                { Id: "5002", Name: "Python", Ver: null },
                { Id: 5003, Name: "C#", Ver: "dotnet 8" },
            ]);
        });

        const languages = await new YukicoderClient().getLanguages();

        expect(requests).toEqual([
            { url: "https://yukicoder.me/api/v1/languages", method: undefined },
        ]);
        expect(languages).toEqual([
            { id: "5001", name: "C++17", version: "g++ 12.2" },
            { id: "5002", name: "Python", version: undefined },
            { id: "5003", name: "C#", version: "dotnet 8" },
        ]);
    });

    it("reports language request failures", async () => {
        setFetch(async () => new Response("error", { status: 500 }));
        await expect(new YukicoderClient().getLanguages()).rejects.toThrow(
            "yukicoder language request failed (500).",
        );

        setFetch(async () => new Response("not json", { status: 200 }));
        await expect(new YukicoderClient().getLanguages()).rejects.toThrow(
            "yukicoder language response was not valid JSON.",
        );

        setFetch(async () => jsonResponse({}));
        await expect(new YukicoderClient().getLanguages()).rejects.toThrow(
            "yukicoder language response was invalid.",
        );
    });

    it("posts the source as multipart form data with the bearer credential", async () => {
        const requests: Array<{
            url: string;
            method: string | undefined;
            authorization: string | null;
            userAgent: string | null;
            body: FormData | undefined;
        }> = [];
        setFetch(async (input, init) => {
            requests.push({
                url: String(input),
                method: init?.method,
                authorization: new Headers(init?.headers).get("Authorization"),
                userAgent: new Headers(init?.headers).get("User-Agent"),
                body: init?.body instanceof FormData ? init.body : undefined,
            });
            return jsonResponse({ SubmissionId: 266299 }, 201);
        });

        const result = await new YukicoderClient().submit(
            problemUrl,
            "Bearer ysb_token",
            "5001",
            "int main() {}",
        );

        expect(result).toEqual({
            submissionId: "266299",
            submissionUrl: "https://yukicoder.me/submissions/266299",
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]?.url).toBe("https://yukicoder.me/api/v1/problems/no/480/submit");
        expect(requests[0]?.method).toBe("POST");
        expect(requests[0]?.authorization).toBe("Bearer ysb_token");
        expect(requests[0]?.userAgent).toBe(USER_AGENT);
        expect(requests[0]?.body?.get("lang")).toBe("5001");
        expect(requests[0]?.body?.get("source")).toBe("int main() {}");
    });

    it("resolves a /problems/<ProblemId> URL to its problem No before submitting", async () => {
        const requests: Array<{ url: string; method: string | undefined }> = [];
        setFetch(async (input, init) => {
            const url = String(input);
            requests.push({ url, method: init?.method });
            if (url === "https://yukicoder.me/api/v1/problems/12") {
                return jsonResponse({ No: 9000, ProblemId: 12, ContestId: null });
            }
            return jsonResponse({ SubmissionId: 266299 }, 201);
        });

        await new YukicoderClient().submit(
            "https://yukicoder.me/problems/12",
            "ysb_token",
            "5001",
            "source",
        );

        expect(requests).toEqual([
            { url: "https://yukicoder.me/api/v1/problems/12", method: undefined },
            {
                url: "https://yukicoder.me/api/v1/problems/no/9000/submit",
                method: "POST",
            },
        ]);
    });

    it("reports a failure to resolve a /problems/<ProblemId> URL", async () => {
        setFetch(async () => new Response("error", { status: 404 }));
        await expect(
            new YukicoderClient().submit(
                "https://yukicoder.me/problems/12",
                "ysb_token",
                "5001",
                "source",
            ),
        ).rejects.toThrow("yukicoder problem request failed (404).");
    });

    it("rejects an invalid credential with an actionable message", async () => {
        for (const status of [401, 403]) {
            setFetch(async () => new Response("denied", { status }));
            await expect(
                new YukicoderClient().submit(problemUrl, "ysb_token", "5001", "source"),
            ).rejects.toThrow(
                'yukicoder rejected the submission because the login is not valid. Run "neoj login yukicoder" and try again.',
            );
        }
    });

    it("reports an unknown language ID when the login is still valid", async () => {
        setFetch(async (input) => {
            const url = String(input);
            if (url.endsWith("/v1/authUser")) {
                return jsonResponse({ Id: 1, Name: "user" });
            }
            if (url.endsWith("/v1/languages")) {
                return jsonResponse([{ Id: "cpp23", Name: "C++23" }]);
            }
            return new Response("denied", { status: 403 });
        });

        await expect(
            new YukicoderClient().submit(problemUrl, "ysb_token", "5001", "source"),
        ).rejects.toThrow(
            'yukicoder does not recognize the language ID "5001". Set a valid ID with "neoj languages yukicoder", --platform-language, or languages.<key>.submit.yukicoder.',
        );
    });

    it("does not blame the login when the credential is valid but the request is rejected", async () => {
        setFetch(async (input) => {
            const url = String(input);
            if (url.endsWith("/v1/authUser")) {
                return jsonResponse({ Id: 1, Name: "user" });
            }
            if (url.endsWith("/v1/languages")) {
                return jsonResponse([{ Id: "5001", Name: "C++17" }]);
            }
            return new Response("denied", { status: 403 });
        });

        await expect(
            new YukicoderClient().submit(problemUrl, "ysb_token", "5001", "source"),
        ).rejects.toThrow(
            'yukicoder rejected the submission (403) even though the login is valid. Check the language ID ("5001") and the source, then try again.',
        );
    });

    it("asks for a login again when the credential cannot be verified after a rejection", async () => {
        setFetch(async (input) => {
            const url = String(input);
            if (url.endsWith("/v1/authUser")) {
                return new Response("error", { status: 500 });
            }
            return new Response("denied", { status: 401 });
        });

        await expect(
            new YukicoderClient().submit(problemUrl, "ysb_token", "5001", "source"),
        ).rejects.toThrow(
            'yukicoder rejected the submission (401) and the login could not be verified. Run "neoj login yukicoder" and try again, or check the language ID ("5001").',
        );
    });

    it("reports other submission failures", async () => {
        setFetch(async () => new Response("error", { status: 500 }));
        await expect(
            new YukicoderClient().submit(problemUrl, "ysb_token", "5001", "source"),
        ).rejects.toThrow("yukicoder submission failed (500).");

        setFetch(async () => jsonResponse({}, 200));
        await expect(
            new YukicoderClient().submit(problemUrl, "ysb_token", "5001", "source"),
        ).rejects.toThrow("yukicoder submission response was invalid.");
    });
});
