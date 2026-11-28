import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const originalCwd = process.cwd();
const originalUserProfile = process.env.USERPROFILE;
const originalHome = process.env.HOME;
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalFetch = globalThis.fetch;

let testRoot: string | undefined;
const confirmPrompt = mock<(options: { message: string; default: boolean }) => Promise<boolean>>(
    async () => true,
);

afterEach(async () => {
    process.chdir(originalCwd);
    for (const [key, value] of [
        ["USERPROFILE", originalUserProfile],
        ["HOME", originalHome],
        ["LOCALAPPDATA", originalLocalAppData],
    ] as const) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch,
    });

    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true, maxRetries: 3 });
        testRoot = undefined;
    }

    confirmPrompt.mockReset().mockImplementation(async () => true);
});

async function createProject(config: string): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-reset-test-"));
    await Bun.write(join(testRoot, "neoj.toml"), config);
    const homeDirectory = join(testRoot, "home");
    await mkdir(homeDirectory, { recursive: true });
    process.env.USERPROFILE = homeDirectory;
    process.env.HOME = homeDirectory;
    process.env.LOCALAPPDATA = join(testRoot, "local-app-data");
    process.chdir(testRoot);
    return testRoot;
}

const templateConfig = `[source]
folder = "src"
[testcase]
folder = "test"

[template]
enable = true
folder = "template"
mode = "replace"
`;

const overlayConfig = templateConfig.replace('mode = "replace"\n', "");

async function writeSeedFiles(projectRoot: string): Promise<void> {
    await mkdir(join(projectRoot, "template"), { recursive: true });
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await mkdir(join(projectRoot, "test"), { recursive: true });
    await Bun.write(join(projectRoot, "template", "main.cpp"), "template\n");
    await Bun.write(join(projectRoot, "src", "main.cpp"), "modified\n");
    await Bun.write(join(projectRoot, "src", "extra.txt"), "extra\n");
    await Bun.write(join(projectRoot, "test", "sample-1.in"), "old\n");
    await Bun.write(join(projectRoot, "test", "sample-1.out"), "old\n");
}

async function writeProblemMetadata(projectRoot: string, url: string): Promise<void> {
    await mkdir(join(projectRoot, ".neoj"), { recursive: true });
    await Bun.write(join(projectRoot, ".neoj", "problem.json"), `${JSON.stringify({ url })}\n`);
}

function mockAtCoderFetch(input: string, output: string): void {
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: async () =>
            new Response(
                `<html>
                <title>A - Example</title>
                <div id="task-statement">
                    <div class="part"><h3>入力例 1</h3><pre>${input}</pre></div>
                    <div class="part"><h3>出力例 1</h3><pre>${output}</pre></div>
                </div>
                <div class="contest-duration">
                    <time>2026-10-30 00:00:00+0000</time>
                    <time>2026-10-30 01:00:00+0000</time>
                </div>
            </html>`,
                { status: 200 },
            ),
    });
}

const problemUrl = "https://atcoder.jp/contests/abc300/tasks/abc300_a";

async function readText(path: string): Promise<string | undefined> {
    try {
        return await readFile(path, "utf8");
    } catch {
        return undefined;
    }
}

describe("resetWorkspace", () => {
    it("restores source.folder from the template with the replace mode", async () => {
        const projectRoot = await createProject(templateConfig);
        await writeSeedFiles(projectRoot);

        const { resetWorkspace } = await import("@/feature/reset");
        await resetWorkspace({}, { confirm: confirmPrompt });

        expect(await readText(join(projectRoot, "src", "main.cpp"))).toBe("template\n");
        expect(await readText(join(projectRoot, "src", "extra.txt"))).toBeUndefined();
        expect(await readText(join(projectRoot, "test", "sample-1.in"))).toBe("old\n");
        expect(confirmPrompt).toHaveBeenCalledTimes(1);
        expect(confirmPrompt.mock.calls[0]?.[0]?.message).toContain(
            'This will overwrite "source.folder" with the template.',
        );
    });

    it("keeps extra source files with the overlay mode", async () => {
        const projectRoot = await createProject(overlayConfig);
        await writeSeedFiles(projectRoot);

        const { resetWorkspace } = await import("@/feature/reset");
        await resetWorkspace({}, { confirm: confirmPrompt });

        expect(await readText(join(projectRoot, "src", "main.cpp"))).toBe("template\n");
        expect(await readText(join(projectRoot, "src", "extra.txt"))).toBe("extra\n");
    });

    it("changes nothing when the confirmation is declined", async () => {
        const projectRoot = await createProject(templateConfig);
        await writeSeedFiles(projectRoot);
        confirmPrompt.mockImplementation(async () => false);

        const { resetWorkspace } = await import("@/feature/reset");
        await resetWorkspace({}, { confirm: confirmPrompt });

        expect(await readText(join(projectRoot, "src", "main.cpp"))).toBe("modified\n");
        expect(await readText(join(projectRoot, "src", "extra.txt"))).toBe("extra\n");
    });

    it("skips the confirmation with --yes", async () => {
        const projectRoot = await createProject(templateConfig);
        await writeSeedFiles(projectRoot);

        const { resetWorkspace } = await import("@/feature/reset");
        await resetWorkspace({ yes: true }, { confirm: confirmPrompt });

        expect(confirmPrompt).not.toHaveBeenCalled();
        expect(await readText(join(projectRoot, "src", "main.cpp"))).toBe("template\n");
    });

    it("fails when source.folder is requested but the template is disabled", async () => {
        const projectRoot = await createProject(`[testcase]
folder = "test"
`);
        await writeSeedFiles(projectRoot);

        const { resetWorkspace } = await import("@/feature/reset");
        await expect(resetWorkspace({}, { confirm: confirmPrompt })).rejects.toThrow(
            'Cannot restore "source.folder": template.enable is false in this project.',
        );
        expect(await readText(join(projectRoot, "src", "main.cpp"))).toBe("modified\n");
    });

    it("re-downloads the samples with --testcase and warns about handmade cases", async () => {
        const projectRoot = await createProject(templateConfig);
        await writeSeedFiles(projectRoot);
        await writeProblemMetadata(projectRoot, problemUrl);
        await Bun.write(join(projectRoot, "test", "handmade-1.in"), "handmade\n");
        await Bun.write(join(projectRoot, "test", "handmade-1.out"), "handmade\n");
        mockAtCoderFetch("new input", "new output");

        const { resetWorkspace } = await import("@/feature/reset");
        await resetWorkspace({ testcase: true }, { confirm: confirmPrompt });

        expect(confirmPrompt).toHaveBeenCalledTimes(1);
        const message = confirmPrompt.mock.calls[0]?.[0]?.message ?? "";
        expect(message).toContain(
            'replace every file in "test" with the freshly downloaded samples',
        );
        expect(message).toContain('handmade test case file(s) in "test" will also be deleted');

        const files = await readdir(join(projectRoot, "test"));
        expect(files.sort()).toEqual(["sample-1.in", "sample-1.out"]);
        expect(await readText(join(projectRoot, "test", "sample-1.in"))).toBe("new input\n");
        expect(await readText(join(projectRoot, "test", "sample-1.out"))).toBe("new output\n");
        expect(await readText(join(projectRoot, "src", "main.cpp"))).toBe("modified\n");
    });

    it("restores both targets with --all", async () => {
        const projectRoot = await createProject(templateConfig);
        await writeSeedFiles(projectRoot);
        await writeProblemMetadata(projectRoot, problemUrl);
        mockAtCoderFetch("all input", "all output");

        const { resetWorkspace } = await import("@/feature/reset");
        await resetWorkspace({ all: true }, { confirm: confirmPrompt });

        expect(await readText(join(projectRoot, "src", "main.cpp"))).toBe("template\n");
        expect(await readText(join(projectRoot, "src", "extra.txt"))).toBeUndefined();
        expect(await readText(join(projectRoot, "test", "sample-1.in"))).toBe("all input\n");
        expect(confirmPrompt.mock.calls[0]?.[0]?.message).toContain(
            'This will overwrite "source.folder" with the template and replace every file in "test" with the freshly downloaded samples.',
        );
    });

    it("fails when --testcase has no recorded problem", async () => {
        const projectRoot = await createProject(templateConfig);
        await writeSeedFiles(projectRoot);

        const { resetWorkspace } = await import("@/feature/reset");
        await expect(
            resetWorkspace({ testcase: true }, { confirm: confirmPrompt }),
        ).rejects.toThrow(
            'No problem URL is recorded. Run "neoj download <url>" first, or "neoj download blank" to start without a problem.',
        );
        expect(await readText(join(projectRoot, "test", "sample-1.in"))).toBe("old\n");
    });

    it("restores source.folder when the test-case download fails with --all", async () => {
        const projectRoot = await createProject(templateConfig);
        await writeSeedFiles(projectRoot);
        await writeProblemMetadata(projectRoot, "https://example.com/unsupported");
        mockAtCoderFetch("never used", "never used");

        const { resetWorkspace } = await import("@/feature/reset");
        await expect(resetWorkspace({ all: true }, { confirm: confirmPrompt })).rejects.toThrow(
            "Expected a problem URL from a supported platform",
        );

        expect(await readText(join(projectRoot, "src", "main.cpp"))).toBe("modified\n");
        expect(await readText(join(projectRoot, "src", "extra.txt"))).toBe("extra\n");
        expect(await readText(join(projectRoot, "test", "sample-1.in"))).toBe("old\n");
    });

    it("restores the test cases when the template application fails with --all", async () => {
        const projectRoot = await createProject(templateConfig);
        await writeSeedFiles(projectRoot);
        await writeProblemMetadata(projectRoot, problemUrl);
        // A file at the template.folder path makes the template application fail.
        await rm(join(projectRoot, "template"), { recursive: true });
        await Bun.write(join(projectRoot, "template"), "not a directory\n");
        mockAtCoderFetch("never used", "never used");

        const { resetWorkspace } = await import("@/feature/reset");
        await expect(resetWorkspace({ all: true }, { confirm: confirmPrompt })).rejects.toThrow(
            /template\.folder/,
        );

        expect(await readText(join(projectRoot, "test", "sample-1.in"))).toBe("old\n");
    });

    it("accepts --all together with --testcase as the full reset", async () => {
        const projectRoot = await createProject(templateConfig);
        await writeSeedFiles(projectRoot);
        await writeProblemMetadata(projectRoot, problemUrl);
        mockAtCoderFetch("union input", "union output");

        const { resetWorkspace } = await import("@/feature/reset");
        await resetWorkspace({ all: true, testcase: true }, { confirm: confirmPrompt });

        expect(await readText(join(projectRoot, "src", "main.cpp"))).toBe("template\n");
        expect(await readText(join(projectRoot, "test", "sample-1.in"))).toBe("union input\n");
    });

    it("writes nothing outside the project for nested template folders", async () => {
        const projectRoot = await createProject(templateConfig);
        await writeSeedFiles(projectRoot);
        const siblingRoot = await mkdtemp(join(tmpdir(), "neoj-reset-outside-"));
        try {
            const outside = join(siblingRoot, "outside.txt");
            await Bun.write(outside, "keep");
            // A template.folder pointing outside the project must be rejected.
            await Bun.write(
                join(projectRoot, "neoj.toml"),
                templateConfig.replace(
                    'folder = "template"',
                    `folder = "../${basename(siblingRoot)}"`,
                ),
            );

            const { resetWorkspace } = await import("@/feature/reset");
            await expect(resetWorkspace({}, { confirm: confirmPrompt })).rejects.toThrow();
            expect(await readText(outside)).toBe("keep");
        } finally {
            await rm(siblingRoot, { recursive: true, force: true, maxRetries: 3 });
        }
    });
});

describe("createResetCommand", () => {
    it("registers the documented flags", async () => {
        const { createProgram } = await import("@/feature/program");
        const program = createProgram();
        const command = program.commands.find((command) => command.name() === "reset");
        expect(command).toBeDefined();
        const optionNames = command?.options.map((option) => option.long);
        expect(optionNames).toEqual(["--all", "--testcase", "--yes"]);
    });
});
