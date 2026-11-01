import { afterEach, describe, expect, it } from "bun:test";

import { getLoginStatuses } from "@/feature/status";

const originalFetch = globalThis.fetch;
type FetchHandler = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

function setFetch(handler: FetchHandler): void {
    globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect });
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("getLoginStatuses", () => {
    it("reports all supported platforms as logged out when no auth is saved", async () => {
        let fetched = false;
        setFetch(async () => {
            fetched = true;
            return new Response(null, { status: 200 });
        });

        await expect(getLoginStatuses({})).resolves.toEqual([
            { platform: "atcoder", displayName: "AtCoder", status: "logged-out" },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-out" },
        ]);
        expect(fetched).toBe(false);
    });

    it("checks saved credentials with the platform and reports the login state", async () => {
        const requests: Array<{ url: string; cookie: string | null }> = [];
        setFetch(async (input, init) => {
            requests.push({
                url: String(input),
                cookie: new Headers(init?.headers).get("Cookie"),
            });
            return new Response(null, { status: 200 });
        });

        await expect(
            getLoginStatuses({ atcoder: { revelSession: "saved-session" } }),
        ).resolves.toEqual([
            { platform: "atcoder", displayName: "AtCoder", status: "logged-in" },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-out" },
        ]);
        expect(requests).toEqual([
            {
                url: "https://atcoder.jp/settings",
                cookie: "REVEL_SESSION=saved-session",
            },
        ]);
    });

    it("reports service errors separately from logged-out status", async () => {
        setFetch(async () => {
            throw new Error("network unavailable");
        });

        await expect(
            getLoginStatuses({ atcoder: { revelSession: "saved-session" } }),
        ).resolves.toEqual([
            {
                platform: "atcoder",
                displayName: "AtCoder",
                status: "error",
                error: "Failed to connect to AtCoder.",
            },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-out" },
        ]);
    });

    it("reports malformed saved credentials as an error", async () => {
        await expect(getLoginStatuses({ atcoder: { revelSession: 42 } })).resolves.toEqual([
            {
                platform: "atcoder",
                displayName: "AtCoder",
                status: "error",
                error: "Saved AtCoder authentication data is invalid.",
            },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-out" },
        ]);
    });

    it("uses saved credentials without contacting the service in offline mode", async () => {
        let fetched = false;
        setFetch(async () => {
            fetched = true;
            return new Response(null, { status: 200 });
        });

        await expect(
            getLoginStatuses({ atcoder: { revelSession: "saved-session" } }, true),
        ).resolves.toEqual([
            { platform: "atcoder", displayName: "AtCoder", status: "logged-in" },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-out" },
        ]);
        expect(fetched).toBe(false);
    });

    it("reports no saved credentials in offline mode", async () => {
        let fetched = false;
        setFetch(async () => {
            fetched = true;
            return new Response(null, { status: 200 });
        });

        await expect(getLoginStatuses({}, true)).resolves.toEqual([
            { platform: "atcoder", displayName: "AtCoder", status: "logged-out" },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-out" },
        ]);
        expect(fetched).toBe(false);
    });

    it("reports malformed saved credentials as an error in offline mode", async () => {
        await expect(getLoginStatuses({ atcoder: { revelSession: 42 } }, true)).resolves.toEqual([
            {
                platform: "atcoder",
                displayName: "AtCoder",
                status: "error",
                error: "Saved AtCoder authentication data is invalid.",
            },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-out" },
        ]);
    });

    it("checks a saved yukicoder token with authUser", async () => {
        const expiresAt = Temporal.Instant.fromEpochMilliseconds(Date.now() + 3_600_000).toString();
        const requests: Array<{ url: string; authorization: string | null }> = [];
        setFetch(async (input, init) => {
            requests.push({
                url: String(input),
                authorization: new Headers(init?.headers).get("Authorization"),
            });
            return new Response("{}", { status: 200 });
        });

        await expect(
            getLoginStatuses({
                yukicoder: { method: "token", token: "ysb_token", expiresAt },
            }),
        ).resolves.toEqual([
            { platform: "atcoder", displayName: "AtCoder", status: "logged-out" },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-in" },
        ]);
        expect(requests).toEqual([
            {
                url: "https://yukicoder.me/api/v1/authUser",
                authorization: "Bearer ysb_token",
            },
        ]);
    });

    it("checks a saved yukicoder API key with authUser", async () => {
        setFetch(async () => new Response("{}", { status: 200 }));

        await expect(
            getLoginStatuses({ yukicoder: { method: "api-key", apiKey: "api-key" } }),
        ).resolves.toEqual([
            { platform: "atcoder", displayName: "AtCoder", status: "logged-out" },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-in" },
        ]);
    });

    it("reports an expired yukicoder token as logged out without a request", async () => {
        let fetched = false;
        setFetch(async () => {
            fetched = true;
            return new Response("{}", { status: 200 });
        });

        await expect(
            getLoginStatuses({
                yukicoder: {
                    method: "token",
                    token: "ysb_token",
                    expiresAt: "2000-01-01T00:00:00Z",
                },
            }),
        ).resolves.toEqual([
            { platform: "atcoder", displayName: "AtCoder", status: "logged-out" },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-out" },
        ]);
        expect(fetched).toBe(false);
    });

    it("reports a rejected yukicoder credential as logged out", async () => {
        setFetch(async () => new Response("denied", { status: 401 }));

        await expect(
            getLoginStatuses({ yukicoder: { method: "api-key", apiKey: "api-key" } }),
        ).resolves.toEqual([
            { platform: "atcoder", displayName: "AtCoder", status: "logged-out" },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-out" },
        ]);
    });

    it("reports malformed yukicoder credentials as an error", async () => {
        await expect(
            getLoginStatuses({ yukicoder: { method: "token", token: "ysb_token" } }),
        ).resolves.toEqual([
            { platform: "atcoder", displayName: "AtCoder", status: "logged-out" },
            {
                platform: "yukicoder",
                displayName: "yukicoder",
                status: "error",
                error: "Saved yukicoder authentication data is invalid.",
            },
        ]);
    });

    it("reports yukicoder connection failures as an error", async () => {
        const expiresAt = Temporal.Instant.fromEpochMilliseconds(Date.now() + 3_600_000).toString();
        setFetch(async () => {
            throw new TypeError("fetch failed");
        });

        await expect(
            getLoginStatuses({
                yukicoder: { method: "token", token: "ysb_token", expiresAt },
            }),
        ).resolves.toEqual([
            { platform: "atcoder", displayName: "AtCoder", status: "logged-out" },
            {
                platform: "yukicoder",
                displayName: "yukicoder",
                status: "error",
                error: "Failed to connect to yukicoder.",
            },
        ]);
    });

    it("uses a saved yukicoder credential without contacting the service in offline mode", async () => {
        let fetched = false;
        setFetch(async () => {
            fetched = true;
            return new Response("{}", { status: 200 });
        });
        const expiresAt = Temporal.Instant.fromEpochMilliseconds(Date.now() + 3_600_000).toString();

        await expect(
            getLoginStatuses(
                { yukicoder: { method: "token", token: "ysb_token", expiresAt } },
                true,
            ),
        ).resolves.toEqual([
            { platform: "atcoder", displayName: "AtCoder", status: "logged-out" },
            { platform: "yukicoder", displayName: "yukicoder", status: "logged-in" },
        ]);
        expect(fetched).toBe(false);
    });
});
