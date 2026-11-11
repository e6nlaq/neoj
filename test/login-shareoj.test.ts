import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./helpers/mock-auth-paths";

import {
    getShareOjAccessToken,
    getShareOjAuth,
    hasShareOjCredentials,
    isShareOjLoggedIn,
    parseShareOjLoginMethod,
} from "@/feature/login/shareoj";
import { readAuth, replaceAuth } from "@/lib/util/auth";

const originalLocalAppData = process.env.LOCALAPPDATA;
let dataRoot: string | undefined;

afterEach(async () => {
    if (originalLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
    } else {
        process.env.LOCALAPPDATA = originalLocalAppData;
    }

    if (dataRoot !== undefined) {
        await rm(dataRoot, { recursive: true, force: true });
        dataRoot = undefined;
    }
});

async function setTemporaryDataDirectory(): Promise<void> {
    dataRoot = await mkdtemp(join(tmpdir(), "neoj-login-shareoj-test-"));
    process.env.LOCALAPPDATA = dataRoot;
}

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

const validExpiresAt = Temporal.Instant.fromEpochMilliseconds(Date.now() + 3_600_000).toString();

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("ShareOJ auth data", () => {
    it("parses the login method", () => {
        expect(parseShareOjLoginMethod(undefined)).toBe("password");
        expect(parseShareOjLoginMethod("password")).toBe("password");
        expect(() => parseShareOjLoginMethod("google")).toThrow(
            /Unsupported ShareOJ login method/u,
        );
    });

    it("validates saved credentials", () => {
        expect(getShareOjAuth(undefined)).toBeUndefined();
        expect(
            getShareOjAuth({
                method: "password",
                accessToken: "tok",
                refreshToken: "ref",
                expiresAt: validExpiresAt,
            }),
        ).toEqual({
            method: "password",
            accessToken: "tok",
            refreshToken: "ref",
            expiresAt: validExpiresAt,
        });
        expect(() => getShareOjAuth({ method: "password" })).toThrow(
            "Saved ShareOJ authentication data is invalid.",
        );
        expect(() => getShareOjAuth({ method: "password", accessToken: 42 })).toThrow(
            "Saved ShareOJ authentication data is invalid.",
        );
    });

    it("reports saved credentials without the network", () => {
        expect(hasShareOjCredentials(undefined)).toBe(false);
        expect(hasShareOjCredentials({ method: "password", accessToken: "tok" })).toBe(true);
        // An expired access token is still usable while a refresh token remains.
        expect(
            hasShareOjCredentials({
                method: "password",
                accessToken: "tok",
                refreshToken: "ref",
                expiresAt: "2000-01-01T00:00:00Z",
            }),
        ).toBe(true);
        expect(
            hasShareOjCredentials({
                method: "password",
                accessToken: "tok",
                expiresAt: "2000-01-01T00:00:00Z",
            }),
        ).toBe(false);
    });
});

describe("ShareOJ login state", () => {
    it("uses an unexpired access token against /auth/me", async () => {
        let requests = 0;
        setFetch(async (input, init) => {
            requests += 1;
            expect(String(input)).toBe("https://api.share-oj.net/auth/me");
            expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");
            return jsonResponse({ id: "u1" }, 200);
        });

        await expect(
            isShareOjLoggedIn({
                method: "password",
                accessToken: "tok",
                refreshToken: "ref",
                expiresAt: validExpiresAt,
            }),
        ).resolves.toBe(true);
        expect(requests).toBe(1);
    });

    it("refreshes an expired access token and saves the new tokens", async () => {
        await setTemporaryDataDirectory();
        setFetch(async (input, init) => {
            const url = String(input);
            if (url === "https://api.share-oj.net/auth/refresh") {
                expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: "ref" });
                return jsonResponse({ access_token: "tok2", expires_in: 3600 }, 200);
            }
            if (url === "https://api.share-oj.net/auth/me") {
                expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok2");
                return jsonResponse({ id: "u1" }, 200);
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        await replaceAuth("shareoj", {
            method: "password",
            accessToken: "tok",
            refreshToken: "ref",
            expiresAt: "2000-01-01T00:00:00Z",
        });

        await expect(isShareOjLoggedIn((await readAuth()).shareoj)).resolves.toBe(true);
        const saved = getShareOjAuth((await readAuth()).shareoj);
        expect(saved?.accessToken).toBe("tok2");
        expect(saved?.refreshToken).toBe("ref");
    });

    it("reports a rejected refresh token as logged out", async () => {
        setFetch(async () => jsonResponse({ error: "not_authorized" }, 401));

        await expect(
            isShareOjLoggedIn({
                method: "password",
                accessToken: "tok",
                refreshToken: "ref",
                expiresAt: "2000-01-01T00:00:00Z",
            }),
        ).resolves.toBe(false);
    });

    it("returns no token when there is no way to refresh", async () => {
        await expect(
            getShareOjAccessToken({
                method: "password",
                accessToken: "tok",
                expiresAt: "2000-01-01T00:00:00Z",
            }),
        ).resolves.toBeUndefined();
    });
});
