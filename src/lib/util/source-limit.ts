import { formatBytes } from "./bytes";

/**
 * The size of one source file each platform accepts, in UTF-8 bytes.
 *
 * - AtCoder documents 512 KiB on its submission form for every language.
 * - yukicoder documents 128 KB (131,072 bytes) in its help page.
 * - ShareOJ enforces 128 KiB in its API and in its submission form.
 * - Codeforces documents 256 KB on its submission form.
 *
 * `--ignore-limit` and `submit.check_limit = false` let a submission through
 * when a platform changes its limit before this table is updated.
 */
export const sourceLimitBytes = {
    atcoder: 512 * 1024,
    yukicoder: 128 * 1024,
    shareoj: 128 * 1024,
    codeforces: 256 * 1024,
} as const;

export type SourceLimitPlatform = keyof typeof sourceLimitBytes;

/** The limit as a short label, e.g. `512 KiB`. */
export function formatSourceLimit(platform: SourceLimitPlatform): string {
    const bytes = sourceLimitBytes[platform];
    // Every documented limit is a whole number of KiB, which reads better
    // without the ".0" that a general byte formatter would print.
    return bytes % 1024 === 0 ? `${bytes / 1024} KiB` : formatBytes(bytes);
}
