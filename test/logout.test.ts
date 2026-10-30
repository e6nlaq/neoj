import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAuth, saveAuth } from "@/lib/util/auth";

const originalLocalAppData = process.env.LOCALAPPDATA;
let dataRoot: string | undefined;
const confirmPrompt = mock(async () => false);

mock.module("@inquirer/prompts", () => ({
    confirm: confirmPrompt,
    password: mock(async () => ""),
}));

const { logoutServices } = await import("@/feature/logout");

async function setupDataDirectory(): Promise<void> {
    dataRoot = await mkdtemp(join(tmpdir(), "neoj-logout-test-"));
    process.env.LOCALAPPDATA = dataRoot;
}

afterEach(async () => {
    confirmPrompt.mockReset().mockImplementation(async () => false);

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

describe("logoutServices", () => {
    it("does not prompt when no saved credentials exist", async () => {
        await setupDataDirectory();

        await logoutServices();

        expect(confirmPrompt).not.toHaveBeenCalled();
    });

    it("confirms once before removing all authentication data", async () => {
        await setupDataDirectory();
        await saveAuth("atcoder", { revelSession: "atcoder-session" });
        await saveAuth("legacy", { token: "legacy-token" });
        confirmPrompt.mockImplementation(async () => true);

        await logoutServices();

        expect(confirmPrompt).toHaveBeenCalledTimes(1);
        expect(confirmPrompt).toHaveBeenCalledWith({
            message: "Log out of all services (AtCoder, legacy)?",
            default: false,
        });
        await expect(readAuth()).resolves.toEqual({});
    });

    it("retains all authentication data when all-service logout is cancelled", async () => {
        await setupDataDirectory();
        await saveAuth("atcoder", { revelSession: "atcoder-session" });

        await logoutServices();

        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "atcoder-session" },
        });
    });

    it("removes the selected provider while preserving other providers", async () => {
        await setupDataDirectory();
        await saveAuth("atcoder", { revelSession: "atcoder-session" });
        await saveAuth("legacy", { token: "legacy-token" });
        confirmPrompt.mockImplementation(async () => true);

        await logoutServices(["atcoder"]);

        expect(confirmPrompt).toHaveBeenCalledWith({
            message: "Log out of AtCoder?",
            default: false,
        });
        await expect(readAuth()).resolves.toEqual({
            legacy: { token: "legacy-token" },
        });
    });

    it("skips confirmation when selected providers have no saved credentials", async () => {
        await setupDataDirectory();

        await logoutServices(["atcoder"]);

        expect(confirmPrompt).not.toHaveBeenCalled();
    });

    it("rejects unknown services without removing any credentials", async () => {
        await setupDataDirectory();
        await saveAuth("atcoder", { revelSession: "atcoder-session" });

        await expect(logoutServices(["atcoder", "unknown"])).rejects.toThrow(
            "Unsupported service: unknown. Supported services: atcoder.",
        );

        expect(confirmPrompt).not.toHaveBeenCalled();
        await expect(readAuth()).resolves.toEqual({
            atcoder: { revelSession: "atcoder-session" },
        });
    });

    it("deletes the auth file when the selected provider was the last entry", async () => {
        await setupDataDirectory();
        await saveAuth("atcoder", { revelSession: "atcoder-session" });
        confirmPrompt.mockImplementation(async () => true);

        await logoutServices(["atcoder"]);

        const authFile = Bun.file(join(dataRoot!, "neoj-nodejs", "Data", "auth.json"));
        expect(await authFile.exists()).toBe(false);
    });
});
