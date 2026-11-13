import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import * as v from "valibot";

import type { Config } from "@/lib/util/config";
import {
    compareVersions,
    defaultUpdateIntervalSeconds,
    formatUpdateMessage,
    getPendingUpdateNotification,
    isUpdateNotificationSuppressed,
    isNewerVersion,
    type UpdateCheckCache,
} from "@/lib/util/update";

import { version as currentVersion } from "../package.json";

const originalCwd = process.cwd();
let testRoot: string | undefined;

afterEach(async () => {
    process.chdir(originalCwd);
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true, maxRetries: 5 });
        testRoot = undefined;
    }
});

function stubConfig(update: Partial<Config["update"]>): () => Promise<Config> {
    return async () =>
        ({
            update: { enabled: update.enabled ?? true, interval: update.interval ?? 259_200 },
        }) as unknown as Config;
}

async function createCachePath(): Promise<string> {
    testRoot = await mkdtemp(join(dirname(originalCwd), "neoj-update-test-"));
    return join(testRoot, "data", "update-check.json");
}

async function writeCache(path: string, cache: UpdateCheckCache): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`);
}

describe("compareVersions", () => {
    it("orders release versions numerically", () => {
        expect(compareVersions("0.0.8", "0.0.8")).toBe(0);
        expect(compareVersions("0.0.9", "0.0.8")).toBe(1);
        expect(compareVersions("0.1.0", "0.0.99")).toBe(1);
        expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
        expect(compareVersions("0.0.10", "0.0.9")).toBe(1);
    });

    it("treats a prerelease as older than its release", () => {
        expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
        expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.1")).toBe(1);
        expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBe(1);
    });

    it("falls back to string comparison for non-semver input", () => {
        expect(compareVersions("abc", "abc")).toBe(0);
        expect(compareVersions("abc", "abd")).toBe(-1);
    });
});

describe("isNewerVersion", () => {
    it("reports only strictly newer candidates", () => {
        expect(isNewerVersion("0.0.8", "0.0.9")).toBe(true);
        expect(isNewerVersion("0.0.8", "0.0.8")).toBe(false);
        expect(isNewerVersion("0.0.8", "0.0.7")).toBe(false);
        expect(isNewerVersion("1.0.0", "1.0.0-rc.1")).toBe(false);
    });
});

describe("formatUpdateMessage", () => {
    it("shows the current and latest versions and the update command", () => {
        const message = formatUpdateMessage("0.0.8", "0.0.9");

        expect(message).toContain("0.0.8");
        expect(message).toContain("0.0.9");
        expect(message).toContain("npm install -g @neoj/cli@latest");
    });
});

describe("isUpdateNotificationSuppressed", () => {
    it("suppresses the completions command and its aliases only", () => {
        expect(isUpdateNotificationSuppressed("completions")).toBe(true);
        expect(isUpdateNotificationSuppressed("completion")).toBe(true);
        expect(isUpdateNotificationSuppressed("test")).toBe(false);
        expect(isUpdateNotificationSuppressed(undefined)).toBe(false);
    });
});

describe("getPendingUpdateNotification", () => {
    const baseOptions = {
        now: 1_000_000,
        loadConfig: stubConfig({}),
        fetchLatest: async () => "9.9.9",
    };

    it("notifies from a fresh cache without touching the network", async () => {
        const cachePath = await createCachePath();
        await writeCache(cachePath, {
            lastCheck: 1_000_000 - defaultUpdateIntervalSeconds * 1000 + 1000,
            latestVersion: "9.9.9",
        });

        let fetchCalls = 0;
        const notification = await getPendingUpdateNotification({
            ...baseOptions,
            cachePath,
            fetchLatest: async () => {
                fetchCalls += 1;
                return "9.9.9";
            },
        });

        expect(notification).toBe(formatUpdateMessage(currentVersion, "9.9.9"));
        expect(fetchCalls).toBe(0);
    });

    it("does not notify when the cache is fresh and current is up to date", async () => {
        const cachePath = await createCachePath();
        await writeCache(cachePath, { lastCheck: 1_000_000, latestVersion: currentVersion });

        const notification = await getPendingUpdateNotification({
            ...baseOptions,
            cachePath,
            fetchLatest: async () => {
                throw new Error("must not be called");
            },
        });

        expect(notification).toBeUndefined();
    });

    it("refetches when the cache is stale and writes the result back", async () => {
        const cachePath = await createCachePath();
        await writeCache(cachePath, {
            lastCheck: 0,
            latestVersion: currentVersion,
        });

        const notification = await getPendingUpdateNotification({
            ...baseOptions,
            now: defaultUpdateIntervalSeconds * 1000 + 1,
            cachePath,
        });

        expect(notification).toBe(formatUpdateMessage(currentVersion, "9.9.9"));
        const written = (JSON.parse(await readFile(cachePath, "utf8")) as UpdateCheckCache)
            .latestVersion;
        expect(written).toBe("9.9.9");
    });

    it("stays silent when the fetch fails", async () => {
        const cachePath = await createCachePath();
        await writeCache(cachePath, { lastCheck: 0, latestVersion: currentVersion });

        const notification = await getPendingUpdateNotification({
            ...baseOptions,
            cachePath,
            fetchLatest: async () => {
                throw new Error("offline");
            },
        });

        expect(notification).toBeUndefined();
    });

    it("stays silent when the fetch exceeds the timeout", async () => {
        const cachePath = await createCachePath();

        const notification = await getPendingUpdateNotification({
            ...baseOptions,
            cachePath,
            timeoutMs: 10,
            fetchLatest: () => new Promise<string>(() => undefined),
        });

        expect(notification).toBeUndefined();
    });

    it("treats a malformed cache as a miss", async () => {
        const cachePath = await createCachePath();
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, "not json");

        const notification = await getPendingUpdateNotification({
            ...baseOptions,
            cachePath,
        });

        expect(notification).toBe(formatUpdateMessage(currentVersion, "9.9.9"));
    });

    it("does nothing when the notification is disabled", async () => {
        const cachePath = await createCachePath();

        const notification = await getPendingUpdateNotification({
            ...baseOptions,
            cachePath,
            loadConfig: stubConfig({ enabled: false }),
            fetchLatest: async () => {
                throw new Error("must not be called");
            },
        });

        expect(notification).toBeUndefined();
        expect(await Bun.file(cachePath).exists()).toBe(false);
    });

    it("respects a custom check interval", async () => {
        const cachePath = await createCachePath();
        await writeCache(cachePath, { lastCheck: 1_000_000 - 1000, latestVersion: currentVersion });

        const freshWithinLongInterval = await getPendingUpdateNotification({
            ...baseOptions,
            cachePath,
            loadConfig: stubConfig({ interval: defaultUpdateIntervalSeconds }),
        });
        expect(freshWithinLongInterval).toBeUndefined();

        const staleWithShortInterval = await getPendingUpdateNotification({
            ...baseOptions,
            cachePath,
            loadConfig: stubConfig({ interval: 0 }),
        });
        expect(staleWithShortInterval).toBe(formatUpdateMessage(currentVersion, "9.9.9"));
    });

    it("stays silent when the configuration cannot be loaded", async () => {
        const notification = await getPendingUpdateNotification({
            ...baseOptions,
            loadConfig: async () => {
                throw new Error("broken config");
            },
            fetchLatest: async () => {
                throw new Error("must not be called");
            },
        });

        expect(notification).toBeUndefined();
    });
});

describe("config schema", () => {
    it("applies the update defaults", async () => {
        const { configSchema } = await import("@/lib/util/config");

        const parsed = v.parse(configSchema, {});
        expect(parsed.update).toEqual({ enabled: true, interval: defaultUpdateIntervalSeconds });

        expect(() => v.parse(configSchema, { update: { interval: -1 } })).toThrow();
        expect(() => v.parse(configSchema, { update: { unknown: true } })).toThrow();
    });
});
