import { mock } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The authentication tests redirect the per-user data directory by setting
// LOCALAPPDATA (see each test's setTemporaryDataDirectory helper). Tests that
// never touch the data directory fall back to a throwaway location so the
// mocked env-paths keeps working on macOS and Linux, where LOCALAPPDATA is not
// set.
mock.module("env-paths", () => ({
    default: () => {
        const localAppData = process.env.LOCALAPPDATA ?? join(tmpdir(), "neoj-test-localappdata");
        return { data: join(localAppData, "neoj-nodejs", "Data") };
    },
}));
