import { confirm, input, password } from "@inquirer/prompts";
import { consola } from "consola";
import * as v from "valibot";

import {
    ShareOjApiError,
    ShareOjClient,
    type ShareOjChallenge,
    type ShareOjTokens,
} from "@/lib/service/shareoj";
import { readAuth, replaceAuth } from "@/lib/util/auth";

const shareOjAuthSchema = v.strictObject({
    method: v.literal("password"),
    accessToken: v.pipe(v.string(), v.nonEmpty()),
    refreshToken: v.optional(v.pipe(v.string(), v.nonEmpty())),
    expiresAt: v.optional(v.pipe(v.string(), v.isoTimestamp())),
});

export type ShareOjAuth = v.InferOutput<typeof shareOjAuthSchema>;

export const shareOjLoginMethods = ["password"] as const;

export type ShareOjLoginMethod = (typeof shareOjLoginMethods)[number];

export interface LoginToShareOjOptions {
    method?: string;
}

export function parseShareOjLoginMethod(value: string | undefined): ShareOjLoginMethod {
    const method = value ?? "password";
    const parsed = shareOjLoginMethods.find((candidate) => candidate === method);
    if (parsed !== undefined) {
        return parsed;
    }

    throw new Error(
        `Unsupported ShareOJ login method: ${method}. Use "password". Accounts created through Google must set a password on the website first.`,
    );
}

export function getShareOjAuth(auth: unknown): ShareOjAuth | undefined {
    if (auth === undefined) {
        return undefined;
    }

    const parsedAuth = v.safeParse(shareOjAuthSchema, auth);
    if (!parsedAuth.success) {
        throw new Error("Saved ShareOJ authentication data is invalid.", {
            cause: parsedAuth.issues,
        });
    }

    return parsedAuth.output;
}

function isShareOjAccessTokenExpired(auth: ShareOjAuth): boolean {
    return (
        auth.expiresAt !== undefined &&
        Temporal.Instant.compare(Temporal.Instant.from(auth.expiresAt), Temporal.Now.instant()) <= 0
    );
}

/** A saved credential exists and could still be usable without logging in again. */
export function hasShareOjCredentials(auth: unknown): boolean {
    const parsedAuth = getShareOjAuth(auth);
    if (parsedAuth === undefined) {
        return false;
    }

    return parsedAuth.refreshToken !== undefined || !isShareOjAccessTokenExpired(parsedAuth);
}

/** Resolve a usable access token, refreshing it through the API when needed. */
export async function getShareOjAccessToken(
    auth: unknown,
    client: Pick<ShareOjClient, "refresh"> = new ShareOjClient(),
): Promise<string | undefined> {
    const saved = getShareOjAuth(auth);
    if (saved === undefined) {
        return undefined;
    }

    if (!isShareOjAccessTokenExpired(saved)) {
        return saved.accessToken;
    }
    if (saved.refreshToken === undefined) {
        return undefined;
    }

    return await refreshShareOjTokens(saved, client.refresh.bind(client));
}

async function refreshShareOjTokens(
    saved: ShareOjAuth,
    refresh: (refreshToken: string) => Promise<ShareOjTokens>,
): Promise<string | undefined> {
    const refreshToken = saved.refreshToken;
    if (refreshToken === undefined) {
        return undefined;
    }

    try {
        const tokens = await refresh(refreshToken);
        await saveShareOjTokens(tokens);
        return tokens.accessToken;
    } catch (error) {
        if (error instanceof ShareOjApiError && (error.status === 401 || error.status === 400)) {
            return undefined;
        }
        throw error;
    }
}

export async function isShareOjLoggedIn(auth: unknown): Promise<boolean> {
    const client = new ShareOjClient();
    const token = await getShareOjAccessToken(auth, client);
    if (token === undefined) {
        return false;
    }

    try {
        return (await client.getMe(token)) !== undefined;
    } catch (error) {
        if (error instanceof ShareOjApiError && error.status === 401) {
            return false;
        }
        throw error;
    }
}

/** Store tokens, omitting fields the server did not return. */
async function saveShareOjTokens(tokens: ShareOjTokens): Promise<void> {
    await replaceAuth("shareoj", {
        method: "password",
        accessToken: tokens.accessToken,
        ...(tokens.refreshToken === undefined ? {} : { refreshToken: tokens.refreshToken }),
        ...(tokens.expiresAt === undefined ? {} : { expiresAt: tokens.expiresAt.toString() }),
    });
}

function challengePromptLabel(challenge: ShareOjChallenge): string {
    return (
        {
            NEW_PASSWORD_REQUIRED: "a new password (the account requires one)",
            SMS_MFA: "the SMS verification code",
            SOFTWARE_TOKEN_MFA: "the authenticator code",
            EMAIL_OTP: "the code sent to your email",
        }[challenge.name] ?? `the "${challenge.name}" response`
    );
}

/**
 * Continue login challenges until tokens arrive. Only the challenges the
 * official site supports are handled; anything else aborts with a hint.
 */
async function resolveChallenges(
    client: ShareOjClient,
    username: string,
    challenge: ShareOjChallenge,
): Promise<ShareOjTokens> {
    const supported = new Set([
        "NEW_PASSWORD_REQUIRED",
        "SMS_MFA",
        "SOFTWARE_TOKEN_MFA",
        "EMAIL_OTP",
    ]);
    let current = challenge;
    while (true) {
        if (!supported.has(current.name)) {
            throw new Error(
                `ShareOJ login requires an unsupported challenge (${current.name}). Complete the account setup on the website and try again.`,
            );
        }

        const value = await password({
            message: `Enter ${challengePromptLabel(current)}:`,
            mask: "*",
            validate: (candidate) => candidate.trim().length > 0 || "The response cannot be empty.",
        });

        const responses: Record<string, string> =
            current.name === "NEW_PASSWORD_REQUIRED"
                ? { NEW_PASSWORD: value }
                : {
                      [current.name === "SMS_MFA"
                          ? "SMS_MFA_CODE"
                          : current.name === "SOFTWARE_TOKEN_MFA"
                            ? "SOFTWARE_TOKEN_MFA_CODE"
                            : "EMAIL_OTP_CODE"]: value,
                  };
        const result = await client.continueChallenge(username, current, responses);
        if (!("name" in result)) {
            return result;
        }
        current = result;
    }
}

export async function loginToShareOj(options: LoginToShareOjOptions = {}): Promise<boolean> {
    parseShareOjLoginMethod(options.method);
    const auth = await readAuth();
    const savedAuth = getShareOjAuth(auth.shareoj);
    if (savedAuth !== undefined && (await isShareOjLoggedIn(savedAuth))) {
        const shouldContinue = await confirm({
            message: "Already logged in to ShareOJ. Continue with a new login?",
            default: false,
        });
        if (!shouldContinue) {
            return false;
        }
    }

    const client = new ShareOjClient();
    const username = await input({
        message: "ShareOJ email:",
        validate: (value) => value.trim().length > 0 || "Email cannot be empty.",
    });
    const accountPassword = await password({
        message: "ShareOJ password:",
        mask: "*",
        validate: (value) => value.length > 0 || "Password cannot be empty.",
    });

    let result = await client.login(username, accountPassword);
    if ("name" in result) {
        consola.info(`Additional verification required (${result.name}).`);
        result = await resolveChallenges(client, username, result);
    }
    await saveShareOjTokens(result);

    return true;
}
