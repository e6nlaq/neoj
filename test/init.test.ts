import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findProjectConfig, requireInitializedProject } from "@/lib/util/project";
import { copyTemplateFiles } from "@/lib/util/template";
import { templateFiles } from "@/lib/util/template-assets";

let testRoot: string | undefined;

afterEach(async () => {
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function createTestRoot(): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-init-test-"));
    return testRoot;
}

describe("findProjectConfig", () => {
    it("returns the nearest ancestor config file", async () => {
        const root = await createTestRoot();
        const outerConfig = join(root, "neoj.toml");
        const projectDirectory = join(root, "project");
        const innerConfig = join(projectDirectory, "neoj.toml");
        const cwd = join(projectDirectory, "nested");
        await mkdir(cwd, { recursive: true });
        await Bun.write(outerConfig, "");
        await Bun.write(innerConfig, "");

        await expect(findProjectConfig(cwd)).resolves.toBe(innerConfig);
    });

    it("does not treat a home config as a project config", async () => {
        const root = await createTestRoot();
        const homeDirectory = join(root, "home");
        const projectDirectory = join(root, "project");
        await mkdir(homeDirectory, { recursive: true });
        await mkdir(projectDirectory, { recursive: true });
        await Bun.write(join(homeDirectory, ".neoj.toml"), "");

        await expect(findProjectConfig(projectDirectory)).resolves.toBeUndefined();
    });

    it("stops searching at the repository root", async () => {
        const root = await createTestRoot();
        const repository = join(root, "repository");
        const cwd = join(repository, "project", "nested");
        await mkdir(cwd, { recursive: true });
        await mkdir(join(repository, ".git"), { recursive: true });
        await Bun.write(join(root, "neoj.toml"), "");

        await expect(findProjectConfig(cwd)).resolves.toBeUndefined();
    });

    it("finds a config at the repository root", async () => {
        const root = await createTestRoot();
        const repository = join(root, "repository");
        const cwd = join(repository, "project");
        await mkdir(cwd, { recursive: true });
        await mkdir(join(repository, ".git"), { recursive: true });
        const configPath = join(repository, "neoj.toml");
        await Bun.write(configPath, "");

        await expect(findProjectConfig(cwd)).resolves.toBe(configPath);
    });

    it("treats a .git file as a repository root for worktrees", async () => {
        const root = await createTestRoot();
        const repository = join(root, "worktree");
        const cwd = join(repository, "nested");
        await mkdir(cwd, { recursive: true });
        await Bun.write(join(repository, ".git"), "gitdir: ../main/.git/worktrees/worktree");
        await Bun.write(join(root, "neoj.toml"), "");

        await expect(findProjectConfig(cwd)).resolves.toBeUndefined();
    });
});

describe("requireInitializedProject", () => {
    it("uses the nearest initialized project config as the project root", async () => {
        const root = await createTestRoot();
        const repository = join(root, "repository");
        const cwd = join(repository, "nested", "deeper");
        const projectDirectory = join(repository, "nested");
        await mkdir(join(repository, ".git"), { recursive: true });
        await mkdir(cwd, { recursive: true });
        await Bun.write(join(repository, "neoj.toml"), "");
        await Bun.write(join(projectDirectory, "neoj.toml"), "");

        await expect(requireInitializedProject(cwd)).resolves.toBe(projectDirectory);
    });

    it("requires a project config and does not accept a global config", async () => {
        const root = await createTestRoot();
        const repository = join(root, "repository");
        const cwd = join(repository, "nested");
        await mkdir(join(repository, ".git"), { recursive: true });
        await mkdir(cwd, { recursive: true });
        await Bun.write(join(root, ".neoj.toml"), "");

        await expect(requireInitializedProject(cwd)).rejects.toThrow(
            'Project is not initialized. Run "neoj init"',
        );
    });
});

describe("copyTemplateFiles", () => {
    it("copies nested files and skips conflicts while continuing", async () => {
        const root = await createTestRoot();
        const templateDirectory = join(root, "template");
        const destinationDirectory = join(root, "project");
        await mkdir(join(templateDirectory, "src"), { recursive: true });
        await Bun.write(join(templateDirectory, "neoj.toml"), "template");
        await Bun.write(join(templateDirectory, "src", "main.cpp"), "source");
        await mkdir(destinationDirectory, { recursive: true });
        await Bun.write(join(destinationDirectory, "neoj.toml"), "existing");

        const result = await copyTemplateFiles(
            [
                { path: "neoj.toml", source: join(templateDirectory, "neoj.toml") },
                { path: "src/main.cpp", source: join(templateDirectory, "src", "main.cpp") },
            ],
            destinationDirectory,
        );

        expect(result).toEqual({
            copied: ["src/main.cpp"],
            skipped: ["neoj.toml"],
            errors: [],
        });
        expect(await Bun.file(join(destinationDirectory, "neoj.toml")).text()).toBe("existing");
        expect(await Bun.file(join(destinationDirectory, "src", "main.cpp")).text()).toBe("source");
    });

    it("overwrites existing files when force is enabled", async () => {
        const root = await createTestRoot();
        const templateDirectory = join(root, "template");
        const destinationDirectory = join(root, "project");
        await mkdir(templateDirectory, { recursive: true });
        await mkdir(destinationDirectory, { recursive: true });
        await Bun.write(join(templateDirectory, "neoj.toml"), "template");
        await Bun.write(join(destinationDirectory, "neoj.toml"), "existing");

        const result = await copyTemplateFiles(
            [{ path: "neoj.toml", source: join(templateDirectory, "neoj.toml") }],
            destinationDirectory,
            true,
        );

        expect(result).toEqual({
            copied: ["neoj.toml"],
            skipped: [],
            errors: [],
        });
        expect(await Bun.file(join(destinationDirectory, "neoj.toml")).text()).toBe("template");
    });
});

describe("templateFiles", () => {
    it("lists the bundled templates with POSIX paths", () => {
        expect(templateFiles.map(({ path }) => path)).toEqual([
            ".gitignore",
            "neoj.toml",
            "src/main.cpp",
            "template/main.cpp",
        ]);
    });

    it("copies every bundled template into an empty directory", async () => {
        const root = await createTestRoot();
        const destinationDirectory = join(root, "project");

        const result = await copyTemplateFiles(templateFiles, destinationDirectory);

        expect(result.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(result.copied).toEqual(templateFiles.map(({ path }) => path));
        for (const { path } of templateFiles) {
            expect(
                (await Bun.file(join(destinationDirectory, path)).text()).length,
            ).toBeGreaterThan(0);
        }
    });
});
