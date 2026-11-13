import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import envPaths from "env-paths";
import latestVersion from "latest-version";

import { loadConfig, type Config } from "@/lib/util/config";

import { version as currentVersion } from "../../../package.json";

/** npm package whose dist-tags.latest tracks the neoj CLI version. */
export const updatePackageName = "@neoj/cli";

/** Default seconds between registry checks: 3 days. */
export const defaultUpdateIntervalSeconds = 3 * 24 * 60 * 60;

/** Wall-clock limit for one registry check in milliseconds. */
export const updateCheckTimeoutMs = 5_000;

const CACHE_FILE_NAME = "update-check.json";

/** Names that must never print an update notification. */
const suppressedCommands = new Set(["completions", "completion"]);

export interface UpdateCheckCache {
    /** Epoch milliseconds of the last successful registry check. */
    lastCheck: number;
    /** Version returned by the last successful registry check. */
    latestVersion: string;
}

export interface UpdateCheckOptions {
    /** Current time in epoch milliseconds; defaults to `Date.now()`. */
    now?: number;
    /** Path of the cache file; defaults to the neoj data directory. */
    cachePath?: string;
    /** Fetches the latest published version; defaults to the npm registry. */
    fetchLatest?: (packageName: string) => Promise<string>;
    /** Loads the merged configuration; defaults to `loadConfig()`. */
    loadConfig?: () => Promise<Config>;
    /** Wall-clock limit for the fetch in milliseconds. */
    timeoutMs?: number;
}

interface ParsedVersion {
    core: [number, number, number];
    prerelease: string[];
}

function parseVersion(version: string): ParsedVersion | undefined {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-((?:[0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*))?$/.exec(
        version.trim(),
    );
    if (match === null) {
        return undefined;
    }

    const core = [match[1], match[2], match[3]].map((part) => Number(part)) as [
        number,
        number,
        number,
    ];
    const prerelease = match[4] === undefined ? [] : match[4].split(".");

    return { core, prerelease };
}

function compareIdentifiers(a: string, b: string): number {
    const aNumber = /^\d+$/.test(a) ? Number(a) : undefined;
    const bNumber = /^\d+$/.test(b) ? Number(b) : undefined;
    if (aNumber !== undefined && bNumber !== undefined) {
        return Math.sign(aNumber - bNumber);
    }
    if (aNumber !== undefined) {
        return -1;
    }
    if (bNumber !== undefined) {
        return 1;
    }

    return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver-style comparison: negative when `a` < `b`, zero when equal, positive when `a` > `b`. */
export function compareVersions(a: string, b: string): number {
    const parsedA = parseVersion(a);
    const parsedB = parseVersion(b);
    if (parsedA === undefined || parsedB === undefined) {
        return a === b ? 0 : a < b ? -1 : 1;
    }

    for (let index = 0; index < 3; index += 1) {
        const difference = Math.sign((parsedA.core[index] ?? 0) - (parsedB.core[index] ?? 0));
        if (difference !== 0) {
            return difference;
        }
    }

    if (parsedA.prerelease.length !== parsedB.prerelease.length) {
        if (parsedA.prerelease.length === 0) {
            return 1;
        }
        if (parsedB.prerelease.length === 0) {
            return -1;
        }
    }

    const length = Math.min(parsedA.prerelease.length, parsedB.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const difference = compareIdentifiers(
            parsedA.prerelease[index] ?? "",
            parsedB.prerelease[index] ?? "",
        );
        if (difference !== 0) {
            return difference;
        }
    }

    return 0;
}

/** Whether `candidate` is strictly newer than `current`. */
export function isNewerVersion(current: string, candidate: string): boolean {
    return compareVersions(candidate, current) > 0;
}

/** One-line notification shown by `consola.info` when an update is available. */
export function formatUpdateMessage(currentVersion: string, latestVersion: string): string {
    return `Update available: ${currentVersion} → ${latestVersion}. Run: npm install -g ${updatePackageName}@latest`;
}

export function updateCacheFilePath(): string {
    return join(envPaths("neoj").data, CACHE_FILE_NAME);
}

async function readUpdateCache(path: string): Promise<UpdateCheckCache | null> {
    try {
        const file = Bun.file(path);
        if (!(await file.exists())) {
            return null;
        }

        const parsed = JSON.parse(await file.text()) as unknown;
        if (
            typeof parsed !== "object" ||
            parsed === null ||
            typeof (parsed as Record<string, unknown>).lastCheck !== "number" ||
            typeof (parsed as Record<string, unknown>).latestVersion !== "string"
        ) {
            return null;
        }

        return parsed as UpdateCheckCache;
    } catch {
        // A malformed cache is not worth reporting; the next check refetches it.
        return null;
    }
}

async function writeUpdateCache(cache: UpdateCheckCache, path: string): Promise<void> {
    // Best effort only: a failed cache write must never surface to the user.
    try {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const temporaryPath = `${path}.tmp`;
        await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`);
        await rename(temporaryPath, path);
    } catch {
        // Ignore; the next run simply rechecks.
    }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`timed out after ${timeoutMs} ms`)),
                timeoutMs,
            );
        }),
    ]).finally(() => {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    });
}

/**
 * Returns the notification to print, or `undefined` when there is nothing to
 * report. Never throws: any failure (disabled in config, fresh cache, offline,
 * malformed data) silently skips the notification.
 */
export async function getPendingUpdateNotification(
    options: UpdateCheckOptions = {},
): Promise<string | undefined> {
    try {
        const config = await (options.loadConfig?.() ?? loadConfig());
        if (!config.update.enabled) {
            return undefined;
        }

        const now = options.now ?? Date.now();
        const intervalMs = config.update.interval * 1000;
        const cachePath = options.cachePath ?? updateCacheFilePath();
        const cache = await readUpdateCache(cachePath);

        let latest: string | undefined;
        if (
            cache !== null &&
            Number.isFinite(cache.lastCheck) &&
            cache.lastCheck <= now &&
            now - cache.lastCheck < intervalMs &&
            cache.latestVersion.length > 0
        ) {
            latest = cache.latestVersion;
        } else {
            try {
                latest = await withTimeout(
                    options.fetchLatest?.(updatePackageName) ?? latestVersion(updatePackageName),
                    options.timeoutMs ?? updateCheckTimeoutMs,
                );
            } catch {
                return undefined;
            }

            await writeUpdateCache({ lastCheck: now, latestVersion: latest }, cachePath);
        }

        if (!isNewerVersion(currentVersion, latest)) {
            return undefined;
        }

        return formatUpdateMessage(currentVersion, latest);
    } catch {
        return undefined;
    }
}

/** Whether the given first command word suppresses the update notification. */
export function isUpdateNotificationSuppressed(command: string | undefined): boolean {
    return command !== undefined && suppressedCommands.has(command);
}
