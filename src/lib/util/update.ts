import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { USER_AGENT } from "@neoj/api";
import envPaths from "env-paths";
import semver from "semver";

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

/** Whether `candidate` is strictly newer than `current`. */
export function isNewerVersion(current: string, candidate: string): boolean {
    const parsedCurrent = semver.coerce(current, { includePrerelease: true });
    const parsedCandidate = semver.coerce(candidate, { includePrerelease: true });
    if (parsedCurrent === null || parsedCandidate === null) {
        // Unparseable versions cannot be ordered; notify on any difference.
        return candidate !== current;
    }

    return semver.gt(parsedCandidate, parsedCurrent);
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

/**
 * Read `dist-tags.latest` from the npm registry with an abortable timeout.
 *
 * The previous implementation raced the request against a timer without
 * cancelling it, so the HTTP request kept running after the notification was
 * skipped. The signal makes the timeout stop the request itself.
 */
export async function fetchLatestVersionFromRegistry(
    packageName: string,
    timeoutMs: number = updateCheckTimeoutMs,
): Promise<string> {
    const encodedPackageName = encodeURIComponent(packageName).replace(/^%40/u, "@");
    const response = await fetch(`https://registry.npmjs.org/${encodedPackageName}`, {
        headers: {
            Accept: "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
            "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
        throw new Error(`npm registry request failed with status ${response.status}.`);
    }

    const body = (await response.json()) as unknown;
    if (typeof body !== "object" || body === null) {
        throw new Error("npm registry response was not an object.");
    }

    const distTags = (body as Record<string, unknown>)["dist-tags"];
    if (typeof distTags !== "object" || distTags === null) {
        throw new Error("npm registry response did not contain dist-tags.");
    }

    const latest = (distTags as Record<string, unknown>).latest;
    if (typeof latest !== "string" || latest.length === 0) {
        throw new Error("npm registry response did not contain dist-tags.latest.");
    }

    return latest;
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
            const timeoutMs = options.timeoutMs ?? updateCheckTimeoutMs;
            try {
                latest = await withTimeout(
                    options.fetchLatest?.(updatePackageName) ??
                        fetchLatestVersionFromRegistry(updatePackageName, timeoutMs),
                    timeoutMs,
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
