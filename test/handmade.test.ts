import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runHandmade } from "@/feature/handmade";
import {
    findNextHandmadeTarget,
    formatHandmadeContents,
    HandmadeAbortError,
    readHandmadeBlock,
    saveHandmadeCase,
    type HandmadePrompt,
} from "@/lib/util/handmade";

let testRoot: string | undefined;

afterEach(async () => {
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function createRoot(): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-handmade-test-"));
    return testRoot;
}

interface FakePrompt extends HandmadePrompt {
    prompts: string[];
    writes: string[];
}

function createPrompt(lines: readonly (string | undefined)[]): FakePrompt {
    const queue = [...lines];
    const prompts: string[] = [];
    const writes: string[] = [];
    return {
        prompts,
        writes,
        write: (text) => {
            writes.push(text);
        },
        readLine: async (prompt) => {
            prompts.push(prompt);
            return queue.shift();
        },
    };
}

function targetFor(directory: string, baseName: string) {
    return {
        directory,
        baseName,
        inputPath: join(directory, `${baseName}.in`),
        outputPath: join(directory, `${baseName}.out`),
    };
}

describe("findNextHandmadeTarget", () => {
    it("uses the first number when the directory does not exist", async () => {
        const root = await createRoot();

        await expect(findNextHandmadeTarget(join(root, "test"), "handmade-{}")).resolves.toEqual({
            directory: join(root, "test"),
            baseName: "handmade-1",
            inputPath: join(root, "test", "handmade-1.in"),
            outputPath: join(root, "test", "handmade-1.out"),
        });
    });

    it("skips numbers used by either file and ignores unrelated names", async () => {
        const root = await createRoot();
        const directory = join(root, "test");
        await mkdir(directory, { recursive: true });
        await Bun.write(join(directory, "handmade-1.in"), "1");
        await Bun.write(join(directory, "handmade-2.out"), "2");
        await Bun.write(join(directory, "sample-1.in"), "3");

        const target = await findNextHandmadeTarget(directory, "handmade-{}");

        expect(target.baseName).toBe("handmade-3");
    });

    it("skips entries that only look like case files", async () => {
        const root = await createRoot();
        const directory = join(root, "test");
        await mkdir(join(directory, "handmade-1.in"), { recursive: true });

        const target = await findNextHandmadeTarget(directory, "handmade-{}");

        expect(target.baseName).toBe("handmade-2");
    });

    it("applies the configured pattern", async () => {
        const root = await createRoot();
        const directory = join(root, "test");
        await mkdir(directory, { recursive: true });
        await Bun.write(join(directory, "case-1.in"), "1");

        const target = await findNextHandmadeTarget(directory, "case-{}");

        expect(target.baseName).toBe("case-2");
    });

    it("rejects a pattern without a placeholder instead of looping", async () => {
        const root = await createRoot();

        await expect(findNextHandmadeTarget(join(root, "test"), "handmade")).rejects.toThrow(
            'The handmade file name pattern "handmade" must contain {}.',
        );
    });
});

describe("formatHandmadeContents", () => {
    it("joins lines with a trailing newline", () => {
        expect(formatHandmadeContents(["1 2", "3 4"])).toBe("1 2\n3 4\n");
    });

    it("writes an empty file for an empty block", () => {
        expect(formatHandmadeContents([])).toBe("");
    });
});

describe("readHandmadeBlock", () => {
    it("reads until a blank line and prompts before each line", async () => {
        const prompt = createPrompt(["1 2", "3 4", "", "5"]);

        await expect(readHandmadeBlock(prompt, "input")).resolves.toEqual(["1 2", "3 4"]);
        expect(prompt.prompts).toEqual(["input> ", "input> ", "input> "]);
    });

    it("returns an empty block when the first line is blank", async () => {
        await expect(readHandmadeBlock(createPrompt(["", "x"]), "output")).resolves.toEqual([]);
    });

    it("aborts when the input ends before the blank line", async () => {
        const prompt = createPrompt(["1 2", undefined]);

        await expect(readHandmadeBlock(prompt, "input")).rejects.toBeInstanceOf(HandmadeAbortError);
    });
});

describe("saveHandmadeCase", () => {
    it("creates the directory and writes both files", async () => {
        const root = await createRoot();
        const directory = join(root, "test");
        const target = await findNextHandmadeTarget(directory, "handmade-{}");

        await saveHandmadeCase(target, "1 2\n", "3\n");

        expect(await Bun.file(target.inputPath).text()).toBe("1 2\n");
        expect(await Bun.file(target.outputPath).text()).toBe("3\n");
    });

    it("does not replace existing files", async () => {
        const root = await createRoot();
        const directory = join(root, "test");
        await mkdir(directory, { recursive: true });
        await Bun.write(join(directory, "handmade-1.in"), "keep");
        const target = targetFor(directory, "handmade-1");

        await expect(saveHandmadeCase(target, "new\n", "out\n")).rejects.toThrow(
            'Test case "handmade-1" already exists',
        );
        expect(await Bun.file(join(directory, "handmade-1.in")).text()).toBe("keep");
        expect(await Bun.file(join(directory, "handmade-1.out")).exists()).toBe(false);
    });

    it("does not write the input file when the output path is occupied", async () => {
        const root = await createRoot();
        const directory = join(root, "test");
        await mkdir(join(directory, "handmade-1.out"), { recursive: true });
        const target = targetFor(directory, "handmade-1");

        await expect(saveHandmadeCase(target, "1\n", "2\n")).rejects.toThrow(
            'Test case "handmade-1" already exists',
        );
        expect(await Bun.file(target.inputPath).exists()).toBe(false);
    });
});

describe("runHandmade", () => {
    it("writes the case into the configured folder and pattern", async () => {
        const root = await createRoot();
        const prompt = createPrompt(["1 2", "3 4", "", "9", ""]);

        const target = await runHandmade({
            projectRoot: root,
            folder: "cases",
            filename: "hand-{}",
            prompt,
        });

        expect(target.baseName).toBe("hand-1");
        expect(await Bun.file(join(root, "cases", "hand-1.in")).text()).toBe("1 2\n3 4\n");
        expect(await Bun.file(join(root, "cases", "hand-1.out")).text()).toBe("9\n");
        expect(prompt.prompts).toEqual(["input> ", "input> ", "input> ", "output> ", "output> "]);
        expect(prompt.writes).toEqual(["\n"]);
    });

    it("writes nothing when the output block is aborted", async () => {
        const root = await createRoot();

        await expect(
            runHandmade({
                projectRoot: root,
                folder: "test",
                filename: "handmade-{}",
                prompt: createPrompt(["1 2", "", "9", undefined]),
            }),
        ).rejects.toBeInstanceOf(HandmadeAbortError);

        expect(await readdir(root)).toEqual([]);
    });

    it("uses the next free number instead of overwriting a case", async () => {
        const root = await createRoot();
        const directory = join(root, "test");
        await mkdir(directory, { recursive: true });
        await Bun.write(join(directory, "handmade-1.in"), "keep");

        const target = await runHandmade({
            projectRoot: root,
            folder: "test",
            filename: "handmade-{}",
            prompt: createPrompt(["", "", ""]),
        });

        expect(target.baseName).toBe("handmade-2");
        expect(await Bun.file(join(directory, "handmade-1.in")).text()).toBe("keep");
        expect(await Bun.file(join(directory, "handmade-2.in")).text()).toBe("");
        expect(await Bun.file(join(directory, "handmade-2.out")).text()).toBe("");
    });

    it("rejects a folder outside the project", async () => {
        const root = await createRoot();

        await expect(
            runHandmade({
                projectRoot: root,
                folder: "../outside",
                filename: "handmade-{}",
                prompt: createPrompt([""]),
            }),
        ).rejects.toThrow("testcase.folder must resolve to a directory inside the project");
    });

    it("rejects a folder that overlaps src", async () => {
        const root = await createRoot();
        await mkdir(join(root, "src"));

        await expect(
            runHandmade({
                projectRoot: root,
                folder: "src",
                src: "src",
                filename: "handmade-{}",
                prompt: createPrompt([""]),
            }),
        ).rejects.toThrow("testcase.folder and src must not overlap");
    });
});
