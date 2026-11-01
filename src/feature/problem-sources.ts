import { getAtCoderSession } from "@/feature/login/atcoder";
import {
    AtCoderClient,
    AtCoderProblemRequestError,
    parseAtCoderProblemUrl,
} from "@/lib/service/atcoder";
import type { Problem } from "@/lib/service/problem";
import { parseYukicoderProblemUrl, YukicoderClient } from "@/lib/service/yukicoder";
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
