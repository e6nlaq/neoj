import { setAuthStoreForTesting, type AuthStore } from "@/lib/auth";

export function createMemoryAuthStore(kind: AuthStore["kind"] = "memory"): AuthStore {
    const entries = new Map<string, string>();

    const toAuthData = (): Record<string, Record<string, string>> => {
        const auth: Record<string, Record<string, string>> = {};
        for (const [name, value] of entries) {
            const separator = name.indexOf("/");
            const provider = name.slice(0, separator);
            const key = name.slice(separator + 1);
            (auth[provider] ??= {})[key] = value;
        }
        return auth;
    };

    return {
        kind,
        load: async () => toAuthData(),
        set: async (provider, key, value) => {
            entries.set(`${provider}/${key}`, value);
        },
        remove: async (provider, key) => {
            entries.delete(`${provider}/${key}`);
        },
        removeAll: async () => {
            entries.clear();
        },
    };
}

/** Installs a fresh in-memory store so tests never touch the OS credential storage. */
export function installMemoryAuthStore(): AuthStore {
    const store = createMemoryAuthStore();
    setAuthStoreForTesting(store);
    return store;
}
