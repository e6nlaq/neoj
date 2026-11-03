import { mock } from "bun:test";
import { join } from "node:path";

mock.module("env-paths", () => ({
    default: () => {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData === undefined) {
            throw new Error("LOCALAPPDATA must be set by the authentication test.");
        }

        return { data: join(localAppData, "neoj-nodejs", "Data") };
    },
}));
