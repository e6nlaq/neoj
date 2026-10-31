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
            testcase: { folder: "test", filename: "sample-{}" },
        });
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

    it("rejects unknown configuration keys", async () => {
        const { home, project } = await setTemporaryPaths();
        await Bun.write(join(home, ".neoj.toml"), "setting = true");
        await Bun.write(join(project, "neoj.toml"), "");

        await expect(loadConfig()).rejects.toThrow(
            "Configuration does not match the config schema.",
        );
    });

    it("merges global and project testcase settings", async () => {
        const { home, project } = await setTemporaryPaths();
        await Bun.write(
            join(home, ".neoj.toml"),
            '[testcase]\nfolder = "cases"\nfilename = "case-{}"',
        );
        await Bun.write(join(project, "neoj.toml"), '[testcase]\nfolder = "tests"');

        await expect(loadConfig()).resolves.toEqual({
            testcase: { folder: "tests", filename: "case-{}" },
        });
    });

    it("rejects invalid testcase filename patterns", async () => {
        const { project } = await setTemporaryPaths();
        await Bun.write(join(project, "neoj.toml"), '[testcase]\nfilename = "../case-{}"');

        await expect(loadConfig()).rejects.toThrow(
            "Configuration does not match the config schema.",
        );
    });

    it("requires exactly one filename placeholder", async () => {
        const { project } = await setTemporaryPaths();
        await Bun.write(join(project, "neoj.toml"), '[testcase]\nfilename = "sample-{}-{}"');

        await expect(loadConfig()).rejects.toThrow(
            "Configuration does not match the config schema.",
        );
    });
});
