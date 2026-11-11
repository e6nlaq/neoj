import { extractAojProblemId, parseAojProblemUrl } from "./aoj.js";
import { parseAtCoderProblemUrl } from "./atcoder.js";
import { extractCodeforcesProblemRoute, parseCodeforcesProblemUrl } from "./codeforces.js";
import type { ProblemKey } from "./problem.js";
import {
    extractShareOjShortId,
    parseShareOjContestProblemUrl,
    parseShareOjProblemUrl,
} from "./shareoj.js";
import { parseYukicoderProblemRoute, parseYukicoderProblemUrl } from "./yukicoder.js";

function matchesUrl(parse: (value: string) => unknown, url: string): boolean {
    try {
        parse(url);
        return true;
    } catch {
        return false;
    }
}

function matchesAtCoderProblem(url: string): boolean {
    return matchesUrl(parseAtCoderProblemUrl, url);
}

function matchesYukicoderProblem(url: string): boolean {
    return matchesUrl(parseYukicoderProblemUrl, url);
}

function matchesAojProblem(url: string): boolean {
    return matchesUrl(parseAojProblemUrl, url);
}

function matchesCodeforcesProblem(url: string): boolean {
    return matchesUrl(parseCodeforcesProblemUrl, url);
}

function matchesShareOjProblem(url: string): boolean {
    return (
        matchesUrl(parseShareOjProblemUrl, url) || matchesUrl(parseShareOjContestProblemUrl, url)
    );
}

const PROBLEM_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function deriveSlug(pathname: string, url: string): string {
    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    const slug = segments[segments.length - 1];
    if (slug === undefined || !PROBLEM_SLUG_PATTERN.test(slug)) {
        throw new TypeError(`Could not derive a stash name from "${url}".`);
    }

    return slug;
}

/**
 * The stable `platform/slug` key of a supported problem URL.
 *
 * Platforms whose URL does not map to one synchronously (a ShareOJ contest
 * problem URL resolves its problem ID through the API) are rejected; callers
 * should use the key recorded in `.neoj/problem.json` instead.
 */
export function deriveProblemKey(url: string): ProblemKey {
    if (matchesAtCoderProblem(url)) {
        const problemUrl = parseAtCoderProblemUrl(url);
        return { platform: "atcoder", slug: deriveSlug(problemUrl.pathname, url) };
    }

    if (matchesYukicoderProblem(url)) {
        const route = parseYukicoderProblemRoute(url);
        return {
            platform: "yukicoder",
            slug: `${route.kind === "no" ? "no" : "id"}${route.number}`,
        };
    }

    if (matchesAojProblem(url)) {
        // v1 and v2 URLs of the same problem share one slug, so re-downloading
        // through either form preserves the working files.
        return { platform: "aoj", slug: extractAojProblemId(url) };
    }

    if (matchesCodeforcesProblem(url)) {
        // /contest and /problemset URLs of the same problem share one slug.
        const { contestId, index } = extractCodeforcesProblemRoute(url);
        return { platform: "codeforces", slug: `${contestId}${index}` };
    }

    if (matchesShareOjProblem(url)) {
        if (matchesUrl(parseShareOjProblemUrl, url)) {
            return { platform: "shareoj", slug: extractShareOjShortId(url) };
        }
        // A contest problem URL resolves its problem ID through the API, so it
        // cannot be derived offline. `neoj download` stores the resolved key
        // in `.neoj/problem.json` instead.
        throw new TypeError(
            `Could not derive a stash name from "${url}" offline. Run "neoj download ${url}" again to record the problem key.`,
        );
    }

    throw new TypeError(
        "Expected a problem URL from a supported platform (AtCoder, yukicoder, Aizu Online Judge, Codeforces, ShareOJ).",
    );
}
