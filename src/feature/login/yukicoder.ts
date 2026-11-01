import { confirm, password } from "@inquirer/prompts";
import { consola } from "consola";
import open from "tiny-open";
import * as v from "valibot";

import {
    normalizeYukicoderCredential,
    YukicoderClient,
    type PollDeviceTokenOptions,
} from "@/lib/service/yukicoder";
import { readAuth, replaceAuth } from "@/lib/util/auth";
import { loadConfig } from "@/lib/util/config";

const tokenAuthSchema = v.strictObject({
    method: v.literal("token"),
    token: v.pipe(v.string(), v.nonEmpty()),
    expiresAt: v.pipe(v.string(), v.isoTimestamp()),
});

const apiKeyAuthSchema = v.strictObject({
    method: v.literal("api-key"),
    apiKey: v.pipe(v.string(), v.nonEmpty()),
});

const yukicoderAuthSchema = v.variant("method", [tokenAuthSchema, apiKeyAuthSchema]);

export type YukicoderAuth = v.InferOutput<typeof yukicoderAuthSchema>;
export type YukicoderLoginMethod = "token" | "api-key";

export interface LoginToYukicoderOptions extends PollDeviceTokenOptions {
    method?: string;
    openUrl?: (url: string) => Promise<boolean>;
}

export function parseYukicoderLoginMethod(value: string | undefined): YukicoderLoginMethod {
    const method = value ?? "token";
    if (method === "token" || method === "api-key") {
        return method;
    }

    throw new Error(`Unsupported yukicoder login method: ${method}. Use "token" or "api-key".`);
}

export function getYukicoderAuth(auth: unknown): YukicoderAuth | undefined {
    if (auth === undefined) {
        return undefined;
    }

    const parsedAuth = v.safeParse(yukicoderAuthSchema, auth);
    if (!parsedAuth.success) {
        throw new Error("Saved yukicoder authentication data is invalid.", {
            cause: parsedAuth.issues,
        });
    }

    return parsedAuth.output;
}

function isYukicoderTokenExpired(auth: YukicoderAuth): boolean {
    return (
        auth.method === "token" &&
        Temporal.Instant.compare(Temporal.Instant.from(auth.expiresAt), Temporal.Now.instant()) <= 0
    );
}

export function hasYukicoderCredentials(auth: unknown): boolean {
    const parsedAuth = getYukicoderAuth(auth);
    return parsedAuth !== undefined && !isYukicoderTokenExpired(parsedAuth);
}

export async function isYukicoderLoggedIn(auth: unknown): Promise<boolean> {
    const parsedAuth = getYukicoderAuth(auth);
    if (parsedAuth === undefined || isYukicoderTokenExpired(parsedAuth)) {
        return false;
    }

    const credential = parsedAuth.method === "token" ? parsedAuth.token : parsedAuth.apiKey;
    return new YukicoderClient().checkCredential(credential);
}

async function openInBrowser(url: string): Promise<boolean> {
    try {
        return await open(url);
    } catch {
        return false;
    }
}

export async function loginToYukicoder(options: LoginToYukicoderOptions = {}): Promise<boolean> {
    const method = parseYukicoderLoginMethod(options.method);
    const auth = await readAuth();
    const savedAuth = getYukicoderAuth(auth.yukicoder);
    if (savedAuth !== undefined && (await isYukicoderLoggedIn(savedAuth))) {
        const shouldContinue = await confirm({
            message: "Already logged in to yukicoder. Continue with a new login?",
            default: false,
        });
        if (!shouldContinue) {
            return false;
        }
    }

    const client = new YukicoderClient();
    if (method === "api-key") {
        const apiKey = await password({
            message: "Paste your yukicoder API key:",
            mask: "*",
            validate: (value) => value.trim().length > 0 || "API key cannot be empty.",
        });
        const credential = normalizeYukicoderCredential(apiKey);
        if (!(await client.checkCredential(credential))) {
            throw new Error("yukicoder API key is invalid.");
        }

        await replaceAuth("yukicoder", { method: "api-key", apiKey: credential });
        return true;
    }

    const config = await loadConfig();
    const deviceCode = await client.requestDeviceCode("neoj");
    consola.info(`Open ${deviceCode.verificationUri} and enter this code: ${deviceCode.userCode}`);

    if (config.login.open_browser) {
        const opened = await (options.openUrl ?? openInBrowser)(deviceCode.verificationUriComplete);
        if (!opened) {
            consola.warn("Could not open the browser automatically. Open the URL above manually.");
        }
    }

    consola.info("Waiting for authorization in the browser...");
    const token = await client.pollDeviceToken(deviceCode, {
        sleep: options.sleep,
        now: options.now,
    });
    await replaceAuth("yukicoder", {
        method: "token",
        token: token.accessToken,
        expiresAt: token.expiresAt.toString(),
    });

    return true;
}
