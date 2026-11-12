import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./helpers/mock-auth-paths";

const { readAuth, saveAuth } = await import("@/lib/util/auth");

const originalFetch = globalThis.fetch;
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalUserProfile = process.env.USERPROFILE;
const originalHome = process.env.HOME;
let testRoot: string | undefined;

const confirmPrompt = mock(async () => false);
const passwordPrompt = mock(async () => "api-key");

mock.module("@inquirer/prompts", () => ({
    confirm: confirmPrompt,
    password: passwordPrompt,
}));

const { loginToYukicoder } = await import("@/feature/login/yukicoder");

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

async function setupDirectories(): Promise<{ home: string; data: string }> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-login-yukicoder-test-"));
    const home = join(testRoot, "home");
    const data = join(testRoot, "data");
    await mkdir(home, { recursive: true });
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    process.env.LOCALAPPDATA = data;
    return { home, data };
}

function deviceCodeResponse(): Response {
    return jsonResponse({
        device_code: "ydc_secret",
        user_code: "WDJB-MJHT",
        verification_uri: "https://yukicoder.me/device",
        verification_uri_complete: "https://yukicoder.me/device?user_code=WDJB-MJHT",
        expires_in: 600,
        interval: 5,
    });
}

function tokenResponse(): Response {
    return jsonResponse({
        access_token: "ysb_token",
        token_type: "Bearer",
        expires_in: 86_400,
        scope: "submit",
    });
}

afterEach(async () => {
    globalThis.fetch = originalFetch;
    confirmPrompt.mockReset().mockImplementation(async () => false);
    passwordPrompt.mockReset().mockImplementation(async () => "api-key");

    for (const [key, value] of [
        ["LOCALAPPDATA", originalLocalAppData],
        ["USERPROFILE", originalUserProfile],
        ["HOME", originalHome],
    ] as const) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

describe("loginToYukicoder", () => {
    it("logs in with the device flow, opens the browser, and saves the expiry", async () => {
        await setupDirectories();
        const openedUrls: string[] = [];
        setFetch(async (input) => {
            const url = String(input);
            if (url.endsWith("/v1/device/code")) {
                return deviceCodeResponse();
            }
            if (url.endsWith("/v1/device/token")) {
                return tokenResponse();
            }
            if (url.endsWith("/v1/authUser")) {
                return jsonResponse({ Id: 7, Name: "yuki2006" });
            }
            throw new Error(`Unexpected request: ${url}`);
        });

        await expect(
            loginToYukicoder({
                openUrl: async (url) => {
                    openedUrls.push(url);
                    return true;
                },
                sleep: async () => undefined,
                now: () => 0,
            }),
        ).resolves.toEqual({ username: "yuki2006" });

        expect(openedUrls).toEqual(["https://yukicoder.me/device?user_code=WDJB-MJHT"]);
        await expect(readAuth()).resolves.toEqual({
            yukicoder: {
                method: "token",
                token: "ysb_token",
                expiresAt: "1970-01-02T00:00:00Z",
            },
        });
    });

    it("does not open the browser when login.open_browser is false", async () => {
        const { home } = await setupDirectories();
        await Bun.write(join(home, ".neoj.toml"), "[login]\nopen_browser = false\n");
        let opened = false;
        setFetch(async (input) => {
            const url = String(input);
            if (url.endsWith("/v1/device/code")) {
                return deviceCodeResponse();
            }
            if (url.endsWith("/v1/authUser")) {
                return jsonResponse({ Id: 7, Name: "yuki2006" });
            }
            return tokenResponse();
        });

        await expect(
            loginToYukicoder({
                openUrl: async () => {
                    opened = true;
                    return true;
                },
                sleep: async () => undefined,
                now: () => 0,
            }),
        ).resolves.toEqual({ username: "yuki2006" });

        expect(opened).toBe(false);
    });

    it("keeps the login when the account name cannot be read", async () => {
        await setupDirectories();
        setFetch(async (input) => {
            const url = String(input);
            if (url.endsWith("/v1/device/code")) {
                return deviceCodeResponse();
            }
            if (url.endsWith("/v1/device/token")) {
                return tokenResponse();
            }
            if (url.endsWith("/v1/authUser")) {
                return new Response("error", { status: 500 });
            }
            throw new Error(`Unexpected request: ${url}`);
        });

        await expect(
            loginToYukicoder({
                openUrl: async () => true,
                sleep: async () => undefined,
                now: () => 0,
            }),
        ).resolves.toEqual({ username: undefined });

        await expect(readAuth()).resolves.toEqual({
            yukicoder: {
                method: "token",
                token: "ysb_token",
                expiresAt: "1970-01-02T00:00:00Z",
            },
        });
    });

    it("saves a validated API key", async () => {
        await setupDirectories();
        passwordPrompt.mockImplementation(async () => "  Bearer api-key  ");
        const requests: Array<{ url: string; authorization: string | null }> = [];
        setFetch(async (input, init) => {
            requests.push({
                url: String(input),
                authorization: new Headers(init?.headers).get("Authorization"),
            });
            return jsonResponse({ Id: 1, Name: "user" });
        });

        await expect(loginToYukicoder({ method: "api-key" })).resolves.toEqual({
            username: "user",
        });

        expect(requests).toEqual([
            {
                url: "https://yukicoder.me/api/v1/authUser",
                authorization: "Bearer api-key",
            },
        ]);
        await expect(readAuth()).resolves.toEqual({
            yukicoder: { method: "api-key", apiKey: "api-key" },
        });
    });

    it("rejects an invalid API key without saving it", async () => {
        await setupDirectories();
        setFetch(async () => new Response("denied", { status: 401 }));

        await expect(loginToYukicoder({ method: "api-key" })).rejects.toThrow(
            "yukicoder API key is invalid.",
        );
        await expect(readAuth()).resolves.toEqual({});
    });

    it("asks before replacing a valid saved login", async () => {
        await setupDirectories();
        await saveAuth("yukicoder", { method: "api-key", apiKey: "old-key" });
        setFetch(async () => jsonResponse({ Id: 1, Name: "user" }));

        await expect(loginToYukicoder({ method: "api-key" })).resolves.toBeUndefined();

        expect(confirmPrompt).toHaveBeenCalledWith({
            message: "Already logged in to yukicoder. Continue with a new login?",
            default: false,
        });
        expect(passwordPrompt).not.toHaveBeenCalled();
        await expect(readAuth()).resolves.toEqual({
            yukicoder: { method: "api-key", apiKey: "old-key" },
        });
    });

    it("skips confirmation when the saved token is expired", async () => {
        await setupDirectories();
        await saveAuth("yukicoder", {
            method: "token",
            token: "expired-token",
            expiresAt: "2000-01-01T00:00:00Z",
        });
        setFetch(async (input) => {
            const url = String(input);
            if (url.endsWith("/v1/device/code")) {
                return deviceCodeResponse();
            }
            if (url.endsWith("/v1/authUser")) {
                return jsonResponse({ Id: 7, Name: "yuki2006" });
            }
            return tokenResponse();
        });

        await expect(
            loginToYukicoder({
                openUrl: async () => true,
                sleep: async () => undefined,
                now: () => 0,
            }),
        ).resolves.toEqual({ username: "yuki2006" });

        expect(confirmPrompt).not.toHaveBeenCalled();
        await expect(readAuth()).resolves.toEqual({
            yukicoder: {
                method: "token",
                token: "ysb_token",
                expiresAt: "1970-01-02T00:00:00Z",
            },
        });
    });

    it("rejects an unsupported login method", async () => {
        await setupDirectories();

        await expect(loginToYukicoder({ method: "password" })).rejects.toThrow(
            'Unsupported yukicoder login method: password. Use "token" or "api-key".',
        );
        expect(passwordPrompt).not.toHaveBeenCalled();
    });

    it("reports malformed saved authentication data", async () => {
        await setupDirectories();
        await saveAuth("yukicoder", { method: "token", token: "token" });

        await expect(loginToYukicoder({ method: "api-key" })).rejects.toThrow(
            "Saved yukicoder authentication data is invalid.",
        );
    });
});
