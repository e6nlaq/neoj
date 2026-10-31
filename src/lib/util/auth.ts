import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import envPaths from "env-paths";
import * as v from "valibot";

const AUTH_FILE_NAME = "auth.json";
const DATA_DIRECTORY_MODE = 0o700;
const AUTH_FILE_MODE = 0o600;

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

function authFilePath(): string {
    return join(envPaths("neoj").data, AUTH_FILE_NAME);
}

async function readAuthFile(): Promise<unknown> {
    const path = authFilePath();
    const authFile = Bun.file(path);
    if (!(await authFile.exists())) {
        return {};
    }

    const contents = await authFile.text();
    try {
        return JSON.parse(contents) as unknown;
    } catch (error) {
        throw new Error(`Failed to parse authentication file "${path}".`, { cause: error });
    }
}

async function writeAuth(auth: Record<string, unknown>): Promise<void> {
    const path = authFilePath();
    // Credentials live in a private directory and are written atomically so an
    // interrupted run cannot truncate the existing authentication data.
    await mkdir(dirname(path), { recursive: true, mode: DATA_DIRECTORY_MODE });

    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(auth, null, 2)}\n`, {
        mode: AUTH_FILE_MODE,
    });
    await rename(temporaryPath, path);
    // chmod is a no-op on Windows; ignore failures rather than losing credentials.
    await chmod(path, AUTH_FILE_MODE).catch(() => undefined);
}

export async function readAuth(): Promise<Record<string, unknown>> {
    const result = v.safeParse(authSchema, await readAuthFile());
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
    await writeAuth(auth);
}

export async function removeAuth(providers: readonly string[]): Promise<void> {
    const auth = await readAuth();
    for (const provider of providers) {
        delete auth[provider];
    }

    const authFile = Bun.file(authFilePath());
    if (Object.keys(auth).length === 0) {
        if (await authFile.exists()) {
            await authFile.delete();
        }
        return;
    }

    await writeAuth(auth);
}

export async function clearAuth(): Promise<void> {
    const authFile = Bun.file(authFilePath());
    if (await authFile.exists()) {
        await authFile.delete();
    }
}
