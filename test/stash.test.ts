import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deriveProblemKey } from "@/feature/problem-sources";
import { clearProblemStashes, listProblemStashes, saveCurrentProblemStash } from "@/feature/stash";
import type { Config } from "@/lib/util/config";
import {
    applyStash,
    clearStashes,
    dropStash,
    EmptyStashError,
    findStash,
    formatStashTimestamp,
    listStashes,
    saveStash,
} from "@/lib/util/stash";

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

function createConfig(options: { src?: string; folder?: string } = {}): Config {
    return {
        src: options.src,
        alias: {},
        run: { silent: false },
        login: { open_browser: true },
        testcase: { folder: options.folder ?? "test", filename: "sample-{}" },
        handmade: { filename: "handmade-{}" },
        test: {
            source: undefined,
            timeout: 10,
            memory: 1024,
            parallel: true,
            cache: false,
            ignore_trailing_space: false,
            ignore_trailing_newline: false,
            show_stderr: "always",
            display_lines: 30,
            show_line_numbers: true,
        },
        languages: {},
        download: { show_sample: false },
        stash: { auto_stash: false, auto_apply: false, force: true },
        template: { enable: false, mode: "overlay" },
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
            slug: "no1480",
        });
    });

    it("rejects URLs from unsupported platforms", () => {
        expect(() => deriveProblemKey("https://example.com/problems/no/480")).toThrow(
            "Expected a problem URL from a supported platform (AtCoder, yukicoder).",
        );
    });
});

describe("saveStash", () => {
    it("saves src and the test-case directory with metadata", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);

        const result = await saveStash(
            projectRoot,
            createConfig({ src: "src" }),
            { url, key },
            { force: true, now: new Date("2026-10-30T12:00:00Z") },
        );

        expect(result.fileCount).toBe(2);
        expect(result.replacedAt).toBeUndefined();
        await expect(
            readdir(stashDirectory(projectRoot)).then((entries) => entries.sort()),
        ).resolves.toEqual(["meta.json", "src", "testcase"]);
        await expect(
            Bun.file(join(stashDirectory(projectRoot), "meta.json")).json(),
        ).resolves.toEqual({
            url,
            platform: "atcoder",
            slug: "abc300_a",
            saved_at: "2026-10-30T12:00:00.000Z",
            slots: { src: "src", testcase: "test" },
            file_count: 2,
        });
        await expect(
            Bun.file(join(stashDirectory(projectRoot), "testcase", "sample-1.in")).text(),
        ).resolves.toBe("1 2");
    });

    it("saves only the slots that exist", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);

        const result = await saveStash(projectRoot, createConfig(), { url, key }, { force: true });

        expect(result.fileCount).toBe(1);
        await expect(findStash(projectRoot, key)).resolves.toMatchObject({
            meta: { slots: { testcase: "test" }, file_count: 1 },
        });
        await expect(readdir(stashDirectory(projectRoot))).resolves.not.toContain("src");
    });

    it("refuses to replace an existing stash without force", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        const config = createConfig({ src: "src" });
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
            saveStash(projectRoot, createConfig({ src: "src" }), { url, key }, { force: true }),
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
            saveStash(projectRoot, createConfig({ src: "test" }), { url, key }, { force: true }),
        ).rejects.toThrow("must not be the same directory");
    });
});

describe("applyStash", () => {
    it("restores an exact mirror and counts removed files", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        const config = createConfig({ src: "src" });
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
        await saveStash(projectRoot, createConfig({ src: "src" }), { url, key }, { force: true });

        const applied = await applyStash(
            projectRoot,
            createConfig({ src: "app", folder: "tests" }),
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

    it("skips a saved src slot when src is no longer configured", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveStash(projectRoot, createConfig({ src: "src" }), { url, key }, { force: true });

        const applied = await applyStash(projectRoot, createConfig(), key);

        expect(applied.written).toBe(1);
        expect(applied.warnings).toEqual([
            'The stash contains "src", but src is not configured. Skipped it.',
        ]);
        await expect(Bun.file(join(projectRoot, "src", "main.cpp")).text()).resolves.toBe(
            "solution",
        );
    });

    it("fails when the problem has no stash", async () => {
        const projectRoot = await createProject();

        await expect(applyStash(projectRoot, createConfig({ src: "src" }), key)).rejects.toThrow(
            'No stash found for "atcoder/abc300_a".',
        );
    });
});

describe("stash bookkeeping", () => {
    it("lists stashes in a stable order", async () => {
        const projectRoot = await createProject();
        await writeProblemFiles(projectRoot);
        await saveStash(projectRoot, createConfig({ src: "src" }), { url, key }, { force: true });
        await saveStash(
            projectRoot,
            createConfig({ src: "src" }),
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
        await saveStash(projectRoot, createConfig({ src: "src" }), { url, key }, { force: true });
        await saveStash(
            projectRoot,
            createConfig({ src: "src" }),
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

async function createConfiguredProject(configToml: string): Promise<string> {
    const projectRoot = await createProject();
    const homeDirectory = join(projectRoot, "home");
    await mkdir(homeDirectory);
    await writeFile(join(projectRoot, "neoj.toml"), configToml);
    await mkdir(join(projectRoot, ".neoj"));
    await writeFile(join(projectRoot, ".neoj", "problem.json"), `${JSON.stringify({ url })}\n`);
    process.env.USERPROFILE = homeDirectory;
    process.env.HOME = homeDirectory;
    process.chdir(projectRoot);
    return projectRoot;
}

describe("stash commands", () => {
    it("honours stash.force before replacing a stash", async () => {
        const projectRoot = await createConfiguredProject(
            'src = "src"\n\n[stash]\nforce = false\n',
        );
        await writeProblemFiles(projectRoot);

        await saveCurrentProblemStash(false);
        await expect(saveCurrentProblemStash(false)).rejects.toThrow("already exists");
        await expect(saveCurrentProblemStash(true)).resolves.toMatchObject({
            replacedAt: expect.any(String),
        });
    });

    it("requires force to clear every stash", async () => {
        const projectRoot = await createConfiguredProject('src = "src"\n');
        await writeProblemFiles(projectRoot);
        await saveCurrentProblemStash(false);

        await expect(clearProblemStashes(false)).rejects.toThrow("--force");
        await expect(clearProblemStashes(true)).resolves.toBe(1);
        await expect(listProblemStashes()).resolves.toMatchObject({ entries: [], current: key });
    });
});
