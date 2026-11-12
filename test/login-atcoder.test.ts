import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./helpers/mock-auth-paths";

const { readAuth, saveAuth } = await import("@/lib/util/auth");

const originalFetch = globalThis.fetch;
const originalLocalAppData = process.env.LOCALAPPDATA;
let dataRoot: string | undefined;
const confirmPrompt = mock(async () => false);
const passwordPrompt = mock(async () => "new-session");

mock.module("@inquirer/prompts", () => ({
    confirm: confirmPrompt,
    password: passwordPrompt,
}));

const { loginToAtCoder } = await import("@/feature/login/atcoder");

type FetchHandler = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

function setFetch(handler: FetchHandler): void {
    globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect });
}

async function setupDataDirectory(): Promise<void> {
    dataRoot = await mkdtemp(join(tmpdir(), "neoj-login-test-"));
    process.env.LOCALAPPDATA = dataRoot;
}

afterEach(async () => {
    globalThis.fetch = originalFetch;
    confirmPrompt.mockReset().mockImplementation(async () => false);
    passwordPrompt.mockReset().mockImplementation(async () => "new-session");

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

describe("loginToAtCoder", () => {
    it("asks before replacing a saved session that is still valid", async () => {
        await setupDataDirectory();
        await saveAuth("atcoder", { revelSession: "saved-session" });
        setFetch(async () => new Response(null, { status: 200 }));

        await expect(loginToAtCoder()).resolves.toBeUndefined();

        expect(confirmPrompt).toHaveBeenCalledWith({
            message: "Already logged in to AtCoder. Continue with a new session?",
            default: false,
        });
        expect(passwordPrompt).not.toHaveBeenCalled();
        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "saved-session" },
        });
    });

    it("continues with a new session when confirmed", async () => {
        await setupDataDirectory();
        await saveAuth("atcoder", { revelSession: "saved-session" });
        confirmPrompt.mockImplementation(async () => true);
        setFetch(
            async () =>
                new Response('<script>var userScreenName = "kenkoooo";</script>', {
                    status: 200,
                }),
        );

        await expect(loginToAtCoder()).resolves.toEqual({ username: "kenkoooo" });

        expect(passwordPrompt).toHaveBeenCalledTimes(1);
        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "new-session" },
        });
    });

    it("asks for a new session without confirmation when the saved session is invalid", async () => {
        await setupDataDirectory();
        await saveAuth("atcoder", { revelSession: "expired-session" });
        setFetch(async (_input, init) => {
            const cookie = new Headers(init?.headers).get("Cookie");
            return cookie === "REVEL_SESSION=expired-session"
                ? new Response(null, { status: 302, headers: { Location: "/login" } })
                : new Response('<script>var userScreenName = "kenkoooo";</script>', {
                      status: 200,
                  });
        });

        await expect(loginToAtCoder()).resolves.toEqual({ username: "kenkoooo" });

        expect(confirmPrompt).not.toHaveBeenCalled();
        expect(passwordPrompt).toHaveBeenCalledTimes(1);
        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "new-session" },
        });
    });

    it("normalizes a pasted cookie value before saving it", async () => {
        await setupDataDirectory();
        passwordPrompt.mockImplementation(async () => "  REVEL_SESSION=opaque%00session  ");
        setFetch(async () => new Response(null, { status: 200 }));

        await expect(loginToAtCoder()).resolves.toEqual({ username: undefined });

        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "opaque%00session" },
        });
    });
});
