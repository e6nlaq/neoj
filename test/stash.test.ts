import { afterEach, describe, expect, it } from "bun:test";
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deriveProblemKey } from "@neoj/api";

import {
    clearProblemStashes,
    dropProblemStash,
    listProblemStashes,
    applyCurrentProblemStash,
    saveCurrentProblemStash,
} from "@/feature/stash";
import type { Config } from "@/lib/project/config";
import {
    applyStash,
    clearStashes,
    dropStash,
    EmptyStashError,
    findStash,
    formatStashTimestamp,
    isStashExpired,
    listStashes,
    lookupStash,
    parseStashId,
    saveStash,
    sweepExpiredStashes,
} from "@/lib/project/stash";

let testRoot: string | undefined;
const originalCwd = process.cwd();
const originalUserProfile = process.env.USERPROFILE;
const originalHome = process.env.HOME;

afterEach(async () => {
    process.chdir(originalCwd);
    for (const [name, value] of [
        ["USERPROFILE", originalUserProfile],
        ["HOME", originalHome],
    ] as const) {
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }

    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function createProject(): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-stash-test-"));
    return testRoot;
}

function createConfig(options: { sourceFolder?: string; folder?: string } = {}): Config {
    return {
        source: options.sourceFolder === undefined ? {} : { folder: options.sourceFolder },
        alias: {},
        run: { silent: false },
        login: { open_browser: true, auto_login: true },
        submit: {
            confirm: true,
            wait: 3,
            open: true,
            clip: "never",
            preview_lines: 5,
            presubmit_timeout: 30,
            check_limit: true,
            atcoder_fallback: true,
        },
        testcase: { folder: options.folder ?? "test", filename: "sample-{}" },
        handmade: { filename: "handmade-{}" },
        generate: {
            gen: undefined,
            naive: undefined,
            filename: "random-{}",
            count: 1,
            timeout: 10,
            parallel: true,
        },
        test: {
            timeout: 10,
            memory: 1024,
            parallel: true,
            cache: false,
            error: 6,
            ignore_trailing_space: false,
            ignore_trailing_newline: false,
            show_stderr: "always",
            display_lines: 30,
            show_line_numbers: true,
            diff_background: "none",
        },
        languages: {},
        update: { enabled: true, interval: 259_200 },
        download: { show_sample: false },
        stash: { auto_stash: false, auto_apply: false, force: true, expire_days: 0 },
        template: { enable: false, exclude: [], mode: "overlay" },
    };
}

const key = { platform: "atcoder", slug: "abc300_a" };
const url = "https://atcoder.jp/contests/abc300/tasks/abc300_a";

async function writeProblemFiles(projectRoot: string): Promise<void> {
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await mkdir(join(projectRoot, "test"), { recursive: true });
    await writeFile(join(projectRoot, "src", "main.cpp"), "solution");
    await writeFile(join(projectRoot, "test", "sample-1.in"), "1 2");
}

function stashDirectory(projectRoot: string): string {
    return join(projectRoot, ".neoj", "stash", "atcoder", "abc300_a");
}

describe("deriveProblemKey", () => {
    it("derives the platform and a readable slug from problem URLs", () => {
        expect(deriveProblemKey(url)).toEqual({ platform: "atcoder", slug: "abc300_a" });
        expect(deriveProblemKey(`${url}/`)).toEqual({ platform: "atcoder", slug: "abc300_a" });
        expect(deriveProblemKey("https://yukicoder.me/problems/no/480")).toEqual({
            platform: "yukicoder",
            slug: "no480",
        });
        expect(deriveProblemKey("https://yukicoder.me/problems/1480")).toEqual({
            platform: "yukicoder",
            slug: "id1480",
        });
    });

    it("rejects URLs from unsupported platforms", () => {
        expect(() => deriveProblemKey("https://example.com/problems/no/480")).toThrow(
            "Expected a problem URL from a supported platform (AtCoder, yukicoder, Aizu Online Judge, Codeforces, ShareOJ).",
        );
    });
});

describe("saveStash", () => {
    it("saves source.folder and the test-case directory with metadata", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);

        const result = await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            { url, key },
            { force: true, now: new Date("2026-10-30T12:00:00Z") },
        );

        expect(result.fileCount).toBe(2);
        expect(result.replacedAt).toBeUndefined();
        await expect(
            readdir(stashDirectory(projectRoot)).then((entries) => entries.sort()),
        ).resolves.toEqual(["meta.json", "source", "testcase"]);
        await expect(
            Bun.file(join(stashDirectory(projectRoot), "meta.json")).json(),
        ).resolves.toEqual({
            url,
            platform: "atcoder",
            slug: "abc300_a",
            saved_at: "2026-10-30T12:00:00.000Z",
            slots: { source: "src", testcase: "test" },
            file_count: 2,
        });
        await expect(
            Bun.file(join(stashDirectory(projectRoot), "testcase", "sample-1.in")).text(),
        ).resolves.toBe("1 2");
    });

    it("rejects metadata written with the old src slot", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            { url, key },
            { force: true },
        );
        const metaPath = join(stashDirectory(projectRoot), "meta.json");
        const meta = (await Bun.file(metaPath).json()) as { slots: Record<string, string> };
        meta.slots = { src: meta.slots.source! };
        await Bun.write(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

        await expect(findStash(projectRoot, key)).rejects.toThrow("is invalid");
    });

    it("saves only the slots that exist", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);

        const result = await saveStash(projectRoot, createConfig(), { url, key }, { force: true });

        expect(result.fileCount).toBe(1);
        await expect(findStash(projectRoot, key)).resolves.toMatchObject({
            meta: { slots: { testcase: "test" }, file_count: 1 },
        });
        await expect(readdir(stashDirectory(projectRoot))).resolves.not.toContain("source");
    });

    it("refuses to replace an existing stash without force", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        const config = createConfig({ sourceFolder: "src" });
        await saveStash(projectRoot, config, { url, key }, { force: true });

        await expect(
            saveStash(projectRoot, config, { url, key }, { force: false }),
        ).rejects.toThrow('A stash for "atcoder/abc300_a" already exists');

        const replaced = await saveStash(
            projectRoot,
            config,
            { url, key },
            { force: true, now: new Date("2026-10-31T12:00:00Z") },
        );
        expect(replaced.replacedAt).toBeDefined();
        await expect(
            Bun.file(join(stashDirectory(projectRoot), "meta.json")).json(),
        ).resolves.toMatchObject({ saved_at: "2026-10-31T12:00:00.000Z" });
    });

    it("reports an empty stash when there are no files", async () => {
        const projectRoot = await createProject();
        await mkdir(join(projectRoot, "src"));
        await mkdir(join(projectRoot, "test"));

        await expect(
            saveStash(
                projectRoot,
                createConfig({ sourceFolder: "src" }),
                { url, key },
                { force: true },
            ),
        ).rejects.toBeInstanceOf(EmptyStashError);
    });

    it("rejects unsafe folders and identical slots", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);

        await expect(
            saveStash(
                projectRoot,
                createConfig({ folder: "../outside" }),
                { url, key },
                { force: true },
            ),
        ).rejects.toThrow("must resolve to a directory inside the project");

        await expect(
            saveStash(
                projectRoot,
                createConfig({ sourceFolder: "test" }),
                { url, key },
                { force: true },
            ),
        ).rejects.toThrow("must not overlap");
    });
});

describe("applyStash", () => {
    it("restores an exact mirror and counts removed files", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        const config = createConfig({ sourceFolder: "src" });
        await saveStash(projectRoot, config, { url, key }, { force: true });

        await writeFile(join(projectRoot, "src", "main.cpp"), "edited");
        await writeFile(join(projectRoot, "src", "extra.cpp"), "extra");
        await rm(join(projectRoot, "test"), { recursive: true });
        await mkdir(join(projectRoot, "test"));
        await writeFile(join(projectRoot, "test", "stale.in"), "stale");

        const applied = await applyStash(projectRoot, config, key);

        expect(applied.written).toBe(2);
        expect(applied.removed).toBe(2);
        expect(applied.warnings).toEqual([]);
        await expect(readdir(join(projectRoot, "src"))).resolves.toEqual(["main.cpp"]);
        await expect(Bun.file(join(projectRoot, "src", "main.cpp")).text()).resolves.toBe(
            "solution",
        );
        await expect(readdir(join(projectRoot, "test"))).resolves.toEqual(["sample-1.in"]);
    });

    it("restores into the current configuration and warns about renamed folders", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            { url, key },
            { force: true },
        );

        const applied = await applyStash(
            projectRoot,
            createConfig({ sourceFolder: "app", folder: "tests" }),
            key,
        );

        expect(applied.warnings).toHaveLength(2);
        expect(applied.warnings.join("\n")).toContain('restores it to "app"');
        expect(applied.warnings.join("\n")).toContain('restores it to "tests"');
        await expect(Bun.file(join(projectRoot, "app", "main.cpp")).text()).resolves.toBe(
            "solution",
        );
        await expect(Bun.file(join(projectRoot, "tests", "sample-1.in")).text()).resolves.toBe(
            "1 2",
        );
    });

    it("skips a saved source slot when source.folder is no longer configured", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            { url, key },
            { force: true },
        );

        const applied = await applyStash(projectRoot, createConfig(), key);

        expect(applied.written).toBe(1);
        expect(applied.warnings).toEqual([
            'The stash contains "source", but source.folder is not configured. Skipped it.',
        ]);
        await expect(Bun.file(join(projectRoot, "src", "main.cpp")).text()).resolves.toBe(
            "solution",
        );
    });

    it("rejects a configuration where both slots resolve to the same directory", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src", folder: "test" }),
            { url, key },
            { force: true },
        );

        await expect(
            applyStash(projectRoot, createConfig({ sourceFolder: "test", folder: "test" }), key),
        ).rejects.toThrow("source.folder and testcase.folder must not overlap");

        await expect(Bun.file(join(projectRoot, "test", "sample-1.in")).text()).resolves.toBe(
            "1 2",
        );
        await expect(Bun.file(join(projectRoot, "src", "main.cpp")).text()).resolves.toBe(
            "solution",
        );
    });

    it("fails when the problem has no stash", async () => {
        const projectRoot = await createProject();

        await expect(
            applyStash(projectRoot, createConfig({ sourceFolder: "src" }), key),
        ).rejects.toThrow('No stash found for "atcoder/abc300_a".');
    });
});

describe("stash bookkeeping", () => {
    it("lists stashes in a stable order", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            { url, key },
            { force: true },
        );
        await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            {
                url: "https://yukicoder.me/problems/no/480",
                key: { platform: "yukicoder", slug: "no480" },
            },
            { force: true },
        );

        const entries = await listStashes(projectRoot);
        expect(entries.map((entry) => `${entry.key.platform}/${entry.key.slug}`)).toEqual([
            "atcoder/abc300_a",
            "yukicoder/no480",
        ]);
    });

    it("drops one stash and clears the rest", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            { url, key },
            { force: true },
        );
        await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            {
                url: "https://yukicoder.me/problems/no/480",
                key: { platform: "yukicoder", slug: "no480" },
            },
            { force: true },
        );

        await expect(dropStash(projectRoot, key)).resolves.toBe(true);
        await expect(dropStash(projectRoot, key)).resolves.toBe(false);
        await expect(clearStashes(projectRoot)).resolves.toBe(1);
        await expect(listStashes(projectRoot)).resolves.toEqual([]);
    });

    it("formats saved timestamps for display", () => {
        expect(formatStashTimestamp("not-a-date")).toBe("not-a-date");
        expect(formatStashTimestamp("2026-10-30T12:00:00.000Z")).toMatch(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
        );
    });
});

describe("stash expiration", () => {
    const savedAt = new Date("2026-10-01T00:00:00Z");

    async function saveBackdatedStash(projectRoot: string, config: Config): Promise<void> {
        await saveStash(projectRoot, config, { url, key }, { force: true, now: savedAt });
    }

    it("detects a stash saved at least expireDays days ago", () => {
        const meta = {
            url,
            platform: key.platform,
            slug: key.slug,
            saved_at: "2026-10-01T00:00:00.000Z",
            slots: { testcase: "test" },
            file_count: 1,
        };
        expect(isStashExpired(meta, 14, new Date("2026-10-14T23:59:59Z"))).toBe(false);
        expect(isStashExpired(meta, 14, new Date("2026-10-15T00:00:00Z"))).toBe(true);
        expect(isStashExpired(meta, 0, new Date("2027-10-15T00:00:00Z"))).toBe(false);
    });

    it("removes an expired stash on lookup and reports it", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveBackdatedStash(projectRoot, createConfig({ sourceFolder: "src" }));

        const lookup = await lookupStash(projectRoot, key, {
            expireDays: 14,
            now: new Date("2026-10-20T00:00:00Z"),
        });
        expect(lookup.entry).toBeUndefined();
        expect(lookup.expired).toMatchObject({ saved_at: "2026-10-01T00:00:00.000Z" });
        await expect(findStash(projectRoot, key)).resolves.toBeUndefined();
        await expect(
            lstat(join(projectRoot, ".neoj", "stash", "atcoder", "abc300_a")),
        ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("keeps a stash that is not yet expired", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveBackdatedStash(projectRoot, createConfig({ sourceFolder: "src" }));

        const lookup = await lookupStash(projectRoot, key, {
            expireDays: 14,
            now: new Date("2026-10-10T00:00:00Z"),
        });
        expect(lookup.entry).toBeDefined();
        expect(lookup.expired).toBeUndefined();
        await expect(findStash(projectRoot, key)).resolves.toMatchObject({ key });
    });

    it("ignores expiration when expireDays is 0", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveBackdatedStash(projectRoot, createConfig({ sourceFolder: "src" }));

        const lookup = await lookupStash(projectRoot, key, {
            expireDays: 0,
            now: new Date("2027-10-01T00:00:00Z"),
        });
        expect(lookup.entry).toBeDefined();
    });

    it("replaces an expired stash without --force", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveBackdatedStash(projectRoot, createConfig({ sourceFolder: "src" }));

        const saved = await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            { url, key },
            {
                force: false,
                now: new Date("2026-10-20T00:00:00Z"),
                expireDays: 14,
            },
        );
        expect(saved.replacedAt).toBeUndefined();
        await expect(
            Bun.file(join(stashDirectory(projectRoot), "meta.json")).json(),
        ).resolves.toMatchObject({ saved_at: "2026-10-20T00:00:00.000Z" });
    });

    it("still requires --force for a stash that is not expired", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveBackdatedStash(projectRoot, createConfig({ sourceFolder: "src" }));

        await expect(
            saveStash(
                projectRoot,
                createConfig({ sourceFolder: "src" }),
                { url, key },
                {
                    force: false,
                    now: new Date("2026-10-10T00:00:00Z"),
                    expireDays: 14,
                },
            ),
        ).rejects.toThrow("already exists");
    });

    it("fails apply of an expired stash after removing it", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveBackdatedStash(projectRoot, createConfig({ sourceFolder: "src" }));

        await expect(
            applyStash(projectRoot, createConfig({ sourceFolder: "src" }), key, {
                expireDays: 14,
                now: new Date("2026-10-20T00:00:00Z"),
            }),
        ).rejects.toThrow(
            /^The stash for "atcoder\/abc300_a" expired \(saved .+\) and was removed\.$/,
        );
        await expect(findStash(projectRoot, key)).resolves.toBeUndefined();
    });

    it("sweeps only expired stashes", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveBackdatedStash(projectRoot, createConfig({ sourceFolder: "src" }));
        const recentKey = { platform: "yukicoder", slug: "no480" as const };
        await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            { url: "https://yukicoder.me/problems/no/480", key: recentKey },
            { force: true, now: new Date("2026-10-19T00:00:00Z") },
        );

        await expect(
            sweepExpiredStashes(projectRoot, {
                expireDays: 14,
                now: new Date("2026-10-20T00:00:00Z"),
            }),
        ).resolves.toBe(1);
        await expect(
            listStashes(projectRoot).then((entries) =>
                entries.map((entry) => `${entry.key.platform}/${entry.key.slug}`),
            ),
        ).resolves.toEqual(["yukicoder/no480"]);
        await expect(sweepExpiredStashes(projectRoot, { expireDays: 0 })).resolves.toBe(0);
    });

    it("sweeps expired stashes during list and reports the count", async () => {
        const projectRoot = await createConfiguredProject(
            '[source]\nfolder = "src"\n\n[stash]\nexpire_days = 1\n',
        );
        await writeProblemFiles(projectRoot);
        await saveBackdatedStash(projectRoot, createConfig({ sourceFolder: "src" }));
        const metaPath = join(stashDirectory(projectRoot), "meta.json");
        const meta = (await Bun.file(metaPath).json()) as Record<string, unknown>;
        meta.saved_at = "2026-10-01T00:00:00.000Z";
        await Bun.write(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

        await expect(listProblemStashes()).resolves.toMatchObject({
            entries: [],
            expired: 1,
        });
        await expect(findStash(projectRoot, key)).resolves.toBeUndefined();
    });

    it("replaces an expired stash without --force at the command level", async () => {
        await createConfiguredProject(
            '[source]\nfolder = "src"\n\n[stash]\nforce = false\nexpire_days = 14\n',
        );
        await writeProblemFiles(testRoot!);
        await saveBackdatedStash(testRoot!, createConfig({ sourceFolder: "src" }));
        const metaPath = join(stashDirectory(testRoot!), "meta.json");
        const meta = (await Bun.file(metaPath).json()) as Record<string, unknown>;
        meta.saved_at = "2020-01-01T00:00:00.000Z";
        await Bun.write(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

        await expect(saveCurrentProblemStash(false)).resolves.toMatchObject({
            replacedAt: undefined,
        });
    });

    it("fails apply of an expired stash at the command level", async () => {
        await createConfiguredProject('[source]\nfolder = "src"\n\n[stash]\nexpire_days = 14\n');
        await writeProblemFiles(testRoot!);
        await saveBackdatedStash(testRoot!, createConfig({ sourceFolder: "src" }));
        const metaPath = join(stashDirectory(testRoot!), "meta.json");
        const meta = (await Bun.file(metaPath).json()) as Record<string, unknown>;
        meta.saved_at = "2020-01-01T00:00:00.000Z";
        await Bun.write(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

        await expect(applyCurrentProblemStash()).rejects.toThrow("expired");
        await expect(findStash(testRoot!, key)).resolves.toBeUndefined();
    });
});

describe("parseStashId", () => {
    it("splits an id into a platform and a slug", () => {
        expect(parseStashId("atcoder/abc300_a")).toEqual(key);
        expect(parseStashId("yukicoder/no480")).toEqual({ platform: "yukicoder", slug: "no480" });
    });

    it("rejects ids without a separator", () => {
        expect(() => parseStashId("abc300_a")).toThrow(
            'Invalid stash id "abc300_a". Expected "platform/slug", e.g. "atcoder/abc300_a".',
        );
    });

    it("rejects unsafe platform and slug characters", () => {
        expect(() => parseStashId("at coder/abc300_a")).toThrow(
            'Invalid stash platform "at coder".',
        );
        expect(() => parseStashId("atcoder/abc300 a")).toThrow('Invalid stash name "abc300 a".');
    });
});

async function createConfiguredProject(
    configToml: string,
    options: { withProblem?: boolean } = {},
): Promise<string> {
    const projectRoot = await createProject();
    const homeDirectory = join(projectRoot, "home");
    await mkdir(homeDirectory);
    await writeFile(join(projectRoot, "neoj.toml"), configToml);
    if (options.withProblem !== false) {
        await mkdir(join(projectRoot, ".neoj"));
        await writeFile(join(projectRoot, ".neoj", "problem.json"), `${JSON.stringify({ url })}\n`);
    }
    process.env.USERPROFILE = homeDirectory;
    process.env.HOME = homeDirectory;
    process.chdir(projectRoot);
    return projectRoot;
}

describe("stash commands", () => {
    it("honours stash.force before replacing a stash", async () => {
        const projectRoot = await createConfiguredProject(
            '[source]\nfolder = "src"\n\n[stash]\nforce = false\n',
        );
        await writeProblemFiles(projectRoot);

        await saveCurrentProblemStash(false);
        await expect(saveCurrentProblemStash(false)).rejects.toThrow("already exists");
        await expect(saveCurrentProblemStash(true)).resolves.toMatchObject({
            replacedAt: expect.any(String),
        });
    });

    it("requires force to clear every stash", async () => {
        const projectRoot = await createConfiguredProject('[source]\nfolder = "src"\n');
        await writeProblemFiles(projectRoot);
        await saveCurrentProblemStash(false);

        await expect(clearProblemStashes(false)).rejects.toThrow("--force");
        await expect(clearProblemStashes(true)).resolves.toBe(1);
        await expect(listProblemStashes()).resolves.toMatchObject({ entries: [], current: key });
    });

    it("drops the current problem's stash when no id is given", async () => {
        const projectRoot = await createConfiguredProject('[source]\nfolder = "src"\n');
        await writeProblemFiles(projectRoot);
        await saveCurrentProblemStash(false);

        await expect(dropProblemStash()).resolves.toEqual(key);
        await expect(listStashes(projectRoot)).resolves.toEqual([]);
    });

    it("drops a stash by id without a recorded problem", async () => {
        const projectRoot = await createConfiguredProject('[source]\nfolder = "src"\n', {
            withProblem: false,
        });
        await writeProblemFiles(projectRoot);
        await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            { url, key },
            { force: true },
        );
        await saveStash(
            projectRoot,
            createConfig({ sourceFolder: "src" }),
            {
                url: "https://yukicoder.me/problems/no/480",
                key: { platform: "yukicoder", slug: "no480" },
            },
            { force: true },
        );

        await expect(dropProblemStash("yukicoder/no480")).resolves.toEqual({
            platform: "yukicoder",
            slug: "no480",
        });
        await expect(
            listStashes(projectRoot).then((entries) => entries.map((entry) => entry.key)),
        ).resolves.toEqual([key]);
    });

    it("fails when the stash id does not exist", async () => {
        await createConfiguredProject('[source]\nfolder = "src"\n', { withProblem: false });

        await expect(dropProblemStash("atcoder/abc300_z")).rejects.toThrow(
            'No stash found for "atcoder/abc300_z".',
        );
    });
});
