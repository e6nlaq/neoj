import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./helpers/mock-auth-paths";
import type { AuthStore } from "@/lib/auth-store";

import { installMemoryAuthStore } from "./helpers/mock-auth-store";

const { readAuth, replaceAuth, saveAuth, removeAuth, clearAuth, setAuthStoreForTesting } =
    await import("@/lib/auth");

const originalLocalAppData = process.env.LOCALAPPDATA;
const originalBackend = process.env.NEOJ_SECRETS_BACKEND;
let dataRoot: string | undefined;

afterEach(async () => {
    installMemoryAuthStore();

    if (originalLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
    } else {
        process.env.LOCALAPPDATA = originalLocalAppData;
    }
    if (originalBackend === undefined) {
        delete process.env.NEOJ_SECRETS_BACKEND;
    } else {
        process.env.NEOJ_SECRETS_BACKEND = originalBackend;
    }

    if (dataRoot !== undefined) {
        await rm(dataRoot, { recursive: true, force: true });
        dataRoot = undefined;
    }
});

async function setTemporaryDataDirectory(): Promise<string> {
    dataRoot = await mkdtemp(join(tmpdir(), "neoj-auth-test-"));
    process.env.LOCALAPPDATA = dataRoot;
    return join(dataRoot, "neoj-nodejs", "Data", "auth.json");
}

describe("authentication data", () => {
    it("returns an empty object when no credentials are saved", async () => {
        installMemoryAuthStore();

        await expect(readAuth()).resolves.toEqual({});
    });

    it("saves and reads credentials for multiple providers", async () => {
        installMemoryAuthStore();

        await saveAuth("atcoder", { revelSession: "atcoder-session" });
        await saveAuth("codeforces", { session: "codeforces-session" });

        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "atcoder-session" },
            codeforces: { session: "codeforces-session" },
        });
    });

    it("merges partially updated provider credentials", async () => {
        installMemoryAuthStore();

        await saveAuth("codeforces", { jsessionId: "session", ftaa: "ftaa" });
        await saveAuth("codeforces", { ftaa: "new-ftaa" });

        await expect(readAuth()).resolves.toEqual({
            codeforces: { jsessionId: "session", ftaa: "new-ftaa" },
        });
    });

    it("replaces provider credentials without retaining old fields", async () => {
        installMemoryAuthStore();
        await saveAuth("yukicoder", {
            method: "token",
            token: "old-token",
            expiresAt: "2026-11-02T00:00:00Z",
        });

        await replaceAuth("yukicoder", { method: "api-key", apiKey: "api-key" });

        await expect(readAuth()).resolves.toEqual({
            yukicoder: { method: "api-key", apiKey: "api-key" },
        });
    });

    it("removes the selected provider while preserving other providers", async () => {
        installMemoryAuthStore();
        await saveAuth("atcoder", { revelSession: "atcoder-session" });
        await saveAuth("legacy", { token: "legacy-token" });

        await removeAuth(["atcoder"]);

        await expect(readAuth()).resolves.toEqual({
            legacy: { token: "legacy-token" },
        });
    });

    it("clears all credentials", async () => {
        installMemoryAuthStore();
        await saveAuth("atcoder", { revelSession: "atcoder-session" });

        await clearAuth();

        await expect(readAuth()).resolves.toEqual({});
    });

    it("migrates the legacy plaintext authentication file and deletes it", async () => {
        installMemoryAuthStore();
        const authFilePath = await setTemporaryDataDirectory();
        await Bun.write(
            authFilePath,
            `${JSON.stringify({ atcoder: { revelSession: "legacy-session" } }, null, 2)}\n`,
        );

        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "legacy-session" },
        });
        expect(await Bun.file(authFilePath).exists()).toBe(false);
    });

    it("reports the authentication file path when the legacy JSON is invalid", async () => {
        installMemoryAuthStore();
        const authFilePath = await setTemporaryDataDirectory();
        await Bun.write(authFilePath, "invalid json");

        await expect(readAuth()).rejects.toThrow(
            `Failed to parse authentication file "${authFilePath}".`,
        );
        await expect(Bun.file(authFilePath).text()).resolves.toBe("invalid json");
    });

    it("rejects legacy authentication files that do not match the schema", async () => {
        installMemoryAuthStore();
        const authFilePath = await setTemporaryDataDirectory();
        await Bun.write(authFilePath, "[]");

        await expect(readAuth()).rejects.toThrow(
            "Saved authentication data must be a JSON object.",
        );
        await expect(Bun.file(authFilePath).text()).resolves.toBe("[]");
    });

    it("does not overwrite a malformed legacy file when saving credentials", async () => {
        installMemoryAuthStore();
        const authFilePath = await setTemporaryDataDirectory();
        await Bun.write(authFilePath, "invalid json");

        await expect(saveAuth("atcoder", { revelSession: "session" })).rejects.toThrow();
        await expect(Bun.file(authFilePath).text()).resolves.toBe("invalid json");
    });

    it("rejects legacy credentials that are not strings", async () => {
        installMemoryAuthStore();
        const authFilePath = await setTemporaryDataDirectory();
        await Bun.write(authFilePath, JSON.stringify({ atcoder: { revelSession: 42 } }));

        await expect(readAuth()).rejects.toThrow(
            'Saved credential "revelSession" for atcoder must be a string.',
        );
        await expect(Bun.file(authFilePath).exists()).resolves.toBe(true);
    });

    it("falls back to the encrypted file store when the OS credential store fails", async () => {
        const authFilePath = await setTemporaryDataDirectory();
        const failingStore: AuthStore = {
            kind: "os",
            load: async () => {
                throw new Error("keyring unavailable");
            },
            set: async () => {
                throw new Error("keyring unavailable");
            },
            remove: async () => {
                throw new Error("keyring unavailable");
            },
            removeAll: async () => {
                throw new Error("keyring unavailable");
            },
        };
        setAuthStoreForTesting(failingStore);

        await saveAuth("atcoder", { revelSession: "session" });

        const encryptedPath = `${authFilePath.slice(0, -"auth.json".length)}auth.enc`;
        expect(await Bun.file(encryptedPath).exists()).toBe(true);
        await expect(readAuth()).resolves.toEqual({ atcoder: { revelSession: "session" } });
        expect(await Bun.file(authFilePath).exists()).toBe(false);
    });

    it("prefers the encrypted file in auto mode once it exists", async () => {
        const authFilePath = await setTemporaryDataDirectory();
        // Disable the injected memory store so the default backend selection
        // logic actually runs.
        setAuthStoreForTesting(undefined);

        process.env.NEOJ_SECRETS_BACKEND = "file";
        await saveAuth("atcoder", { revelSession: "file-session" });
        delete process.env.NEOJ_SECRETS_BACKEND;

        // Without the preference, auto mode would silently read the empty OS
        // credential store and report every service as logged out.
        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "file-session" },
        });
        expect(await Bun.file(authFilePath).exists()).toBe(false);
    });

    it("migrates the legacy file into the encrypted file store when the OS store fails", async () => {
        const authFilePath = await setTemporaryDataDirectory();
        await Bun.write(
            authFilePath,
            JSON.stringify({ atcoder: { revelSession: "legacy-session" } }),
        );
        const failingStore: AuthStore = {
            kind: "os",
            load: async () => {
                throw new Error("keyring unavailable");
            },
            set: async () => {
                throw new Error("keyring unavailable");
            },
            remove: async () => {
                throw new Error("keyring unavailable");
            },
            removeAll: async () => {
                throw new Error("keyring unavailable");
            },
        };
        setAuthStoreForTesting(failingStore);

        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "legacy-session" },
        });
        expect(await Bun.file(authFilePath).exists()).toBe(false);
        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "legacy-session" },
        });
    });
});
