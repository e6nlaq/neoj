import { getAtCoderSession } from "@/feature/login/atcoder";
import {
    AtCoderClient,
    AtCoderProblemRequestError,
    parseAtCoderProblemUrl,
} from "@/lib/service/atcoder";
import type { Problem } from "@/lib/service/problem";
import { parseYukicoderProblemUrl, YukicoderClient } from "@/lib/service/yukicoder";
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
];

export function findProblemSource(url: string): ProblemSource {
    const source = problemSources.find((candidate) => candidate.matches(url));
    if (source === undefined) {
        throw new TypeError(
            "Expected a problem URL from a supported platform (AtCoder, yukicoder).",
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
        const problemUrl = parseYukicoderProblemUrl(url);
        const number = /(\d+)\/?$/u.exec(problemUrl.pathname)?.[1];
        if (number === undefined) {
            throw new TypeError(`Could not derive a stash name from "${url}".`);
        }
        return { platform: "yukicoder", slug: `no${number}` };
    }

    throw new TypeError("Expected a problem URL from a supported platform (AtCoder, yukicoder).");
}
