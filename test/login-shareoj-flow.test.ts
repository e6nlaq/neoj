import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./helpers/mock-auth-paths";

const originalFetch = globalThis.fetch;
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalUserProfile = process.env.USERPROFILE;
const originalHome = process.env.HOME;
let testRoot: string | undefined;

const confirmPrompt = mock(async () => true);
const inputPrompt = mock(async () => "alice@example.com");
const passwordPrompt = mock(async () => "secret");

mock.module("@inquirer/prompts", () => ({
    confirm: confirmPrompt,
    input: inputPrompt,
    password: passwordPrompt,
}));

const { getShareOjAuth, loginToShareOj } = await import("@/feature/login/shareoj");
const { readAuth, replaceAuth } = await import("@/lib/util/auth");

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

async function setupDirectories(): Promise<void> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-login-shareoj-flow-test-"));
    const home = join(testRoot, "home");
    await mkdir(home, { recursive: true });
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    process.env.LOCALAPPDATA = join(testRoot, "data");
}

afterEach(async () => {
    globalThis.fetch = originalFetch;
    confirmPrompt.mockReset().mockImplementation(async () => true);
    inputPrompt.mockReset().mockImplementation(async () => "alice@example.com");
    passwordPrompt.mockReset().mockImplementation(async () => "secret");

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

describe("loginToShareOj", () => {
    it("logs in, verifies the session, and saves the tokens", async () => {
        await setupDirectories();
        const requests: string[] = [];
        setFetch(async (input, init) => {
            const url = String(input);
            requests.push(url);
            if (url === "https://api.share-oj.net/auth/login") {
                expect(JSON.parse(String(init?.body))).toEqual({
                    username: "alice@example.com",
                    password: "secret",
                });
                return jsonResponse({
                    access_token: "tok",
                    refresh_token: "ref",
                    expires_in: 3600,
                });
            }
            if (url === "https://api.share-oj.net/auth/me") {
                expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");
                return jsonResponse({ id: "u1" });
            }
            if (url === "https://api.share-oj.net/my/profile") {
                expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");
                return jsonResponse({ profile: { handle: "alice" } });
            }
            throw new Error(`Unexpected request: ${url}`);
        });

        await expect(loginToShareOj()).resolves.toEqual({ username: "alice" });

        expect(requests).toEqual([
            "https://api.share-oj.net/auth/login",
            "https://api.share-oj.net/auth/me",
            "https://api.share-oj.net/my/profile",
        ]);
        const saved = getShareOjAuth((await readAuth()).shareoj);
        expect(saved?.accessToken).toBe("tok");
        expect(saved?.refreshToken).toBe("ref");
        expect(saved?.expiresAt).toBeDefined();
    });

    it("keeps the login when the account has no profile yet", async () => {
        await setupDirectories();
        setFetch(async (input) => {
            const url = String(input);
            if (url === "https://api.share-oj.net/auth/login") {
                return jsonResponse({ access_token: "tok", expires_in: 3600 });
            }
            if (url === "https://api.share-oj.net/auth/me") {
                return jsonResponse({ id: "u1" });
            }
            if (url === "https://api.share-oj.net/my/profile") {
                return jsonResponse({ profile: null });
            }
            throw new Error(`Unexpected request: ${url}`);
        });

        await expect(loginToShareOj()).resolves.toEqual({ username: undefined });
        expect(getShareOjAuth((await readAuth()).shareoj)?.accessToken).toBe("tok");
    });

    it("keeps the login when the profile request fails", async () => {
        await setupDirectories();
        setFetch(async (input) => {
            const url = String(input);
            if (url === "https://api.share-oj.net/auth/login") {
                return jsonResponse({ access_token: "tok", expires_in: 3600 });
            }
            if (url === "https://api.share-oj.net/auth/me") {
                return jsonResponse({ id: "u1" });
            }
            if (url === "https://api.share-oj.net/my/profile") {
                return jsonResponse({ error: "internal" }, 500);
            }
            throw new Error(`Unexpected request: ${url}`);
        });

        await expect(loginToShareOj()).resolves.toEqual({ username: undefined });
        expect(getShareOjAuth((await readAuth()).shareoj)?.accessToken).toBe("tok");
    });

    it("does not replace the saved session when the new tokens are unusable", async () => {
        await setupDirectories();
        await replaceAuth("shareoj", {
            method: "password",
            accessToken: "saved",
            refreshToken: "saved-refresh",
            expiresAt: "2000-01-01T00:00:00Z",
        });
        setFetch(async (input) => {
            const url = String(input);
            if (url === "https://api.share-oj.net/auth/refresh") {
                return jsonResponse({ error: "not_authorized" }, 401);
            }
            if (url === "https://api.share-oj.net/auth/login") {
                return jsonResponse({
                    access_token: "tok",
                    refresh_token: "ref",
                    expires_in: 3600,
                });
            }
            if (url === "https://api.share-oj.net/auth/me") {
                return jsonResponse({ user: null });
            }
            throw new Error(`Unexpected request: ${url}`);
        });

        await expect(loginToShareOj()).rejects.toThrow(
            "ShareOJ login did not produce a usable session. Try again.",
        );
        expect(getShareOjAuth((await readAuth()).shareoj)?.accessToken).toBe("saved");
    });

    it("answers an MFA challenge with the resolved sign-in name", async () => {
        await setupDirectories();
        const challengeBodies: unknown[] = [];
        setFetch(async (input, init) => {
            const url = String(input);
            if (url === "https://api.share-oj.net/auth/login") {
                return jsonResponse({
                    challenge_name: "EMAIL_OTP",
                    session: "sess-1",
                    challenge_parameters: { USER_ID_FOR_SRP: "resolved-user" },
                });
            }
            if (url === "https://api.share-oj.net/auth/challenge") {
                challengeBodies.push(JSON.parse(String(init?.body)));
                return jsonResponse({ access_token: "tok", refresh_token: "ref", expires_in: 60 });
            }
            if (url === "https://api.share-oj.net/auth/me") {
                return jsonResponse({ id: "u1" });
            }
            if (url === "https://api.share-oj.net/my/profile") {
                return jsonResponse({ profile: { handle: "alice" } });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        passwordPrompt.mockImplementation(async () => "123456");

        await expect(loginToShareOj()).resolves.toEqual({ username: "alice" });
        expect(challengeBodies).toEqual([
            {
                username: "resolved-user",
                challenge_name: "EMAIL_OTP",
                session: "sess-1",
                responses: { EMAIL_OTP_CODE: "123456" },
            },
        ]);
    });

    it("collects a new password and the attributes the account still needs", async () => {
        await setupDirectories();
        const challengeBodies: unknown[] = [];
        setFetch(async (input, init) => {
            const url = String(input);
            if (url === "https://api.share-oj.net/auth/login") {
                return jsonResponse({
                    challenge_name: "NEW_PASSWORD_REQUIRED",
                    session: "sess-2",
                    challenge_parameters: {
                        requiredAttributes: '["userAttributes.name","userAttributes.birthdate"]',
                    },
                });
            }
            if (url === "https://api.share-oj.net/auth/challenge") {
                challengeBodies.push(JSON.parse(String(init?.body)));
                return jsonResponse({ access_token: "tok", expires_in: 60 });
            }
            if (url === "https://api.share-oj.net/auth/me") {
                return jsonResponse({ id: "u1" });
            }
            if (url === "https://api.share-oj.net/my/profile") {
                return jsonResponse({ profile: { handle: "alice" } });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        passwordPrompt.mockImplementation(async () => "new-password");
        inputPrompt.mockImplementation((async (options: { message?: unknown }) => {
            const message = String(options.message ?? "");
            if (message.includes("name")) {
                return "Alice";
            }
            if (message.includes("birthdate")) {
                return "2000-01-01";
            }
            return "alice@example.com";
        }) as unknown as () => Promise<string>);

        await expect(loginToShareOj()).resolves.toEqual({ username: "alice" });
        expect(challengeBodies).toEqual([
            {
                username: "alice@example.com",
                challenge_name: "NEW_PASSWORD_REQUIRED",
                session: "sess-2",
                responses: {
                    NEW_PASSWORD: "new-password",
                    "userAttributes.name": "Alice",
                    "userAttributes.birthdate": "2000-01-01",
                },
            },
        ]);
    });

    it("rejects an unsupported challenge with an actionable message", async () => {
        await setupDirectories();
        setFetch(async (input) => {
            const url = String(input);
            if (url === "https://api.share-oj.net/auth/login") {
                return jsonResponse({ challenge_name: "CUSTOM_CHALLENGE", session: "sess-3" });
            }
            throw new Error(`Unexpected request: ${url}`);
        });

        await expect(loginToShareOj()).rejects.toThrow(
            /unsupported challenge \(CUSTOM_CHALLENGE\)/u,
        );
    });

    it("reports a rejected password with the API error code", async () => {
        await setupDirectories();
        setFetch(async () => jsonResponse({ error: "not_authorized" }, 401));

        await expect(loginToShareOj()).rejects.toThrow(/not_authorized/u);
    });
});
