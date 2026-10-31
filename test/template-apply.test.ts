import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyProjectTemplate } from "@/lib/util/template-apply";

let testRoot: string | undefined;

afterEach(async () => {
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function createProject(): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-template-test-"));
    return testRoot;
}

describe("applyProjectTemplate", () => {
    it("overlays template files and replaces file/directory conflicts", async () => {
        const projectRoot = await createProject();
        const template = join(projectRoot, "template");
        const source = join(projectRoot, "src");
        await mkdir(join(template, "conflict"), { recursive: true });
        await mkdir(source);
        await writeFile(join(template, "app.ts"), "template");
        await writeFile(join(template, ".editorconfig"), "root = true");
        await writeFile(join(template, "conflict", "nested.txt"), "nested");
        await writeFile(join(source, "app.ts"), "old");
        await writeFile(join(source, "keep.ts"), "keep");
        await writeFile(join(source, "conflict"), "old file");

        await applyProjectTemplate(projectRoot, "template", "src", "overlay");

        expect(await readFile(join(source, "app.ts"), "utf8")).toBe("template");
        expect(await readFile(join(source, ".editorconfig"), "utf8")).toBe("root = true");
        expect(await readFile(join(source, "keep.ts"), "utf8")).toBe("keep");
        expect(await readFile(join(source, "conflict", "nested.txt"), "utf8")).toBe("nested");
    });

    it("removes all existing contents in replace mode", async () => {
        const projectRoot = await createProject();
        const template = join(projectRoot, "template");
        const source = join(projectRoot, "src");
        await mkdir(template);
        await mkdir(source);
        await writeFile(join(template, "new.ts"), "new");
        await writeFile(join(source, "old.ts"), "old");
        await writeFile(join(source, ".hidden"), "hidden");

        await applyProjectTemplate(projectRoot, "template", "src", "replace");

        expect(await readdir(source)).toEqual(["new.ts"]);
        expect(await readFile(join(source, "new.ts"), "utf8")).toBe("new");
    });

    it("allows an empty template and clears src in replace mode", async () => {
        const projectRoot = await createProject();
        const template = join(projectRoot, "template");
        const source = join(projectRoot, "src");
        await mkdir(template);
        await mkdir(source);
        await writeFile(join(source, "old.ts"), "old");

        await applyProjectTemplate(projectRoot, "template", "src", "replace");

        expect(await readdir(source)).toEqual([]);
    });

    it("does not change src when the template directory is missing", async () => {
        const projectRoot = await createProject();
        const source = join(projectRoot, "src");
        await mkdir(source);
        await writeFile(join(source, "old.ts"), "old");

        await expect(
            applyProjectTemplate(projectRoot, "missing-template", "src", "replace"),
        ).rejects.toThrow("does not exist");

        expect(await readFile(join(source, "old.ts"), "utf8")).toBe("old");
    });

    it("rejects paths outside the project and overlapping template/source directories", async () => {
        const projectRoot = await createProject();
        await mkdir(join(projectRoot, "template"), { recursive: true });

        await expect(
            applyProjectTemplate(projectRoot, "../outside", "src", "overlay"),
        ).rejects.toThrow("inside the project");
        await expect(
            applyProjectTemplate(projectRoot, "template", "template/src", "replace"),
        ).rejects.toThrow("must not overlap");
    });
});
