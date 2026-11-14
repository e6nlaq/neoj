import { confirm, password } from "@inquirer/prompts";
import {
    CodeforcesClient,
    normalizeCodeforcesSession,
    type CodeforcesSession,
} from "@neoj/api/codeforces";
import * as v from "valibot";

import type { LoginSession } from "@/feature/platforms";
import { readAuth, saveAuth } from "@/lib/util/auth";

const codeforcesAuthSchema = v.strictObject({
    jsessionId: v.pipe(v.string(), v.nonEmpty()),
    ftaa: v.pipe(v.string(), v.nonEmpty()),
});

export function getCodeforcesSession(auth: unknown): CodeforcesSession | undefined {
    if (auth === undefined) {
        return undefined;
    }

    const parsedAuth = v.safeParse(codeforcesAuthSchema, auth);
    if (!parsedAuth.success) {
        throw new Error("Saved Codeforces authentication data is invalid.", {
            cause: parsedAuth.issues,
        });
    }

    return parsedAuth.output;
}

export function hasCodeforcesCredentials(auth: unknown): boolean {
    return getCodeforcesSession(auth) !== undefined;
}

export async function isCodeforcesLoggedIn(auth: unknown): Promise<boolean> {
    const savedSession = getCodeforcesSession(auth);
    if (savedSession === undefined) {
        return false;
    }

    const client = new CodeforcesClient();
    const valid = await client.login(savedSession);
    // Validation itself can rotate a cookie, so write the new pair back even
    // when this was only a status check.
    if (valid) {
        await persistCodeforcesSession(client, savedSession);
    }

    return valid;
}

/**
 * Save the cookies a client holds when Codeforces rotated them.
 *
 * Codeforces may replace either cookie on any response. Persisting the current
 * values keeps the next command logged in; a failed write is ignored because
 * the session in memory is still valid.
 */
export async function persistCodeforcesSession(
    client: CodeforcesClient,
    previous?: CodeforcesSession,
): Promise<void> {
    const current = client.session;
    if (
        current === undefined ||
        (previous !== undefined &&
            current.jsessionId === previous.jsessionId &&
            current.ftaa === previous.ftaa)
    ) {
        return;
    }

    await saveAuth("codeforces", {
        jsessionId: current.jsessionId,
        ftaa: current.ftaa,
    }).catch(() => undefined);
}

export async function loginToCodeforces(): Promise<LoginSession | undefined> {
    const auth = await readAuth();
    const savedSession = getCodeforcesSession(auth.codeforces);
    if (savedSession !== undefined && (await isCodeforcesLoggedIn(savedSession))) {
        const shouldContinue = await confirm({
            message: "Already logged in to Codeforces. Continue with a new session?",
            default: false,
        });
        if (!shouldContinue) {
            return undefined;
        }
    }

    const jsessionId = await password({
        message: "Paste the JSESSIONID cookie value from Codeforces DevTools:",
        mask: "*",
        validate: (value) => value.trim().length > 0 || "JSESSIONID cannot be empty.",
    });
    const ftaa = await password({
        message: "Paste the 70a7c28f3de cookie value from Codeforces DevTools:",
        mask: "*",
        validate: (value) => value.trim().length > 0 || "70a7c28f3de cannot be empty.",
    });

    const session = normalizeCodeforcesSession({ jsessionId, ftaa });
    const client = new CodeforcesClient();
    if (!(await client.login(session))) {
        throw new Error(
            "Codeforces login failed. Check that the JSESSIONID and 70a7c28f3de cookies are current.",
        );
    }

    // Codeforces may rotate the cookies while validating the session, so save
    // what the client holds instead of the pasted values.
    const current = client.session ?? session;
    await saveAuth("codeforces", { jsessionId: current.jsessionId, ftaa: current.ftaa });
    return { username: client.username };
}
