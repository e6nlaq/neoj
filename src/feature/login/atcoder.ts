import { confirm, password } from "@inquirer/prompts";
import * as v from "valibot";

import { AtCoderClient, normalizeRevelSession } from "../../lib/service/atcoder";
import { readAuth, saveAuth } from "../../lib/util/auth";

const atCoderAuthSchema = v.object({
    revelSession: v.pipe(v.string(), v.nonEmpty()),
});

function getSavedSession(auth: unknown): string | undefined {
    if (auth === undefined) {
        return undefined;
    }

    const parsedAuth = v.safeParse(atCoderAuthSchema, auth);
    if (!parsedAuth.success) {
        throw new Error("Saved AtCoder authentication data is invalid.", {
            cause: parsedAuth.issues,
        });
    }

    return parsedAuth.output.revelSession;
}

export function hasAtCoderCredentials(auth: unknown): boolean {
    return getSavedSession(auth) !== undefined;
}

export async function isAtCoderLoggedIn(auth: unknown): Promise<boolean> {
    const savedSession = getSavedSession(auth);
    if (savedSession === undefined) {
        return false;
    }

    return new AtCoderClient().login(savedSession);
}

export async function loginToAtCoder(): Promise<boolean> {
    const auth = await readAuth();
    const savedAtCoderAuth = auth.atcoder;
    if (await isAtCoderLoggedIn(savedAtCoderAuth)) {
        const shouldContinue = await confirm({
            message: "Already logged in to AtCoder. Continue with a new session?",
            default: false,
        });
        if (!shouldContinue) {
            return false;
        }
    }

    const revelSession = await password({
        message: "Paste the REVEL_SESSION cookie value from AtCoder DevTools:",
        mask: "*",
        validate: (value) => value.trim().length > 0 || "REVEL_SESSION cannot be empty.",
    });

    const session = normalizeRevelSession(revelSession);
    const client = new AtCoderClient();
    if (!(await client.login(session))) {
        throw new Error("AtCoder login failed. Check that the REVEL_SESSION cookie is valid.");
    }

    await saveAuth("atcoder", { revelSession: session });
    return true;
}
