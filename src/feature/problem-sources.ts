import { parseAojProblemUrl, AojClient } from "@neoj/api/aoj";
import {
    AtCoderClient,
    AtCoderProblemRequestError,
    parseAtCoderProblemUrl,
} from "@neoj/api/atcoder";
import { CodeforcesClient, parseCodeforcesProblemUrl } from "@neoj/api/codeforces";
import type { Problem } from "@neoj/api/problem";
import {
    parseShareOjContestProblemUrl,
    parseShareOjProblemUrl,
    ShareOjClient,
} from "@neoj/api/shareoj";
import { parseYukicoderProblemUrl, YukicoderClient } from "@neoj/api/yukicoder";

import { getAtCoderSession } from "@/feature/login/atcoder";
import { readAuth } from "@/lib/util/auth";

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
