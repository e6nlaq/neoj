import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findProjectConfig } from "@/lib/util/project";
import { copyTemplateFiles } from "@/lib/util/template";

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

        const result = await copyTemplateFiles(templateDirectory, destinationDirectory);

        expect(result).toEqual({
            copied: [join("src", "main.cpp")],
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

        const result = await copyTemplateFiles(templateDirectory, destinationDirectory, true);

        expect(result).toEqual({
            copied: ["neoj.toml"],
            skipped: [],
            errors: [],
        });
        expect(await Bun.file(join(destinationDirectory, "neoj.toml")).text()).toBe("template");
    });
});
