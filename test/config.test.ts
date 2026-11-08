import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { loadConfig, mergeConfig } from "@/lib/util/config";

const originalCwd = process.cwd();
const originalUserProfile = process.env.USERPROFILE;
const originalHome = process.env.HOME;
let testRoot: string | undefined;

afterEach(async () => {
    process.chdir(originalCwd);
    if (originalUserProfile === undefined) {
        delete process.env.USERPROFILE;
    } else {
        process.env.USERPROFILE = originalUserProfile;
    }
    if (originalHome === undefined) {
        delete process.env.HOME;
    } else {
        process.env.HOME = originalHome;
    }

    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function setTemporaryPaths(): Promise<{ home: string; project: string; root: string }> {
    testRoot = await mkdtemp(join(dirname(originalCwd), "neoj-config-test-"));
    const home = join(testRoot, "home");
    const project = join(testRoot, "project");
    const cwd = join(project, "nested");
    await mkdir(cwd, { recursive: true });
    await mkdir(home, { recursive: true });
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    process.chdir(cwd);
    return { home, project, root: testRoot };
}

describe("mergeConfig", () => {
    it("deep-merges objects, replaces arrays, and prefers override values", () => {
        const merged = mergeConfig(
            {
                nested: { retained: true, replaced: "global" },
                list: ["global"],
                scalar: "global",
            },
            {
                nested: { replaced: "project", added: true },
                list: ["project"],
                scalar: "project",
            },
        );

        expect(merged).toEqual({
            nested: { retained: true, replaced: "project", added: true },
            list: ["project"],
            scalar: "project",
        });
    });

    it("preserves Temporal TOML values as leaf values", () => {
        const instant = Temporal.Instant.from("2026-10-30T00:00:00Z");

        expect(mergeConfig({ date: instant }, {})).toEqual({ date: instant });
    });
});

describe("loadConfig", () => {
    it("returns the default testcase config when both files are missing", async () => {
        await setTemporaryPaths();

        await expect(loadConfig()).resolves.toEqual({
            src: undefined,
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
            },
            testcase: { folder: "test", filename: "sample-{}" },
            handmade: { filename: "handmade-{}" },
            test: {
                source: undefined,
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
            },
            languages: {},
            download: { show_sample: false },
            stash: { auto_stash: false, auto_apply: false, force: true },
            template: { enable: false, exclude: [], mode: "overlay" },
        });
    });

    it("requires src and template.folder when template is enabled", async () => {
        const { project } = await setTemporaryPaths();
        await Bun.write(join(project, "neoj.toml"), "[template]\nenable = true\n");

        await expect(loadConfig()).rejects.toThrow(
            "requires src and template.folder when template.enable is true",
        );
    });

    it("rejects template.path as an unknown key", async () => {
        const { project } = await setTemporaryPaths();
        await Bun.write(join(project, "neoj.toml"), '[template]\npath = "template"');

        await expect(loadConfig()).rejects.toThrow("template.path: Unknown configuration key.");
    });

    it("allows template settings only in the project config", async () => {
        const { home } = await setTemporaryPaths();
        await Bun.write(join(home, ".neoj.toml"), "[template]\nenable = true\n");

        await expect(loadConfig()).rejects.toThrow("may only be set in a project neoj.toml");
    });

    it("reports invalid TOML in the nearest project config", async () => {
        const { home, project, root } = await setTemporaryPaths();
        await Bun.write(join(home, ".neoj.toml"), "");
        await Bun.write(join(root, "neoj.toml"), "valid = true");
        const nearestConfig = join(project, "neoj.toml");
        await Bun.write(nearestConfig, "invalid = [");

        await expect(loadConfig()).rejects.toThrow(
            `Failed to parse config file "${nearestConfig}".`,
        );
    });

    it("reports all invalid keys, types, and config sources without showing values", async () => {
        const { home, project } = await setTemporaryPaths();
        const globalConfigPath = join(home, ".neoj.toml");
        const projectConfigPath = join(project, "neoj.toml");
        await Bun.write(globalConfigPath, '[testcase]\nfilename = "PRIVATE/value-{}"');
        await Bun.write(
            projectConfigPath,
            '[testcase]\nfolder = 3\n[unknown]\nkey = "do not show"',
        );

        let errorMessage = "";
        try {
            await loadConfig();
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
        }

        expect(errorMessage).toContain(globalConfigPath);
        expect(errorMessage).toContain(projectConfigPath);
        expect(errorMessage).toContain("unknown");
        expect(errorMessage).toContain("unknown: Unknown configuration key. (actual type: object)");
        expect(errorMessage).toContain("testcase.folder");
        expect(errorMessage).toContain("actual type: number");
        expect(errorMessage).not.toContain("PRIVATE");
        expect(errorMessage).not.toContain("do not show");
    });

    it("rejects invalid alias names with a specific message", async () => {
        const { project } = await setTemporaryPaths();
        await Bun.write(join(project, "neoj.toml"), '[alias]\n"a/b" = "src/main.cpp"');

        await expect(loadConfig()).rejects.toThrow(
            'alias.a/b: Must not be ".", "..", or contain a path separator. (actual type: string)',
        );
    });

    it("merges global and project testcase settings", async () => {
        const { home, project } = await setTemporaryPaths();
        await Bun.write(
            join(home, ".neoj.toml"),
            '[testcase]\nfolder = "cases"\nfilename = "case-{}"\n\n[download]\nshow_sample = true',
        );
        await Bun.write(
            join(project, "neoj.toml"),
            '[testcase]\nfolder = "tests"\n\n[download]\nshow_sample = false',
        );

        await expect(loadConfig()).resolves.toEqual({
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
            },
            testcase: { folder: "tests", filename: "case-{}" },
            handmade: { filename: "handmade-{}" },
            test: {
                source: undefined,
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
            },
            languages: {},
            download: { show_sample: false },
            stash: { auto_stash: false, auto_apply: false, force: true },
            template: { enable: false, exclude: [], mode: "overlay" },
        });
    });

    it("merges stash settings from the global and project files", async () => {
        const { home, project } = await setTemporaryPaths();
        await Bun.write(join(home, ".neoj.toml"), "[stash]\nauto_stash = true");
        await Bun.write(join(project, "neoj.toml"), "[stash]\nauto_apply = true");

        await expect(loadConfig()).resolves.toMatchObject({
            stash: { auto_stash: true, auto_apply: true, force: true },
        });
    });

    it("lets the project file override run.silent from the global file", async () => {
        const { home, project } = await setTemporaryPaths();
        await Bun.write(join(home, ".neoj.toml"), "[run]\nsilent = true");
        await Bun.write(join(project, "neoj.toml"), "[run]\nsilent = false");

        await expect(loadConfig()).resolves.toMatchObject({ run: { silent: false } });
    });

    it("rejects invalid testcase filename patterns", async () => {
        const { project } = await setTemporaryPaths();
        await Bun.write(join(project, "neoj.toml"), '[testcase]\nfilename = "../case-{}"');

        await expect(loadConfig()).rejects.toThrow(
            `testcase.filename: Must contain exactly one {} and be a file name. (actual type: string)`,
        );
    });

    it("requires exactly one filename placeholder", async () => {
        const { project } = await setTemporaryPaths();
        await Bun.write(join(project, "neoj.toml"), '[testcase]\nfilename = "sample-{}-{}"');

        await expect(loadConfig()).rejects.toThrow(
            `testcase.filename: Must contain exactly one {} and be a file name. (actual type: string)`,
        );
    });

    it("merges handmade filename patterns from the global and project files", async () => {
        const { home, project } = await setTemporaryPaths();
        await Bun.write(join(home, ".neoj.toml"), '[handmade]\nfilename = "hand-{}"');
        await Bun.write(join(project, "neoj.toml"), '[handmade]\nfilename = "case-{}"');

        await expect(loadConfig()).resolves.toMatchObject({
            handmade: { filename: "case-{}" },
        });
    });

    it("rejects invalid handmade filename patterns", async () => {
        const { project } = await setTemporaryPaths();
        await Bun.write(join(project, "neoj.toml"), '[handmade]\nfilename = "handmade"');

        await expect(loadConfig()).rejects.toThrow(
            `handmade.filename: Must contain exactly one {} and be a file name. (actual type: string)`,
        );
    });
});
