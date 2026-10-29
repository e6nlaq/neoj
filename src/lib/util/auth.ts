import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import envPaths from "env-paths";
import * as v from "valibot";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const authSchema = v.pipe(
    v.unknown(),
    v.check(isRecord, "Saved authentication data must be a JSON object."),
    v.record(v.string(), v.unknown()),
);
const authProviderSchema = v.pipe(
    v.unknown(),
    v.check(isRecord, "Provider authentication data must be a JSON object."),
    v.record(v.string(), v.unknown()),
);

export async function readAuth(): Promise<Record<string, unknown>> {
    const authFile = Bun.file(join(envPaths("neoj").data, "auth.json"));
    if (!(await authFile.exists())) {
        return {};
    }

    const contents: unknown = JSON.parse(await authFile.text());
    const result = v.safeParse(authSchema, contents);
    if (!result.success) {
        throw new Error("Saved authentication data must be a JSON object.", {
            cause: result.issues,
        });
    }

    return result.output;
}

export async function saveAuth(
    provider: string,
    credentials: Record<string, string>,
): Promise<void> {
    const dataDirectory = envPaths("neoj").data;
    await mkdir(dataDirectory, { recursive: true });

    const auth = await readAuth();
    const existingProviderAuth = auth[provider];
    let providerAuth: Record<string, unknown> = {};
    if (existingProviderAuth !== undefined) {
        const result = v.safeParse(authProviderSchema, existingProviderAuth);
        if (!result.success) {
            throw new Error(`Saved authentication data for ${provider} must be a JSON object.`, {
                cause: result.issues,
            });
        }
        providerAuth = result.output;
    }

    auth[provider] = {
        ...providerAuth,
        ...credentials,
    };
    await Bun.file(join(dataDirectory, "auth.json")).write(`${JSON.stringify(auth, null, 2)}\n`);
}
