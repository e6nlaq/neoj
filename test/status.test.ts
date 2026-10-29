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
        ).resolves.toEqual([{ platform: "atcoder", displayName: "AtCoder", status: "logged-in" }]);
        expect(requests).toEqual([
            {
                url: "https://atcoder.jp/contests/abc100/submit",
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
                error: "network unavailable",
            },
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
        ]);
    });
});
