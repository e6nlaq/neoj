import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAuth, saveAuth } from "@/lib/util/auth";

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

async function setTemporaryDataDirectory(): Promise<string> {
    dataRoot = await mkdtemp(join(tmpdir(), "neoj-auth-test-"));
    process.env.LOCALAPPDATA = dataRoot;
    return join(dataRoot, "neoj-nodejs", "Data", "auth.json");
}

describe("authentication data", () => {
    it("returns an empty object when no authentication file exists", async () => {
        await setTemporaryDataDirectory();

        await expect(readAuth()).resolves.toEqual({});
    });

    it("saves and reads credentials for multiple providers", async () => {
        const authFilePath = await setTemporaryDataDirectory();

        await saveAuth("atcoder", { revelSession: "atcoder-session" });
        await saveAuth("codeforces", { session: "codeforces-session" });

        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "atcoder-session" },
            codeforces: { session: "codeforces-session" },
        });
        expect(await Bun.file(authFilePath).exists()).toBe(true);
    });

    it("rejects authentication files that do not match the Valibot schema", async () => {
        const authFilePath = await setTemporaryDataDirectory();
        await Bun.write(authFilePath, "[]");

        await expect(readAuth()).rejects.toThrow(
            "Saved authentication data must be a JSON object.",
        );
    });

    it("does not overwrite malformed JSON when saving credentials", async () => {
        const authFilePath = await setTemporaryDataDirectory();
        await Bun.write(authFilePath, "invalid json");

        await expect(saveAuth("atcoder", { revelSession: "session" })).rejects.toThrow();
        await expect(Bun.file(authFilePath).text()).resolves.toBe("invalid json");
    });

    it("reports the authentication file path when the JSON is invalid", async () => {
        const authFilePath = await setTemporaryDataDirectory();
        await Bun.write(authFilePath, "invalid json");

        await expect(readAuth()).rejects.toThrow(
            `Failed to parse authentication file "${authFilePath}".`,
        );
    });

    it("writes credentials atomically without leaving a temporary file", async () => {
        const authFilePath = await setTemporaryDataDirectory();

        await saveAuth("atcoder", { revelSession: "session" });

        expect(await Bun.file(`${authFilePath}.tmp`).exists()).toBe(false);
        await expect(Bun.file(authFilePath).text()).resolves.toBe(
            `${JSON.stringify({ atcoder: { revelSession: "session" } }, null, 2)}\n`,
        );
    });
});
