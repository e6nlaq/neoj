import { afterEach, describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "@/lib/util/config";
import {
    findFreeCaseSpecs,
    GenerateInterruptedError,
    requireGenerateSettings,
    runGenerate,
} from "@/lib/util/generate";

let testRoot: string | undefined;

afterEach(async () => {
    if (testRoot !== undefined) {
        // A child process that just exited can keep its directory busy for a
        // moment on Windows, so retry instead of failing the test.
        await rm(testRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        testRoot = undefined;
    }
});

async function createProject(): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-generate-"));
    // runGenerate realpaths the project root, so derive test expectations from
    // the same source: macOS resolves /var to /private/var and Windows may
    // return 8.3 short names for the temp directory.
    return realpath(testRoot);
}

function createConfig(options: {
    gen?: string;
    naive?: string;
    generate?: Partial<Config["generate"]>;
    languages?: Config["languages"];
    testcase?: Partial<Config["testcase"]>;
}): Config {
    return {
        src: undefined,
        alias: {},
        login: { open_browser: true, auto_login: true },
        submit: {
            confirm: true,
            wait: 3,
            open: true,
            clip: "never",
            preview_lines: 5,
            presubmit_timeout: 30,
        },
        testcase: { folder: "test", filename: "sample-{}", ...options.testcase },
        handmade: { filename: "handmade-{}" },
        generate: {
            gen: options.gen,
            naive: options.naive,
            filename: "random-{}",
            count: 1,
            timeout: 10,
            parallel: true,
            ...options.generate,
        },
        run: { silent: false },
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
        languages:
            options.languages ??
            ({
                echo: {
                    source: "judge/*.{js,ts}",
                    run: [process.execPath, "run", "{source}"],
                },
                fail: {
                    source: "judge/fail/*.{js,ts}",
                    run: [process.execPath, "run", "{source}"],
                },
            } satisfies Config["languages"]),
        download: { show_sample: false },
        stash: { auto_stash: false, auto_apply: false, force: true },
        template: { enable: false, exclude: [], mode: "overlay" },
    };
}

function capture(options: { isTTY?: boolean; columns?: number } = {}): {
    stream: { write(chunk: string): boolean; isTTY?: boolean; columns?: number };
    text(): string;
} {
    let text = "";
    return {
        stream: {
            write(chunk: string) {
                text += chunk;
                return true;
            },
            isTTY: options.isTTY,
            columns: options.columns,
        },
        text() {
            return text;
        },
    };
}

/** Write a generator that prints `number` and a naive solution that echoes it. */
async function writeTools(
    projectRoot: string,
    options: {
        genExit?: number;
        naiveExit?: number;
        genHang?: boolean;
        naiveHang?: boolean;
    } = {},
): Promise<void> {
    await mkdir(join(projectRoot, "judge"), { recursive: true });
    await Bun.write(
        join(projectRoot, "judge", "gen.ts"),
        options.genHang
            ? "setInterval(() => {}, 1000);\n"
            : `if (process.argv[2] === undefined) throw new Error("missing seed");
console.log("seed " + process.argv[2]);
process.exitCode = ${options.genExit ?? 0};
`,
    );
    await Bun.write(
        join(projectRoot, "judge", "naive.ts"),
        options.naiveHang
            ? "setInterval(() => {}, 1000);\n"
            : `const input = await Bun.stdin.text();
console.log("answer " + input.trim());
process.exitCode = ${options.naiveExit ?? 0};
`,
    );
}

describe("requireGenerateSettings", () => {
    it("reports a missing generator with the config key", () => {
        expect(() => requireGenerateSettings(createConfig({}), false)).toThrow(
            "neoj generate needs generate.gen",
        );
        expect(() => requireGenerateSettings(createConfig({}), true)).toThrow(
            "neoj generate needs generate.gen",
        );
    });

    it("reports a missing naive solution unless input-only", () => {
        const config = createConfig({ gen: "judge/gen.ts" });
        expect(() => requireGenerateSettings(config, false)).toThrow("needs generate.naive");
        expect(requireGenerateSettings(config, true)).toEqual({
            gen: "judge/gen.ts",
            naive: undefined,
        });
    });

    it("keeps both settings when they are configured", () => {
        const config = createConfig({ gen: "judge/gen.ts", naive: "judge/naive.ts" });
        expect(requireGenerateSettings(config, false)).toEqual({
            gen: "judge/gen.ts",
            naive: "judge/naive.ts",
        });
    });
});

describe("findFreeCaseSpecs", () => {
    it("starts at 1 when the directory does not exist", async () => {
        const root = await createProject();

        await expect(findFreeCaseSpecs(join(root, "test"), "random-{}", 2)).resolves.toEqual([
            { number: 1, baseName: "random-1" },
            { number: 2, baseName: "random-2" },
        ]);
    });

    it("skips numbers used by either extension and continues the sequence", async () => {
        const root = await createProject();
        const directory = join(root, "test");
        await mkdir(directory, { recursive: true });
        await Bun.write(join(directory, "random-1.in"), "1");
        await Bun.write(join(directory, "random-2.out"), "2");

        await expect(findFreeCaseSpecs(directory, "random-{}", 2)).resolves.toEqual([
            { number: 3, baseName: "random-3" },
            { number: 4, baseName: "random-4" },
        ]);
    });

    it("applies the configured pattern", async () => {
        const root = await createProject();
        const directory = join(root, "test");
        await mkdir(directory, { recursive: true });
        await Bun.write(join(directory, "case-1.in"), "1");

        await expect(findFreeCaseSpecs(directory, "case-{}", 1)).resolves.toEqual([
            { number: 2, baseName: "case-2" },
        ]);
    });

    it("rejects a pattern without a placeholder instead of looping", async () => {
        const root = await createProject();

        await expect(findFreeCaseSpecs(join(root, "test"), "random", 1)).rejects.toThrow(
            'The generate file name pattern "random" must contain {}.',
        );
    });
});

describe("runGenerate", () => {
    it("creates numbered .in and .out pairs from gen and naive", async () => {
        const projectRoot = await createProject();
        await writeTools(projectRoot);
        const stderr = capture();

        const result = await runGenerate({
            projectRoot,
            config: createConfig({
                gen: "judge/gen.ts",
                naive: "judge/naive.ts",
                generate: { count: 2 },
            }),
            stderr: stderr.stream,
        });

        const directory = join(projectRoot, "test");
        expect(result.cases.map((testCase) => testCase.baseName)).toEqual(["random-1", "random-2"]);
        expect(await readFile(join(directory, "random-1.in"), "utf8")).toBe("seed 1\n");
        expect(await readFile(join(directory, "random-1.out"), "utf8")).toBe("answer seed 1\n");
        expect(await readFile(join(directory, "random-2.in"), "utf8")).toBe("seed 2\n");
        expect(await readFile(join(directory, "random-2.out"), "utf8")).toBe("answer seed 2\n");
        expect(readdirSyncNames(directory).sort()).toEqual([
            "random-1.in",
            "random-1.out",
            "random-2.in",
            "random-2.out",
        ]);
        expect(stderr.text()).toBe("");
    });

    it("creates only inputs with inputOnly and needs no naive solution", async () => {
        const projectRoot = await createProject();
        await writeTools(projectRoot);
        const stderr = capture();

        const result = await runGenerate({
            projectRoot,
            config: createConfig({ gen: "judge/gen.ts", naive: undefined }),
            inputOnly: true,
            stderr: stderr.stream,
        });

        const directory = join(projectRoot, "test");
        expect(result.cases).toEqual([
            {
                number: 1,
                baseName: "random-1",
                inputPath: join(directory, "random-1.in"),
                outputPath: undefined,
            },
        ]);
        expect(readdirSyncNames(directory)).toEqual(["random-1.in"]);
    });

    it("keeps the naive output as-is, including an empty output", async () => {
        const projectRoot = await createProject();
        await mkdir(join(projectRoot, "judge"), { recursive: true });
        await Bun.write(join(projectRoot, "judge", "gen.ts"), 'console.log("x");\n');
        await Bun.write(join(projectRoot, "judge", "naive.ts"), "");

        const result = await runGenerate({
            projectRoot,
            config: createConfig({ gen: "judge/gen.ts", naive: "judge/naive.ts" }),
        });

        expect(await readFile(result.cases[0]!.inputPath, "utf8")).toBe("x\n");
        expect(await readFile(result.cases[0]!.outputPath!, "utf8")).toBe("");
    });

    it("stops at the first tool failure and keeps completed cases", async () => {
        const projectRoot = await createProject();
        await writeTools(projectRoot);
        const directory = join(projectRoot, "test");
        // Force case 2 to fail while case 1 succeeds.
        await Bun.write(
            join(projectRoot, "judge", "gen.ts"),
            'if (process.argv[2] === "2") process.exit(3);\nconsole.log("seed " + process.argv[2]);\n',
        );

        await expect(
            runGenerate({
                projectRoot,
                config: createConfig({
                    gen: "judge/gen.ts",
                    naive: "judge/naive.ts",
                    generate: { count: 3, parallel: false },
                }),
            }),
        ).rejects.toThrow('Generator failed on "random-2" (exit code 3).');

        expect(readdirSyncNames(directory).sort()).toEqual(["random-1.in", "random-1.out"]);
    });

    it("reports the failing tool's stderr in the error", async () => {
        const projectRoot = await createProject();
        await writeTools(projectRoot, { naiveExit: 1 });
        await Bun.write(
            join(projectRoot, "judge", "naive.ts"),
            'console.error("boom");\nprocess.exit(1);\n',
        );

        await expect(
            runGenerate({
                projectRoot,
                config: createConfig({ gen: "judge/gen.ts", naive: "judge/naive.ts" }),
            }),
        ).rejects.toThrow('Naive solution failed on "random-1" (exit code 1).\n\nboom');
    });

    it("fails when the generator exceeds its time limit", async () => {
        const projectRoot = await createProject();
        await writeTools(projectRoot, { genHang: true });

        await expect(
            runGenerate({
                projectRoot,
                config: createConfig({
                    gen: "judge/gen.ts",
                    naive: "judge/naive.ts",
                    generate: { timeout: 0.2 },
                }),
            }),
        ).rejects.toThrow('Generator timed out after 0.2 s on "random-1".');
    });

    it("reports a missing generator source file", async () => {
        const projectRoot = await createProject();

        await expect(
            runGenerate({
                projectRoot,
                config: createConfig({ gen: "judge/missing.ts", naive: "judge/naive.ts" }),
            }),
        ).rejects.toThrow('Generator source "judge/missing.ts" does not exist.');
    });

    it("removes incomplete files when the signal is already aborted", async () => {
        const projectRoot = await createProject();
        await writeTools(projectRoot);
        const directory = join(projectRoot, "test");
        const controller = new AbortController();
        controller.abort();

        await expect(
            runGenerate({
                projectRoot,
                config: createConfig({
                    gen: "judge/gen.ts",
                    naive: "judge/naive.ts",
                    generate: { count: 2, parallel: false },
                }),
                signal: controller.signal,
            }),
        ).rejects.toBeInstanceOf(GenerateInterruptedError);

        expect(readdirSyncNames(directory).sort()).toEqual([]);
    });

    it("aborts a hanging naive solution and removes only its partial files", async () => {
        const projectRoot = await createProject();
        await writeTools(projectRoot, { naiveHang: true });
        const directory = join(projectRoot, "test");
        const controller = new AbortController();
        // Abort once the first case's naive solution is hanging mid-run.
        setTimeout(() => controller.abort(), 150);

        await expect(
            runGenerate({
                projectRoot,
                config: createConfig({
                    gen: "judge/gen.ts",
                    naive: "judge/naive.ts",
                    generate: { count: 2, timeout: 30 },
                }),
                signal: controller.signal,
            }),
        ).rejects.toBeInstanceOf(GenerateInterruptedError);

        expect(readdirSyncNames(directory).sort()).toEqual([]);
    });

    it("reuses cached builds without leaving build directories behind", async () => {
        const projectRoot = await createProject();
        await writeTools(projectRoot);
        const stderr = capture();
        // A compiled language so the build cache has entries to keep.
        const languages = {
            bundled: {
                source: "judge/*.ts",
                compile: [process.execPath, "build", "--outfile", "{outfile}", "{source}"],
                run: [process.execPath, "{outfile}"],
            },
        } satisfies Config["languages"];
        const config = (count: number) =>
            createConfig({
                gen: "judge/gen.ts",
                naive: "judge/naive.ts",
                languages,
                generate: { count },
            });

        const first = await runGenerate({
            projectRoot,
            config: config(2),
            cache: true,
            stderr: stderr.stream,
        });
        const second = await runGenerate({
            projectRoot,
            config: config(2),
            cache: true,
            stderr: stderr.stream,
        });

        expect(first.cases[0]!.baseName).toBe("random-1");
        expect(second.cases[0]!.baseName).toBe("random-3");
        expect(await exists(join(projectRoot, ".neoj", "build"))).toBe(true);
        await runGenerate({ projectRoot, config: config(1) });
        expect(await readdir(join(projectRoot, ".neoj", "build"))).toEqual([]);
    });
});

function readdirSyncNames(directory: string): string[] {
    try {
        return readdirSync(directory);
    } catch {
        return [];
    }
}
async function exists(path: string): Promise<boolean> {
    try {
        await realpath(path);
        return true;
    } catch {
        return false;
    }
}
