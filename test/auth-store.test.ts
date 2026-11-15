import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./helpers/mock-auth-paths";
import { createOsAuthStore } from "@/lib/auth-store";

const { readAuth, saveAuth, replaceAuth, removeAuth, clearAuth, setAuthStoreForTesting } =
    await import("@/lib/auth");

const originalLocalAppData = process.env.LOCALAPPDATA;
const originalBackend = process.env.NEOJ_SECRETS_BACKEND;
let dataRoot: string | undefined;

afterEach(async () => {
    setAuthStoreForTesting(undefined);
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

function setTemporaryDataDirectory(): string {
    return join(dataRoot!, "neoj-nodejs", "Data");
}

async function useFileBackend(): Promise<string> {
    dataRoot = await mkdtemp(join(tmpdir(), "neoj-auth-store-test-"));
    process.env.LOCALAPPDATA = dataRoot;
    process.env.NEOJ_SECRETS_BACKEND = "file";
    return setTemporaryDataDirectory();
}

describe("encrypted file authentication store", () => {
    it("round-trips credentials through the encrypted file", async () => {
        const dataDirectory = await useFileBackend();

        await saveAuth("atcoder", { revelSession: "atcoder-session" });
        await saveAuth("codeforces", { jsessionId: "session", ftaa: "ftaa" });

        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "atcoder-session" },
            codeforces: { jsessionId: "session", ftaa: "ftaa" },
        });
        expect(await Bun.file(join(dataDirectory, "auth.enc")).exists()).toBe(true);
        expect(await Bun.file(join(dataDirectory, "auth.json")).exists()).toBe(false);

        const contents = await Bun.file(join(dataDirectory, "auth.enc")).text();
        expect(contents).not.toContain("atcoder-session");
        expect(contents).toContain("aes-256-gcm");
    });

    it("keeps the encryption key stable across saves", async () => {
        const dataDirectory = await useFileBackend();

        await saveAuth("atcoder", { revelSession: "first" });
        const keyPath = join(dataDirectory, "auth.key");
        const firstKey = await Bun.file(keyPath).text();
        await saveAuth("atcoder", { revelSession: "second" });
        await expect(Bun.file(keyPath).text()).resolves.toBe(firstKey);
    });

    it("writes without leaving a temporary file", async () => {
        const dataDirectory = await useFileBackend();

        await saveAuth("atcoder", { revelSession: "session" });

        expect(await readdir(dataDirectory)).not.toContain("auth.enc.tmp");
    });

    it("reports the file path when the encrypted file is not valid JSON", async () => {
        const dataDirectory = await useFileBackend();
        const encryptedPath = join(dataDirectory, "auth.enc");
        await Bun.write(encryptedPath, "not json");

        await expect(readAuth()).rejects.toThrow(
            `Failed to parse the authentication file "${encryptedPath}".`,
        );
    });

    it("rejects envelopes with an unsupported format", async () => {
        const dataDirectory = await useFileBackend();
        await saveAuth("atcoder", { revelSession: "session" });
        await Bun.write(join(dataDirectory, "auth.enc"), JSON.stringify({ v: 999 }));

        await expect(readAuth()).rejects.toThrow("has an unsupported format");
    });

    it("detects a tampered encrypted file", async () => {
        const dataDirectory = await useFileBackend();
        const encryptedPath = join(dataDirectory, "auth.enc");
        await saveAuth("atcoder", { revelSession: "session" });

        const contents = await Bun.file(encryptedPath).text();
        const envelope = JSON.parse(contents) as { data: string };
        const data = Buffer.from(envelope.data, "base64");
        const lastIndex = data.length - 1;
        data[lastIndex]! ^= 0x01;
        envelope.data = data.toString("base64");
        await Bun.write(encryptedPath, JSON.stringify(envelope));

        await expect(readAuth()).rejects.toThrow(
            `Failed to decrypt the authentication file "${encryptedPath}".`,
        );
    });

    it("removes the encrypted file and key when clearing all credentials", async () => {
        const dataDirectory = await useFileBackend();
        await saveAuth("atcoder", { revelSession: "session" });

        await clearAuth();

        expect(await Bun.file(join(dataDirectory, "auth.enc")).exists()).toBe(false);
        expect(await Bun.file(join(dataDirectory, "auth.key")).exists()).toBe(false);
    });

    it("removes the encrypted file when the last provider is removed", async () => {
        const dataDirectory = await useFileBackend();
        await saveAuth("atcoder", { revelSession: "session" });

        await removeAuth(["atcoder"]);

        expect(await Bun.file(join(dataDirectory, "auth.enc")).exists()).toBe(false);
        await expect(readAuth()).resolves.toEqual({});
    });

    it("migrates the legacy plaintext file into the encrypted file", async () => {
        const dataDirectory = await useFileBackend();
        const legacyPath = join(dataDirectory, "auth.json");
        await Bun.write(
            legacyPath,
            JSON.stringify({ yukicoder: { method: "api-key", apiKey: "key" } }),
        );

        await expect(readAuth()).resolves.toEqual({
            yukicoder: { method: "api-key", apiKey: "key" },
        });
        expect(await Bun.file(legacyPath).exists()).toBe(false);
        expect(await Bun.file(join(dataDirectory, "auth.enc")).exists()).toBe(true);
    });

    it("preserves other providers when replacing one provider", async () => {
        await useFileBackend();
        await saveAuth("atcoder", { revelSession: "session" });
        await saveAuth("yukicoder", { method: "token", token: "old" });

        await replaceAuth("yukicoder", { method: "api-key", apiKey: "key" });

        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "session" },
            yukicoder: { method: "api-key", apiKey: "key" },
        });
    });
});

describe("OS credential store wrapper", () => {
    interface FakeSecrets {
        client: {
            get(options: { service: string; name: string }): Promise<string | null>;
            set(options: {
                service: string;
                name: string;
                value: string;
                persist?: "local" | "enterprise";
            }): Promise<void>;
            delete(options: { service: string; name: string }): Promise<boolean>;
        };
        entries: Map<string, string>;
        setOptions: Array<{ service: string; name: string; value: string; persist?: string }>;
    }

    function createFakeSecrets(): FakeSecrets {
        const entries = new Map<string, string>();
        const setOptions: FakeSecrets["setOptions"] = [];
        const identity = (options: { service: string; name: string }): string =>
            `${options.service}\u0000${options.name}`;
        return {
            entries,
            setOptions,
            client: {
                get: async (options) => entries.get(identity(options)) ?? null,
                set: async (options) => {
                    entries.set(identity(options), options.value);
                    setOptions.push(options);
                },
                delete: async (options) => entries.delete(identity(options)),
            },
        };
    }

    it("stores credentials per provider and key with local persistence", async () => {
        const dataDirectory = await useFileBackend();
        const fake = createFakeSecrets();
        const store = createOsAuthStore(fake.client);

        await store.set("atcoder", "revelSession", "session");

        expect(fake.entries.get("dev.neoj.cli\u0000atcoder/revelSession")).toBe("session");
        expect(fake.setOptions).toEqual([
            {
                service: "dev.neoj.cli",
                name: "atcoder/revelSession",
                value: "session",
                persist: "local",
            },
        ]);
        await expect(Bun.file(join(dataDirectory, "auth-index.json")).text()).resolves.toBe(
            '{"atcoder":["revelSession"]}\n',
        );
        await expect(store.load()).resolves.toEqual({
            atcoder: { revelSession: "session" },
        });
    });

    it("returns an empty object when no index exists", async () => {
        await useFileBackend();
        const store = createOsAuthStore(createFakeSecrets().client);

        await expect(store.load()).resolves.toEqual({});
    });

    it("removes a credential and drops empty providers from the index", async () => {
        await useFileBackend();
        const fake = createFakeSecrets();
        const store = createOsAuthStore(fake.client);
        await store.set("atcoder", "revelSession", "session");

        await store.remove("atcoder", "revelSession");

        expect(fake.entries.size).toBe(0);
        await expect(store.load()).resolves.toEqual({});
    });

    it("removes every credential and the index file on removeAll", async () => {
        const dataDirectory = await useFileBackend();
        const fake = createFakeSecrets();
        const store = createOsAuthStore(fake.client);
        await store.set("atcoder", "revelSession", "session");
        await store.set("codeforces", "jsessionId", "session");

        await store.removeAll();

        expect(fake.entries.size).toBe(0);
        expect(await Bun.file(join(dataDirectory, "auth-index.json")).exists()).toBe(false);
    });

    it("reports the index path when the index file is malformed", async () => {
        const dataDirectory = await useFileBackend();
        const store = createOsAuthStore(createFakeSecrets().client);
        await Bun.write(join(dataDirectory, "auth-index.json"), "[]");

        await expect(store.load()).rejects.toThrow(
            `The authentication index file "${join(dataDirectory, "auth-index.json")}" must contain a JSON object.`,
        );
    });
});
