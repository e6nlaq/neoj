import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import envPaths from "env-paths";

const DATA_DIRECTORY_MODE = 0o700;
const AUTH_FILE_MODE = 0o600;

// The legacy plaintext file written by neoj before the Bun secrets API was
// adopted. It is only read to migrate its contents into the active store.
const LEGACY_AUTH_FILE_NAME = "auth.json";
const ENCRYPTED_AUTH_FILE_NAME = "auth.enc";
const ENCRYPTION_KEY_FILE_NAME = "auth.key";
const AUTH_INDEX_FILE_NAME = "auth-index.json";

const AUTH_SERVICE = "dev.neoj.cli";
const AUTH_ALGORITHM = "aes-256-gcm";
const AUTH_ENVELOPE_VERSION = 1;
const ENCRYPTION_KEY_LENGTH = 32;
const ENCRYPTION_IV_LENGTH = 12;

export type AuthStoreKind = "os" | "file" | "memory";

export interface AuthStore {
    readonly kind: AuthStoreKind;
    /** Returns the saved authentication data, or an empty object when nothing is saved. */
    load(): Promise<unknown>;
    set(provider: string, key: string, value: string): Promise<void>;
    remove(provider: string, key: string): Promise<void>;
    removeAll(): Promise<void>;
}

export interface SecretsClient {
    get(options: { service: string; name: string }): Promise<string | null>;
    set(options: {
        service: string;
        name: string;
        value: string;
        persist?: "local" | "enterprise";
    }): Promise<void>;
    delete(options: { service: string; name: string }): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataDirectory(): string {
    return envPaths("neoj").data;
}

function legacyAuthFilePath(): string {
    return join(dataDirectory(), LEGACY_AUTH_FILE_NAME);
}

function encryptedAuthFilePath(): string {
    return join(dataDirectory(), ENCRYPTED_AUTH_FILE_NAME);
}

function encryptionKeyFilePath(): string {
    return join(dataDirectory(), ENCRYPTION_KEY_FILE_NAME);
}

function authIndexFilePath(): string {
    return join(dataDirectory(), AUTH_INDEX_FILE_NAME);
}

// Credentials live in a private directory and are written atomically so an
// interrupted run cannot truncate the existing authentication data.
async function writePrivateFile(path: string, contents: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: DATA_DIRECTORY_MODE });

    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, contents, { mode: AUTH_FILE_MODE });
    await rename(temporaryPath, path);
    // chmod is a no-op on Windows; ignore failures rather than losing credentials.
    await chmod(path, AUTH_FILE_MODE).catch(() => undefined);
}

export async function readLegacyAuthFile(): Promise<unknown> {
    const path = legacyAuthFilePath();
    const authFile = Bun.file(path);
    if (!(await authFile.exists())) {
        return undefined;
    }

    const contents = await authFile.text();
    try {
        return JSON.parse(contents) as unknown;
    } catch (error) {
        throw new Error(`Failed to parse authentication file "${path}".`, { cause: error });
    }
}

export async function deleteLegacyAuthFile(): Promise<void> {
    const path = legacyAuthFilePath();
    if (await Bun.file(path).exists()) {
        await rm(path, { force: true });
    }
}

type AuthIndex = Record<string, string[]>;

async function readAuthIndex(path: string): Promise<AuthIndex> {
    const indexFile = Bun.file(path);
    if (!(await indexFile.exists())) {
        return {};
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(await indexFile.text()) as unknown;
    } catch (error) {
        throw new Error(`Failed to parse the authentication index file "${path}".`, {
            cause: error,
        });
    }
    if (!isRecord(parsed)) {
        throw new Error(`The authentication index file "${path}" must contain a JSON object.`);
    }

    const index: AuthIndex = {};
    for (const [provider, keys] of Object.entries(parsed)) {
        if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) {
            throw new Error(
                `The authentication index file "${path}" must map each provider to an array of credential names.`,
            );
        }
        index[provider] = keys;
    }
    return index;
}

/**
 * Store that keeps every credential in the operating system's credential
 * storage (macOS Keychain, Windows Credential Manager, or the Linux secret
 * service) through `Bun.secrets`. Because the API cannot enumerate entries,
 * the names of saved credentials are tracked in a non-secret index file.
 */
export function createOsAuthStore(secrets: SecretsClient = Bun.secrets): AuthStore {
    const secretName = (provider: string, key: string): string => `${provider}/${key}`;

    const updateIndex = async (mutate: (index: AuthIndex) => AuthIndex): Promise<void> => {
        const path = authIndexFilePath();
        const index = mutate(await readAuthIndex(path));
        if (Object.keys(index).length === 0) {
            await rm(path, { force: true });
            return;
        }
        await writePrivateFile(path, `${JSON.stringify(index)}\n`);
    };

    return {
        kind: "os",
        async load() {
            const index = await readAuthIndex(authIndexFilePath());
            const auth: Record<string, Record<string, string>> = {};
            for (const [provider, keys] of Object.entries(index)) {
                for (const key of keys) {
                    const value = await secrets.get({
                        service: AUTH_SERVICE,
                        name: secretName(provider, key),
                    });
                    if (value !== null) {
                        (auth[provider] ??= {})[key] = value;
                    }
                }
            }
            return auth;
        },
        async set(provider, key, value) {
            // Sessions belong to a single device; do not let roaming profiles
            // replicate them (Windows-only option).
            await secrets.set({
                service: AUTH_SERVICE,
                name: secretName(provider, key),
                value,
                persist: "local",
            });
            await updateIndex((index) => {
                const keys = index[provider] ?? [];
                if (keys.includes(key)) {
                    return index;
                }
                return { ...index, [provider]: [...keys, key] };
            });
        },
        async remove(provider, key) {
            await secrets.delete({ service: AUTH_SERVICE, name: secretName(provider, key) });
            await updateIndex((index) => {
                const keys = (index[provider] ?? []).filter((entry) => entry !== key);
                if (keys.length === 0) {
                    const { [provider]: _removed, ...rest } = index;
                    return rest;
                }
                return { ...index, [provider]: keys };
            });
        },
        async removeAll() {
            const path = authIndexFilePath();
            const index = await readAuthIndex(path);
            for (const [provider, keys] of Object.entries(index)) {
                for (const key of keys) {
                    await secrets.delete({
                        service: AUTH_SERVICE,
                        name: secretName(provider, key),
                    });
                }
            }
            await rm(path, { force: true });
        },
    };
}

type Envelope = {
    v: number;
    alg: string;
    iv: string;
    tag: string;
    data: string;
};

function isEnvelope(value: unknown): value is Envelope {
    if (!isRecord(value)) {
        return false;
    }
    return (
        value.v === AUTH_ENVELOPE_VERSION &&
        value.alg === AUTH_ALGORITHM &&
        typeof value.iv === "string" &&
        typeof value.tag === "string" &&
        typeof value.data === "string"
    );
}

/**
 * Store that keeps the credentials in an AES-256-GCM encrypted file inside the
 * data directory. A random 256-bit key is stored in a separate file so the
 * ciphertext and the key do not live in the same file.
 */
export function createEncryptedFileAuthStore(): AuthStore {
    const readEncryptionKey = async (): Promise<Buffer> => {
        const path = encryptionKeyFilePath();
        const keyFile = Bun.file(path);
        if (await keyFile.exists()) {
            const key = Buffer.from(await keyFile.text(), "base64");
            if (key.length === ENCRYPTION_KEY_LENGTH) {
                return key;
            }
            throw new Error(
                `The authentication encryption key file "${path}" is malformed. Delete it together with the authentication file, then log in again.`,
            );
        }

        const key = randomBytes(ENCRYPTION_KEY_LENGTH);
        await writePrivateFile(path, key.toString("base64"));
        return key;
    };

    const readAuthMap = async (): Promise<Record<string, Record<string, string>>> => {
        const path = encryptedAuthFilePath();
        const authFile = Bun.file(path);
        if (!(await authFile.exists())) {
            return {};
        }

        const contents = await authFile.text();
        let envelope: unknown;
        try {
            envelope = JSON.parse(contents) as unknown;
        } catch (error) {
            throw new Error(`Failed to parse the authentication file "${path}".`, {
                cause: error,
            });
        }
        if (!isEnvelope(envelope)) {
            throw new Error(
                `The authentication file "${path}" has an unsupported format. Delete it and log in again.`,
            );
        }

        const key = await readEncryptionKey();
        let plaintext: string;
        try {
            const decipher = createDecipheriv(
                AUTH_ALGORITHM,
                key,
                Buffer.from(envelope.iv, "base64"),
            );
            decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
            plaintext = Buffer.concat([
                decipher.update(Buffer.from(envelope.data, "base64")),
                decipher.final(),
            ]).toString("utf8");
        } catch {
            throw new Error(
                `Failed to decrypt the authentication file "${path}". The file or the encryption key may have been modified. Delete "${path}" and "${encryptionKeyFilePath()}", then log in again.`,
            );
        }

        try {
            return JSON.parse(plaintext) as unknown as Record<string, Record<string, string>>;
        } catch (error) {
            throw new Error(`Failed to parse the decrypted authentication file "${path}".`, {
                cause: error,
            });
        }
    };

    const writeAuthMap = async (auth: Record<string, Record<string, string>>): Promise<void> => {
        const path = encryptedAuthFilePath();
        if (Object.keys(auth).length === 0) {
            await rm(path, { force: true });
            return;
        }

        const key = await readEncryptionKey();
        const iv = randomBytes(ENCRYPTION_IV_LENGTH);
        const cipher = createCipheriv(AUTH_ALGORITHM, key, iv);
        const data = Buffer.concat([cipher.update(JSON.stringify(auth), "utf8"), cipher.final()]);
        const envelope: Envelope = {
            v: AUTH_ENVELOPE_VERSION,
            alg: AUTH_ALGORITHM,
            iv: iv.toString("base64"),
            tag: cipher.getAuthTag().toString("base64"),
            data: data.toString("base64"),
        };
        await writePrivateFile(path, `${JSON.stringify(envelope)}\n`);
    };

    return {
        kind: "file",
        load: readAuthMap,
        async set(provider, key, value) {
            const auth = await readAuthMap();
            (auth[provider] ??= {})[key] = value;
            await writeAuthMap(auth);
        },
        async remove(provider, key) {
            const auth = await readAuthMap();
            const providerAuth = auth[provider];
            if (providerAuth === undefined) {
                return;
            }
            delete providerAuth[key];
            if (Object.keys(providerAuth).length === 0) {
                delete auth[provider];
            }
            await writeAuthMap(auth);
        },
        async removeAll() {
            await rm(encryptedAuthFilePath(), { force: true });
            await rm(encryptionKeyFilePath(), { force: true });
        },
    };
}
