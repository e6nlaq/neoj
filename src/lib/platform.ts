/**
 * Platforms neoj supports for language lists and submissions, in the order the
 * CLI lists them. Download-only sources such as AOJ are not included.
 */
export const platformNames = ["atcoder", "yukicoder", "shareoj", "codeforces"] as const;

export type PlatformName = (typeof platformNames)[number];

/** Whether `value` names a platform neoj can configure for submission. */
export function isPlatformName(value: string): value is PlatformName {
    return (platformNames as readonly string[]).includes(value);
}
