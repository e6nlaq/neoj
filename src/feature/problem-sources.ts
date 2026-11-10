import { getAtCoderSession } from "@/feature/login/atcoder";
import { extractAojProblemId, parseAojProblemUrl, AojClient } from "@/lib/service/aoj";
import {
    AtCoderClient,
    AtCoderProblemRequestError,
    parseAtCoderProblemUrl,
} from "@/lib/service/atcoder";
import {
    CodeforcesClient,
    extractCodeforcesProblemRoute,
    parseCodeforcesProblemUrl,
} from "@/lib/service/codeforces";
import type { Problem } from "@/lib/service/problem";
import {
    extractShareOjShortId,
    parseShareOjContestProblemUrl,
    parseShareOjProblemUrl,
    ShareOjClient,
} from "@/lib/service/shareoj";
import {
    parseYukicoderProblemRoute,
    parseYukicoderProblemUrl,
    YukicoderClient,
} from "@/lib/service/yukicoder";
import { readAuth } from "@/lib/util/auth";
import type { ProblemKey } from "@/lib/util/stash";

export interface ProblemSource {
    name: string;
    displayName: string;
    matches(url: string): boolean;
    fetchProblem(url: string): Promise<Problem>;
}

export async function getProblemWithLoginHint(
    url: string,
    client: Pick<AtCoderClient, "getProblem">,
    loggedIn: boolean,
) {
    try {
        return await client.getProblem(url);
    } catch (error) {
        if (error instanceof AtCoderProblemRequestError && error.status === 404 && !loggedIn) {
            throw new Error(
                `${error.message} If the problem requires an account, try "neoj login atcoder".`,
                { cause: error },
            );
        }
        throw error;
    }
}

async function fetchAtCoderProblem(url: string): Promise<Problem> {
    const auth = await readAuth();
    const client = new AtCoderClient();
    const savedSession = getAtCoderSession(auth.atcoder);
    const loggedIn = savedSession === undefined ? false : await client.login(savedSession);

    return getProblemWithLoginHint(url, client, loggedIn);
}

async function fetchYukicoderProblem(url: string): Promise<Problem> {
    return new YukicoderClient().getProblem(url);
}

async function fetchAojProblem(url: string): Promise<Problem> {
    return new AojClient().getProblem(url);
}

async function fetchCodeforcesProblem(url: string): Promise<Problem> {
    return new CodeforcesClient().getProblem(url);
}

async function fetchShareOjProblem(url: string): Promise<Problem> {
    return new ShareOjClient().getProblem(url);
}

function matchesAtCoderProblem(url: string): boolean {
    try {
        parseAtCoderProblemUrl(url);
        return true;
    } catch {
        return false;
    }
}

function matchesYukicoderProblem(url: string): boolean {
    try {
        parseYukicoderProblemUrl(url);
        return true;
    } catch {
        return false;
    }
}

function matchesAojProblem(url: string): boolean {
    try {
        parseAojProblemUrl(url);
        return true;
    } catch {
        return false;
    }
}

function matchesCodeforcesProblem(url: string): boolean {
    try {
        parseCodeforcesProblemUrl(url);
        return true;
    } catch {
        return false;
    }
}

function isDirectShareOjProblemUrl(url: string): boolean {
    try {
        parseShareOjProblemUrl(url);
        return true;
    } catch {
        return false;
    }
}

function matchesShareOjProblem(url: string): boolean {
    return (
        matchesUrl(parseShareOjProblemUrl, url) || matchesUrl(parseShareOjContestProblemUrl, url)
    );
}

function matchesUrl(parse: (value: string) => unknown, url: string): boolean {
    try {
        parse(url);
        return true;
    } catch {
        return false;
    }
}

export const problemSources: ProblemSource[] = [
    {
        name: "atcoder",
        displayName: "AtCoder",
        matches: matchesAtCoderProblem,
        fetchProblem: fetchAtCoderProblem,
    },
    {
        name: "yukicoder",
        displayName: "yukicoder",
        matches: matchesYukicoderProblem,
        fetchProblem: fetchYukicoderProblem,
    },
    {
        name: "aoj",
        displayName: "Aizu Online Judge",
        matches: matchesAojProblem,
        fetchProblem: fetchAojProblem,
    },
    {
        name: "codeforces",
        displayName: "Codeforces",
        matches: matchesCodeforcesProblem,
        fetchProblem: fetchCodeforcesProblem,
    },
    {
        name: "shareoj",
        displayName: "ShareOJ",
        matches: matchesShareOjProblem,
        fetchProblem: fetchShareOjProblem,
    },
];

export function findProblemSource(url: string): ProblemSource {
    const source = problemSources.find((candidate) => candidate.matches(url));
    if (source === undefined) {
        throw new TypeError(
            "Expected a problem URL from a supported platform (AtCoder, yukicoder, Aizu Online Judge, Codeforces, ShareOJ).",
        );
    }

    return source;
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
        if (isDirectShareOjProblemUrl(url)) {
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
