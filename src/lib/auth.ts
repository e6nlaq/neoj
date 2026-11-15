import { consola } from "consola";
import * as v from "valibot";

import {
    createEncryptedFileAuthStore,
    createOsAuthStore,
    deleteLegacyAuthFile,
    readLegacyAuthFile,
    type AuthStore,
} from "@/lib/auth-store";

export type { AuthStore, AuthStoreKind } from "@/lib/auth-store";

export type AuthCredentials = Record<string, string>;
export type AuthData = Record<string, AuthCredentials>;

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

let injectedStore: AuthStore | undefined;
let osStoreUnavailable = false;
let fallbackNoticeShown = false;

/**
 * Overrides the authentication store. Passing `undefined` falls back to the
 * default selection and also resets the OS-store failure state.
 */
export function setAuthStoreForTesting(store: AuthStore | undefined): void {
    injectedStore = store;
    osStoreUnavailable = false;
    fallbackNoticeShown = false;
}

function selectDefaultStore(): AuthStore {
    const mode = process.env.NEOJ_SECRETS_BACKEND;
    if (mode === "file") {
        return createEncryptedFileAuthStore();
    }
    if (mode === "os") {
        return createOsAuthStore();
    }
    if (mode === undefined || mode === "auto") {
        return osStoreUnavailable ? createEncryptedFileAuthStore() : createOsAuthStore();
    }
    throw new Error(
        `Invalid NEOJ_SECRETS_BACKEND value: "${mode}". Supported values are "auto", "os", and "file".`,
    );
}

function resolveStore(exclude?: AuthStore): AuthStore {
    const primary = injectedStore ?? selectDefaultStore();
    if (primary === exclude) {
        return createEncryptedFileAuthStore();
    }
    return primary;
}

function validateAuthData(data: unknown): AuthData {
    const authResult = v.safeParse(authSchema, data);
    if (!authResult.success) {
        throw new Error("Saved authentication data must be a JSON object.", {
            cause: authResult.issues,
        });
    }

    const auth: AuthData = {};
    for (const [provider, providerData] of Object.entries(authResult.output)) {
        const providerResult = v.safeParse(authProviderSchema, providerData);
        if (!providerResult.success) {
            throw new Error(`Saved authentication data for ${provider} must be a JSON object.`, {
                cause: providerResult.issues,
            });
        }
        const providerAuth: AuthCredentials = {};
        for (const [key, value] of Object.entries(providerResult.output)) {
            if (typeof value !== "string") {
                throw new Error(`Saved credential "${key}" for ${provider} must be a string.`);
            }
            providerAuth[key] = value;
        }
        auth[provider] = providerAuth;
    }
    return auth;
}

/**
 * Moves the legacy plaintext `auth.json` into the active store, then deletes
 * the plaintext file. Runs on the first authentication access of each session;
 * the legacy file is kept when migration fails so no data is lost.
 */
async function migrateLegacyAuthFile(store: AuthStore): Promise<void> {
    const legacy = await readLegacyAuthFile();
    if (legacy === undefined) {
        return;
    }

    const credentials = validateAuthData(legacy);
    for (const [provider, providerAuth] of Object.entries(credentials)) {
        for (const [key, value] of Object.entries(providerAuth)) {
            await store.set(provider, key, value);
        }
    }

    const saved = validateAuthData(await store.load());
    for (const [provider, providerAuth] of Object.entries(credentials)) {
        for (const [key, value] of Object.entries(providerAuth)) {
            if (saved[provider]?.[key] !== value) {
                throw new Error(
                    `Failed to verify the migrated credentials for ${provider}. The legacy authentication file was kept.`,
                );
            }
        }
    }

    await deleteLegacyAuthFile();
    consola.info("Migrated saved credentials from the legacy authentication file.");
}

type AuthStoreOperation<T> = (store: AuthStore) => Promise<T>;

async function runWithAuthStore<T>(
    operation: AuthStoreOperation<T>,
    options: { migrate?: boolean } = {},
): Promise<T> {
    const run = async (store: AuthStore): Promise<T> => {
        if (options.migrate !== false) {
            await migrateLegacyAuthFile(store);
        }
        return await operation(store);
    };

    const primary = resolveStore();
    try {
        return await run(primary);
    } catch (error) {
        if (primary.kind !== "os") {
            throw error;
        }
        osStoreUnavailable = true;
        if (!fallbackNoticeShown) {
            fallbackNoticeShown = true;
            consola.warn(
                "The OS credential store is unavailable. Falling back to an encrypted file in the neoj data directory.",
            );
        }
        return await run(resolveStore(primary));
    }
}

export async function readAuth(): Promise<AuthData> {
    return await runWithAuthStore(async (store) => validateAuthData(await store.load()));
}

export async function saveAuth(
    provider: string,
    credentials: AuthCredentials,
    options: { replace?: boolean } = {},
): Promise<void> {
    await runWithAuthStore(async (store) => {
        const auth = validateAuthData(await store.load());
        const previous = auth[provider] ?? {};
        const next: AuthCredentials = options.replace
            ? { ...credentials }
            : { ...previous, ...credentials };

        for (const [key, value] of Object.entries(next)) {
            if (previous[key] !== value) {
                await store.set(provider, key, value);
            }
        }
        for (const key of Object.keys(previous)) {
            if (!(key in next)) {
                await store.remove(provider, key);
            }
        }
    });
}

export async function replaceAuth(provider: string, credentials: AuthCredentials): Promise<void> {
    await saveAuth(provider, credentials, { replace: true });
}

export async function removeAuth(providers: readonly string[]): Promise<void> {
    await runWithAuthStore(async (store) => {
        const auth = validateAuthData(await store.load());
        for (const provider of providers) {
            for (const key of Object.keys(auth[provider] ?? {})) {
                await store.remove(provider, key);
            }
        }
    });
}

export async function clearAuth(): Promise<void> {
    // Remove the legacy plaintext file without migrating it: logging out must
    // work even when the file is malformed.
    await deleteLegacyAuthFile();
    await runWithAuthStore(
        async (store) => {
            await store.removeAll();
        },
        { migrate: false },
    );
}
