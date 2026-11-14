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
const passwordPrompt = mock(async () => "JSESSIONID=new-session");

mock.module("@inquirer/prompts", () => ({
    confirm: confirmPrompt,
    password: passwordPrompt,
}));

const { loginToCodeforces } = await import("@/feature/login/codeforces");

type FetchHandler = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

function setFetch(handler: FetchHandler): void {
    globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect });
}

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

/** Queue one response per `password()` call. */
function queuePasswordResponses(...values: string[]): void {
    let index = 0;
    passwordPrompt.mockImplementation(async () => values[index++] ?? values.at(-1) ?? "");
}

async function setupDataDirectory(): Promise<void> {
    dataRoot = await mkdtemp(join(tmpdir(), "neoj-login-codeforces-test-"));
    process.env.LOCALAPPDATA = dataRoot;
}

afterEach(async () => {
    globalThis.fetch = originalFetch;
    confirmPrompt.mockReset().mockImplementation(async () => false);
    passwordPrompt.mockReset().mockImplementation(async () => "JSESSIONID=new-session");

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

describe("loginToCodeforces", () => {
    it("asks before replacing a saved session that is still valid", async () => {
        await setupDataDirectory();
        await saveAuth("codeforces", { jsessionId: "saved", ftaa: "saved-ftaa" });
        setFetch(async () => new Response(loginPageHtml, { status: 200 }));

        await expect(loginToCodeforces()).resolves.toBeUndefined();

        expect(confirmPrompt).toHaveBeenCalledWith({
            message: "Already logged in to Codeforces. Continue with a new session?",
            default: false,
        });
        expect(passwordPrompt).not.toHaveBeenCalled();
        await expect(readAuth()).resolves.toEqual({
            codeforces: { jsessionId: "saved", ftaa: "saved-ftaa" },
        });
    });

    it("continues with a new session when confirmed", async () => {
        await setupDataDirectory();
        await saveAuth("codeforces", { jsessionId: "saved", ftaa: "saved-ftaa" });
        confirmPrompt.mockImplementation(async () => true);
        queuePasswordResponses("new-jsession", "new-ftaa");
        setFetch(async () => new Response(loginPageHtml, { status: 200 }));

        await expect(loginToCodeforces()).resolves.toEqual({ username: "tourist" });

        expect(passwordPrompt).toHaveBeenCalledTimes(2);
        expect(passwordPrompt).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                message: "Paste the JSESSIONID cookie value from Codeforces DevTools:",
            }),
        );
        expect(passwordPrompt).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                message: "Paste the 70a7c28f3de cookie value from Codeforces DevTools:",
            }),
        );
        await expect(readAuth()).resolves.toEqual({
            codeforces: { jsessionId: "new-jsession", ftaa: "new-ftaa" },
        });
    });

    it("asks for new cookies without confirmation when the saved session is invalid", async () => {
        await setupDataDirectory();
        await saveAuth("codeforces", { jsessionId: "expired", ftaa: "expired-ftaa" });
        queuePasswordResponses("new-jsession", "new-ftaa");
        setFetch(async (_input, init) => {
            const cookie = new Headers(init?.headers).get("Cookie");
            return cookie === "JSESSIONID=expired; 70a7c28f3de=expired-ftaa"
                ? new Response(null, { status: 302, headers: { Location: "/enter" } })
                : new Response(loginPageHtml, { status: 200 });
        });

        await expect(loginToCodeforces()).resolves.toEqual({ username: "tourist" });

        expect(confirmPrompt).not.toHaveBeenCalled();
        expect(passwordPrompt).toHaveBeenCalledTimes(2);
        await expect(readAuth()).resolves.toEqual({
            codeforces: { jsessionId: "new-jsession", ftaa: "new-ftaa" },
        });
    });

    it("normalizes pasted name=value pairs before saving them", async () => {
        await setupDataDirectory();
        queuePasswordResponses("  JSESSIONID=opaque%00session  ", "  70a7c28f3de=ftaa%00value  ");
        setFetch(async () => new Response(loginPageHtml, { status: 200 }));

        await expect(loginToCodeforces()).resolves.toEqual({ username: "tourist" });

        await expect(readAuth()).resolves.toEqual({
            codeforces: { jsessionId: "opaque%00session", ftaa: "ftaa%00value" },
        });
    });

    it("saves the cookies Codeforces rotates while validating them", async () => {
        await setupDataDirectory();
        queuePasswordResponses("pasted-jsession", "pasted-ftaa");
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

        await expect(loginToCodeforces()).resolves.toEqual({ username: "tourist" });

        await expect(readAuth()).resolves.toEqual({
            codeforces: { jsessionId: "rotated", ftaa: "rotated-ftaa" },
        });
    });

    it("rejects a session that Codeforces reports signed out", async () => {
        await setupDataDirectory();
        queuePasswordResponses("bad-jsession", "bad-ftaa");
        setFetch(async () => new Response(signedOutPageHtml, { status: 200 }));

        await expect(loginToCodeforces()).rejects.toThrow(
            "Codeforces login failed. Check that the JSESSIONID and 70a7c28f3de cookies are current.",
        );

        await expect(readAuth()).resolves.toEqual({});
    });

    it("reports a browser check and saves nothing", async () => {
        await setupDataDirectory();
        queuePasswordResponses("some-jsession", "some-ftaa");
        setFetch(async () => new Response("<title>Just a moment...</title>", { status: 403 }));

        await expect(loginToCodeforces()).rejects.toThrow("returned a browser check");

        await expect(readAuth()).resolves.toEqual({});
    });

    it("rejects a saved session that was tampered with", async () => {
        await setupDataDirectory();
        await saveAuth("codeforces", { jsessionId: "", ftaa: "ftaa" });

        await expect(loginToCodeforces()).rejects.toThrow(
            "Saved Codeforces authentication data is invalid.",
        );
        expect(passwordPrompt).not.toHaveBeenCalled();
    });
});
