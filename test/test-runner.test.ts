import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "@/lib/util/config";
import {
    collectCacheFiles,
    computeBuildKey,
    detectLanguage,
    discoverInteractiveTestCases,
    discoverJudgeTestCases,
    discoverTestCases,
    expandTokens,
    judgeCheckerResult,
    judgeCommandResult,
    judgeInteractiveResult,
    naturalCompare,
    readLanguages,
    resolveSourceFile,
    resolveTestSource,
    runTests,
    buildSolution,
    cleanupBuild,
    type TestLanguage,
} from "@/lib/util/test-runner";

const strict = { ignoreTrailingSpace: false, ignoreTrailingNewline: false };

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
    testRoot = await mkdtemp(join(tmpdir(), "neoj-test-runner-"));
    return testRoot;
}

function createConfig(options: {
    source?: string;
    test?: Partial<Config["test"]>;
    languages?: Config["languages"];
    testcase?: Partial<Config["testcase"]>;
    alias?: Config["alias"];
    run?: Partial<Config["run"]>;
}): Config {
    return {
        src: undefined,
        alias: options.alias ?? {},
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
        run: { silent: false, ...options.run },
        test: {
            source: options.source,
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
            ...options.test,
        },
        languages: options.languages ?? {},
        download: { show_sample: false },
        stash: { auto_stash: false, auto_apply: false, force: true },
        template: { enable: false, exclude: [], mode: "overlay" },
    };
}

function createCapture(options: { isTTY?: boolean; columns?: number } = {}): {
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
            ...options,
        },
        text: () => text,
    };
}

async function writeCase(
    directory: string,
    name: string,
    input: string,
    output?: string,
): Promise<void> {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${name}.in`), input);
    if (output !== undefined) {
        await writeFile(join(directory, `${name}.out`), output);
    }
}

const runnerScript = `const text = (await Bun.stdin.text()).trim();
if (text === "ac") {
    console.error("ac-note");
    console.log("3 7");
} else if (text === "wa") {
    console.log("3 8");
} else if (text === "re") {
    for (let index = 0; index < 30; index += 1) {
        console.error("err-" + index);
    }
    process.exit(1);
} else {
    console.log("free");
}
`;

describe("readLanguages", () => {
    it("normalizes source globs and drops an empty compile list", () => {
        const languages = readLanguages(
            createConfig({
                languages: {
                    cpp: {
                        source: "src\\main.cpp",
                        compile: [],
                        run: ["{outfile}"],
                        timeout: 2,
                        memory: 256,
                        cache_files: ["src/*.hpp"],
                    },
                    py: { source: ["a.py", "b.py"], run: ["python"] },
                },
            }),
        );

        expect(languages.get("cpp")).toEqual({
            key: "cpp",
            sourcePatterns: ["src/main.cpp"],
            compile: undefined,
            run: ["{outfile}"],
            timeoutSeconds: 2,
            memoryMiB: 256,
            cacheFiles: ["src/*.hpp"],
            presubmit: undefined,
            submit: {},
        });
        expect(languages.get("py")?.sourcePatterns).toEqual(["a.py", "b.py"]);
        expect(languages.get("py")?.cacheFiles).toEqual([]);
    });

    it("rejects absolute globs and parent traversal", () => {
        expect(() =>
            readLanguages(
                createConfig({
                    languages: { cpp: { source: "/etc/*.cpp", run: ["x"] } },
                }),
            ),
        ).toThrow("must be a relative glob");
        expect(() =>
            readLanguages(
                createConfig({
                    languages: { cpp: { source: "../*.cpp", run: ["x"] } },
                }),
            ),
        ).toThrow("must stay inside the project");
    });
});

describe("naturalCompare", () => {
    it("orders numeric parts as numbers", () => {
        const names = ["sample-10", "sample-2", "sample-1", "sample-01"];

        expect([...names].sort(naturalCompare)).toEqual([
            "sample-1",
            "sample-01",
            "sample-2",
            "sample-10",
        ]);
    });

    it("falls back to plain text ordering", () => {
        expect(naturalCompare("a", "b")).toBe(-1);
        expect(naturalCompare("b", "a")).toBe(1);
        expect(naturalCompare("a", "a")).toBe(0);
    });
});

describe("resolveSourceFile", () => {
    it("resolves a file inside the project", async () => {
        const projectRoot = await createProject();
        await writeFile(join(projectRoot, "main.cpp"), "int main() {}");

        const resolved = await resolveSourceFile(projectRoot, projectRoot, "main.cpp");
        const canonicalProjectRoot = await realpath(projectRoot);

        expect(resolved.relativePath).toBe("main.cpp");
        expect(resolved.absolutePath).toBe(join(canonicalProjectRoot, "main.cpp"));
    });

    it("reports missing files and paths outside the project", async () => {
        const projectRoot = await createProject();

        await expect(resolveSourceFile(projectRoot, projectRoot, "main.cpp")).rejects.toThrow(
            "does not exist",
        );
        await expect(resolveSourceFile(projectRoot, projectRoot, "../outside.cpp")).rejects.toThrow(
            "must be inside the project",
        );
    });

    it("rejects directories", async () => {
        const projectRoot = await createProject();
        await mkdir(join(projectRoot, "src"));

        await expect(resolveSourceFile(projectRoot, projectRoot, "src")).rejects.toThrow(
            "is not a regular file",
        );
    });
});

describe("resolveTestSource", () => {
    async function createAliasProject(): Promise<{ projectRoot: string; canonicalRoot: string }> {
        const projectRoot = await createProject();
        await mkdir(join(projectRoot, "src"), { recursive: true });
        await writeFile(join(projectRoot, "src", "main.ts"), "main");
        await writeFile(join(projectRoot, "src", "other.ts"), "other");
        return { projectRoot, canonicalRoot: await realpath(projectRoot) };
    }

    it("expands an alias from any working directory", async () => {
        const { projectRoot } = await createAliasProject();
        const config = createConfig({ alias: { main: "src/main.ts" } });

        const fromRoot = await resolveTestSource(projectRoot, { source: "main", config }, "main");
        const fromSubdirectory = await resolveTestSource(
            projectRoot,
            { source: "main", cwd: join(projectRoot, "src"), config },
            "main",
        );

        expect(fromRoot.relativePath).toBe("src/main.ts");
        expect(fromSubdirectory.relativePath).toBe("src/main.ts");
    });

    it("prefers an alias over a file with the same name", async () => {
        const { projectRoot } = await createAliasProject();
        await writeFile(join(projectRoot, "main"), "shadowed");

        const resolved = await resolveTestSource(
            projectRoot,
            { source: "main", config: createConfig({ alias: { main: "src/main.ts" } }) },
            "main",
        );

        expect(resolved.relativePath).toBe("src/main.ts");
    });

    it("still accepts a plain path", async () => {
        const { projectRoot } = await createAliasProject();

        const resolved = await resolveTestSource(
            projectRoot,
            { source: "src/other.ts", cwd: projectRoot, config: createConfig({}) },
            "src/other.ts",
        );

        expect(resolved.relativePath).toBe("src/other.ts");
    });

    it("names the alias when its target is unusable", async () => {
        const { projectRoot } = await createAliasProject();
        const resolve = (source: string, alias: Config["alias"]) =>
            resolveTestSource(projectRoot, { source, config: createConfig({ alias }) }, source);

        await expect(resolve("main", { main: "src/none.ts" })).rejects.toThrow(
            'Alias "main" points to "src/none.ts", which does not exist.',
        );
        await expect(resolve("up", { up: "../outside.ts" })).rejects.toThrow(
            'Alias "up" points to "../outside.ts", which is outside the project.',
        );
        await expect(resolve("dir", { dir: "src" })).rejects.toThrow(
            'Alias "dir" points to "src", which is not a regular file.',
        );
    });

    it("lists the available aliases when nothing matches", async () => {
        const { projectRoot } = await createAliasProject();
        const config = createConfig({ alias: { main: "src/main.ts", old: "src/other.ts" } });

        await expect(
            resolveTestSource(projectRoot, { source: "nain", cwd: projectRoot, config }, "nain"),
        ).rejects.toThrow(
            'Neither a file nor an alias matches "nain". Available aliases: main, old.',
        );
        await expect(
            resolveTestSource(
                projectRoot,
                { source: "nain", cwd: projectRoot, config: createConfig({}) },
                "nain",
            ),
        ).rejects.toThrow("No aliases are defined in [alias].");
    });

    it("does not expand test.source", async () => {
        const { projectRoot } = await createAliasProject();
        const config = createConfig({ source: "main", alias: { main: "src/main.ts" } });

        await expect(resolveTestSource(projectRoot, { config }, "main")).rejects.toThrow(
            'Source file "main" does not exist',
        );
    });
});

describe("detectLanguage", () => {
    const languages = readLanguages(
        createConfig({
            languages: {
                cpp: { source: "src/*.cpp", run: ["{outfile}"] },
                cppHeader: { source: "src/*.cpp", run: ["{outfile}"] },
                py: { source: "*.py", run: ["python"] },
            },
        }),
    );

    it("returns the only matching language", () => {
        expect(detectLanguage(languages, "main.py").key).toBe("py");
    });

    it("reports when nothing matches", () => {
        expect(() => detectLanguage(languages, "main.rs")).toThrow("No language matches");
    });

    it("lists the ambiguous languages and honours the override", () => {
        expect(() => detectLanguage(languages, "src/main.cpp")).toThrow(
            "--language <key> to choose one",
        );
        expect(detectLanguage(languages, "src/main.cpp", "cpp").key).toBe("cpp");
        expect(detectLanguage(languages, "src/main.cpp", "cppHeader").key).toBe("cppHeader");
    });

    it("rejects an unknown or non-matching override", () => {
        expect(() => detectLanguage(languages, "src/main.cpp", "rust")).toThrow(
            'Unknown language "rust"',
        );
        expect(() => detectLanguage(languages, "main.py", "cpp")).toThrow(
            "does not match languages.cpp.source",
        );
    });
});

describe("expandTokens", () => {
    const values = {
        source: "/p/main.cpp",
        outfile: "/p/build/a",
        outdir: "/p/build",
        dir: "/p",
        testdir: "/p/test",
    };

    it("replaces every supported placeholder", () => {
        expect(
            expandTokens(["g++", "-o", "{outfile}", "{source}", "{outdir}/x"], values, "compile"),
        ).toEqual(["g++", "-o", "/p/build/a", "/p/main.cpp", "/p/build/x"]);
    });

    it("rejects unknown placeholders", () => {
        expect(() => expandTokens(["{bogus}"], values, "languages.cpp.run")).toThrow(
            'uses the unknown placeholder "{bogus}"',
        );
    });
});

describe("discoverTestCases", () => {
    it("pairs inputs with outputs and keeps unjudged inputs", async () => {
        const projectRoot = await createProject();
        const directory = join(projectRoot, "test");
        await writeCase(directory, "sample-10", "c", "c");
        await writeCase(directory, "sample-2", "b", "b");
        await writeCase(directory, "sample-1", "a");
        await writeFile(join(directory, "orphan.out"), "ignored");

        const cases = await discoverTestCases(directory, []);

        expect(cases.map((testCase) => testCase.name)).toEqual([
            "sample-1",
            "sample-2",
            "sample-10",
        ]);
        expect(cases[0]?.expectedOutputPath).toBeUndefined();
        expect(cases[1]?.expectedOutputPath?.endsWith("sample-2.out")).toBe(true);
    });

    it("filters by exact name and reports unknown names", async () => {
        const projectRoot = await createProject();
        const directory = join(projectRoot, "test");
        await writeCase(directory, "sample-1", "a", "a");
        await writeCase(directory, "sample-2", "b", "b");

        expect((await discoverTestCases(directory, ["sample-2"])).map((item) => item.name)).toEqual(
            ["sample-2"],
        );
        await expect(discoverTestCases(directory, ["sample-3"])).rejects.toThrow(
            "No test case matches",
        );
    });

    it("explains an empty or missing directory", async () => {
        const projectRoot = await createProject();
        const directory = join(projectRoot, "test");
        await mkdir(directory);

        await expect(discoverTestCases(directory, [])).rejects.toThrow('No test case ("*.in")');
        await expect(discoverTestCases(join(projectRoot, "missing"), [])).rejects.toThrow(
            "does not exist",
        );
    });
});

describe("collectCacheFiles", () => {
    it("expands globs once and sorts the result", async () => {
        const projectRoot = await createProject();
        await mkdir(join(projectRoot, "src"), { recursive: true });
        await writeFile(join(projectRoot, "src", "b.hpp"), "");
        await writeFile(join(projectRoot, "src", "a.hpp"), "");

        const files = await collectCacheFiles(projectRoot, ["src/*.hpp", "src/a.hpp"]);

        expect(files.map((file) => file.relativePath)).toEqual(["src/a.hpp", "src/b.hpp"]);
    });
});

describe("computeBuildKey", () => {
    const language: TestLanguage = {
        key: "cpp",
        sourcePatterns: ["src/*.cpp"],
        compile: ["g++", "-o", "{outfile}", "{source}"],
        run: ["{outfile}"],
        timeoutSeconds: undefined,
        memoryMiB: undefined,
        cacheFiles: [],
        presubmit: undefined,
        submit: {},
    };

    function buildKey(options: {
        contents?: string;
        compile?: string[];
        cacheFiles?: { relativePath: string; contents: string }[];
    }): string {
        return computeBuildKey({
            language: { ...language, compile: options.compile ?? language.compile },
            sourceRelativePath: "src/main.cpp",
            sourceContents: options.contents ?? "int main() {}",
            cacheFiles: options.cacheFiles ?? [],
            platform: "test",
            arch: "test",
        });
    }

    it("is stable for the same inputs", () => {
        expect(buildKey({})).toBe(buildKey({}));
    });

    it("changes with the source, the compile command, and cache files", () => {
        const base = buildKey({});

        expect(buildKey({ contents: "int main() { return 1; }" })).not.toBe(base);
        expect(buildKey({ compile: ["g++", "-O2", "{source}"] })).not.toBe(base);
        expect(buildKey({ cacheFiles: [{ relativePath: "src/a.hpp", contents: "x" }] })).not.toBe(
            base,
        );
    });
});

describe("judgeCommandResult", () => {
    const base = {
        exitCode: 0,
        signal: null,
        timedOut: false,
        outputLimitExceeded: false,
        maxRssBytes: 1024 * 1024,
        stdout: "3 7\n",
        expectedOutput: "3 7\n",
        memoryMiB: 1024,
        comparison: strict,
    };

    it("accepts matching output", () => {
        expect(judgeCommandResult(base).verdict).toBe("AC");
    });

    it("reports wrong answers with the first differing line", () => {
        const judged = judgeCommandResult({ ...base, stdout: "3 8\n" });

        expect(judged.verdict).toBe("WA");
        expect(judged.comparison?.firstMismatchLine).toBe(1);
    });

    it("leaves cases without expected output unjudged", () => {
        expect(judgeCommandResult({ ...base, expectedOutput: undefined }).verdict).toBe("UNJUDGED");
    });

    it("prefers the time limit over everything else", () => {
        const judged = judgeCommandResult({
            ...base,
            timedOut: true,
            exitCode: null,
            maxRssBytes: 10 * 1024 * 1024 * 1024,
        });

        expect(judged.verdict).toBe("TLE");
    });

    it("detects memory and output limits", () => {
        expect(
            judgeCommandResult({ ...base, maxRssBytes: 2 * 1024 * 1024, memoryMiB: 1 }).verdict,
        ).toBe("MLE");
        expect(judgeCommandResult({ ...base, outputLimitExceeded: true }).verdict).toBe("RE");
    });

    it("reports the exit status of a crashed program", () => {
        const judged = judgeCommandResult({ ...base, exitCode: 1 });

        expect(judged.verdict).toBe("RE");
        expect(judged.detail).toBe("exit code 1");
        expect(judgeCommandResult({ ...base, exitCode: null, signal: "SIGSEGV" }).detail).toBe(
            "killed by SIGSEGV",
        );
    });
});

describe("buildSolution", () => {
    it("does not touch the test-case directory when {testdir} is unused", async () => {
        const projectRoot = await createProject();
        await writeFile(join(projectRoot, "main.ts"), "0");

        const built = await buildSolution({
            projectRoot,
            command: "run",
            config: createConfig({
                source: "main.ts",
                testcase: { folder: join(projectRoot, "invalid-absolute") },
                languages: {
                    ts: { source: "main.ts", run: [process.execPath, "main.ts"] },
                },
            }),
        });

        expect(built.testDirectory).toBeUndefined();
        expect(built.runTokens).toEqual([process.execPath, "main.ts"]);
        await cleanupBuild(built);
    });

    it("resolves the test-case directory when {testdir} is used", async () => {
        const projectRoot = await createProject();
        await writeFile(join(projectRoot, "main.ts"), "0");

        const built = await buildSolution({
            projectRoot,
            command: "run",
            config: createConfig({
                source: "main.ts",
                testcase: { folder: "samples" },
                languages: {
                    ts: { source: "main.ts", run: [process.execPath, "{testdir}"] },
                },
            }),
        });

        const expectedDirectory = join(await realpath(projectRoot), "samples");
        expect(built.testDirectory).toBe(expectedDirectory);
        expect(built.runTokens).toEqual([process.execPath, expectedDirectory]);
    });

    it("reports compiler output even when the compiled line is not requested", async () => {
        const projectRoot = await createProject();
        await writeFile(join(projectRoot, "main.ts"), "0");

        const output: string[] = [];
        const compiled: string[] = [];
        await expect(
            buildSolution({
                projectRoot,
                command: "run",
                config: createConfig({
                    source: "main.ts",
                    languages: {
                        ts: {
                            source: "main.ts",
                            compile: [
                                process.execPath,
                                "build",
                                "missing.ts",
                                "--outfile",
                                "{outfile}",
                            ],
                            run: [process.execPath, "{outfile}"],
                        },
                    },
                }),
                onCompilerOutput: (chunk) => output.push(chunk),
                onCompiled: (line) => compiled.push(line),
            }),
        ).rejects.toThrow("Compilation failed for languages.ts");

        expect(output.join("\n")).toContain("error:");
        expect(compiled).toEqual([]);
    });
});

describe("runTests", () => {
    async function createRunnerProject(): Promise<string> {
        const projectRoot = await createProject();
        await writeFile(join(projectRoot, "main.ts"), runnerScript);
        await writeCase(join(projectRoot, "test"), "sample-1", "ac\n", "3 7\n");
        await writeCase(join(projectRoot, "test"), "sample-2", "wa\n", "3 7\n");
        await writeCase(join(projectRoot, "test"), "sample-3", "re\n", "never\n");
        await writeCase(join(projectRoot, "test"), "sample-4", "free\n");
        return projectRoot;
    }

    function runnerConfig(options: {
        test?: Partial<Config["test"]>;
        language?: Partial<Config["languages"][string]>;
    }): Config {
        return createConfig({
            source: "main.ts",
            test: options.test,
            languages: {
                ts: {
                    source: "main.ts",
                    run: [process.execPath, "run", "main.ts"],
                    ...options.language,
                },
            },
        });
    }

    it("runs every case in name order and reports failures", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();
        const err = createCapture();

        const result = await runTests({
            projectRoot,
            config: runnerConfig({}),
            stdout: out.stream,
            stderr: err.stream,
        });

        expect(result.results.map((item) => [item.name, item.verdict])).toEqual([
            ["sample-1", "AC"],
            ["sample-2", "WA"],
            ["sample-3", "RE"],
            ["sample-4", "UNJUDGED"],
        ]);
        expect(result.exitCode).toBe(2);
        expect(out.text()).toContain("4 case(s): 1 passed, 2 failed, 1 unjudged");
        expect(out.text()).toContain("WA (line 1)");
        expect(out.text()).toContain("UNJUDGED (expected output missing)");
    });

    it("prints the peak memory of each case and the maximums in the summary", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();

        await runTests({
            projectRoot,
            config: runnerConfig({}),
            filters: ["sample-1"],
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        const text = out.text();
        expect(text).toMatch(/^✓ sample-1\s+[\d.]+ (?:ms|s)\s+(?:\d+|\?) MiB  AC$/mu);
        expect(text).toMatch(
            /\([\d.]+ (?:ms|s); slowest [\d.]+ (?:ms|s), peak (?:\d+|\?) MiB\)\./u,
        );
    });

    it("shows the input and the comparison as numbered tables for a wrong answer", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();

        await runTests({
            projectRoot,
            config: runnerConfig({}),
            filters: ["sample-2"],
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        const text = out.text();
        expect(text).toContain("Line │ Input");
        expect(text).toContain("   1 │ wa");
        expect(text).toContain("\n\n    Line │ Expected");
        expect(text).toContain("\n\n    Line │ Output");
        expect(text).toContain("   1 │ 3 7");
        expect(text).toContain("   1 │ 3 8");
    });

    it("shows the input for failing and unjudged cases", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();

        await runTests({
            projectRoot,
            config: runnerConfig({}),
            filters: ["sample-3", "sample-4"],
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        const text = out.text();
        expect(text.match(/Line │ Input/gu)).toHaveLength(2);
        expect(text).toContain("   1 │ re");
        expect(text).toContain("   1 │ free");
    });

    it("prints only the case line for a passing case unless verbose", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();

        await runTests({
            projectRoot,
            config: runnerConfig({}),
            filters: ["sample-1"],
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        expect(out.text()).not.toContain("Line │");
    });

    it("prints the input and output tables for a passing case when verbose", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();

        await runTests({
            projectRoot,
            config: runnerConfig({}),
            filters: ["sample-1"],
            verbose: true,
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        const text = out.text();
        expect(text).toContain("Line │ Input");
        expect(text).toContain("   1 │ ac");
        expect(text).toContain("\n\n    Line │ Output");
        expect(text).toContain("   1 │ 3 7");
    });

    it("hides the line-number gutter when line numbers are off", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();

        await runTests({
            projectRoot,
            config: runnerConfig({}),
            lineNumbers: false,
            filters: ["sample-2"],
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        const text = out.text();
        expect(text).not.toContain("Line │");
        expect(text).toContain("    Input\n    wa\n");
    });

    it("limits each block to display_lines rows", async () => {
        const projectRoot = await createProject();
        await writeFile(
            join(projectRoot, "main.ts"),
            `for (let index = 0; index < 5; index += 1) console.log("out-" + index);`,
        );
        await writeCase(join(projectRoot, "test"), "sample-1", "in\n");

        const out = createCapture();
        await runTests({
            projectRoot,
            config: runnerConfig({ test: { display_lines: 2 } }),
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        const text = out.text();
        expect(text).toContain("   1 │ out-0");
        expect(text).toContain("   2 │ out-1");
        expect(text).not.toContain("out-2");
        expect(text).toContain("… 3 more line(s)");
    });

    it("prints the program's standard error for every case by default", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();
        const err = createCapture();

        await runTests({
            projectRoot,
            config: runnerConfig({}),
            stdout: out.stream,
            stderr: err.stream,
        });

        const text = out.text();
        expect(text).toContain("  stderr:");
        expect(text).toContain("    ac-note");
        expect(text).toContain("    err-29");
        expect(text).not.toContain("more line(s)");
    });

    it("hides standard error when show_stderr is never", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();
        const err = createCapture();

        await runTests({
            projectRoot,
            config: runnerConfig({ test: { show_stderr: "never" } }),
            stdout: out.stream,
            stderr: err.stream,
        });

        expect(out.text()).not.toContain("stderr:");
        expect(out.text()).not.toContain("ac-note");
        expect(out.text()).not.toContain("err-0");
    });

    it("prints standard error only for cases that did not pass", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();
        const err = createCapture();

        await runTests({
            projectRoot,
            config: runnerConfig({ test: { show_stderr: "failure" } }),
            stdout: out.stream,
            stderr: err.stream,
        });

        expect(out.text()).not.toContain("ac-note");
        expect(out.text()).toContain("    err-0");
    });

    it("lets --show-stderr override the configuration", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();
        const err = createCapture();

        await runTests({
            projectRoot,
            config: runnerConfig({ test: { show_stderr: "always" } }),
            showStderr: "never",
            stdout: out.stream,
            stderr: err.stream,
        });

        expect(out.text()).not.toContain("stderr:");
    });

    it("leaves standard error uncolored even on a terminal", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture({ isTTY: true, columns: 120 });
        const err = createCapture();

        await runTests({
            projectRoot,
            config: runnerConfig({}),
            stdout: out.stream,
            stderr: err.stream,
        });

        const lines = out.text().split("\n");
        const note = lines.find((line) => line.includes("ac-note"));

        expect(note).toBe("      ac-note");
        if (process.env.NO_COLOR === undefined) {
            expect(out.text()).toContain("\u001B[");
        }
    });

    it("filters cases and exits with zero when they pass", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();
        const err = createCapture();

        const result = await runTests({
            projectRoot,
            config: runnerConfig({}),
            filters: ["sample-1"],
            stdout: out.stream,
            stderr: err.stream,
        });

        expect(result.results.map((item) => item.name)).toEqual(["sample-1"]);
        expect(result.exitCode).toBe(0);
        expect(out.text()).toContain("1 case(s): 1 passed, 0 failed, 0 unjudged");
    });

    it("runs the source an alias points at", async () => {
        const projectRoot = await createRunnerProject();
        const out = createCapture();
        const err = createCapture();

        const result = await runTests({
            projectRoot,
            config: { ...runnerConfig({}), alias: { fast: "main.ts" } },
            source: "fast",
            filters: ["sample-1"],
            stdout: out.stream,
            stderr: err.stream,
        });

        expect(result.results.map((item) => [item.name, item.verdict])).toEqual([
            ["sample-1", "AC"],
        ]);
        expect(result.exitCode).toBe(0);
    });

    it("stops a program that exceeds the time limit", async () => {
        testRoot = await mkdtemp(join(tmpdir(), "neoj-test-runner-"));
        const projectRoot = testRoot;
        await writeFile(join(projectRoot, "loop.ts"), "while (true) {}\n");
        await writeCase(join(projectRoot, "test"), "sample-1", "", "never\n");
        const out = createCapture();
        const err = createCapture();

        const result = await runTests({
            projectRoot,
            config: createConfig({
                source: "loop.ts",
                test: { timeout: 0.3 },
                languages: { ts: { source: "loop.ts", run: [process.execPath, "run", "loop.ts"] } },
            }),
            stdout: out.stream,
            stderr: err.stream,
        });

        expect(result.results[0]?.verdict).toBe("TLE");
        expect(result.exitCode).toBe(2);
    });

    it("reuses the cached build and recompiles after a source change", async () => {
        testRoot = await mkdtemp(join(tmpdir(), "neoj-test-runner-"));
        const projectRoot = testRoot;
        await writeFile(join(projectRoot, "main.ts"), runnerScript);
        await writeFile(
            join(projectRoot, "compile.ts"),
            'import { appendFileSync, writeFileSync } from "node:fs";\nappendFileSync("compile.log", "x");\nwriteFileSync(process.argv[2] ?? "", "");\n',
        );
        await writeCase(join(projectRoot, "test"), "sample-1", "ac\n", "3 7\n");

        const config = createConfig({
            source: "main.ts",
            test: { cache: true },
            languages: {
                ts: {
                    source: "main.ts",
                    compile: [process.execPath, "run", "compile.ts", "{outfile}"],
                    run: [process.execPath, "run", "main.ts"],
                },
            },
        });
        const out = createCapture();
        const err = createCapture();
        const run = () => runTests({ projectRoot, config, stdout: out.stream, stderr: err.stream });

        await run();
        expect(await readFile(join(projectRoot, "compile.log"), "utf8")).toBe("x");

        await run();
        expect(await readFile(join(projectRoot, "compile.log"), "utf8")).toBe("x");

        await writeFile(join(projectRoot, "main.ts"), `${runnerScript}// changed\n`);
        await run();
        expect(await readFile(join(projectRoot, "compile.log"), "utf8")).toBe("xx");
    });

    it("removes the build directory when caching is off", async () => {
        testRoot = await mkdtemp(join(tmpdir(), "neoj-test-runner-"));
        const projectRoot = testRoot;
        await writeFile(join(projectRoot, "main.ts"), runnerScript);
        await writeFile(
            join(projectRoot, "compile.ts"),
            'import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2] ?? "", "");\n',
        );
        await writeCase(join(projectRoot, "test"), "sample-1", "ac\n", "3 7\n");

        const out = createCapture();
        const err = createCapture();
        await runTests({
            projectRoot,
            config: createConfig({
                source: "main.ts",
                languages: {
                    ts: {
                        source: "main.ts",
                        compile: [process.execPath, "run", "compile.ts", "{outfile}"],
                        run: [process.execPath, "run", "main.ts"],
                    },
                },
            }),
            stdout: out.stream,
            stderr: err.stream,
        });

        expect(await readdir(join(projectRoot, ".neoj", "build"))).toEqual([]);
    });

    it("rejects a compile command that never writes {outfile}", async () => {
        testRoot = await mkdtemp(join(tmpdir(), "neoj-test-runner-"));
        const projectRoot = testRoot;
        await writeFile(join(projectRoot, "main.ts"), runnerScript);
        await writeCase(join(projectRoot, "test"), "sample-1", "ac\n", "3 7\n");
        const out = createCapture();
        const err = createCapture();

        await expect(
            runTests({
                projectRoot,
                config: createConfig({
                    source: "main.ts",
                    languages: {
                        ts: {
                            source: "main.ts",
                            compile: [process.execPath, "run", "main.ts"],
                            run: [process.execPath, "run", "main.ts"],
                        },
                    },
                }),
                stdout: out.stream,
                stderr: err.stream,
            }),
        ).rejects.toThrow("must reference {outfile} or {outdir}");
    });

    it("requires test.source or a positional source", async () => {
        testRoot = await mkdtemp(join(tmpdir(), "neoj-test-runner-"));
        const projectRoot = testRoot;
        await writeFile(join(projectRoot, "main.ts"), runnerScript);
        await writeCase(join(projectRoot, "test"), "sample-1", "ac\n", "3 7\n");
        const out = createCapture();
        const err = createCapture();

        await expect(
            runTests({
                projectRoot,
                config: createConfig({
                    source: undefined,
                    languages: {
                        ts: { source: "main.ts", run: [process.execPath, "run", "main.ts"] },
                    },
                }),
                stdout: out.stream,
                stderr: err.stream,
            }),
        ).rejects.toThrow("No source file to test");
    });

    it("judges floating-point output only when an exponent is given", async () => {
        testRoot = await mkdtemp(join(tmpdir(), "neoj-test-runner-"));
        const projectRoot = testRoot;
        await writeFile(
            join(projectRoot, "float.ts"),
            `const text = (await Bun.stdin.text()).trim();
console.log(text === "far" ? "0.000002" : "0.0000004");
`,
        );
        await writeCase(join(projectRoot, "test"), "close", "close\n", "0\n");
        await writeCase(join(projectRoot, "test"), "far", "far\n", "0\n");
        const config = createConfig({
            source: "float.ts",
            languages: {
                ts: { source: "float.ts", run: [process.execPath, "run", "float.ts"] },
            },
        });

        const out = createCapture();
        const tolerant = await runTests({
            projectRoot,
            config,
            errorExponent: 6,
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        expect(tolerant.results.map((item) => [item.name, item.verdict])).toEqual([
            ["close", "AC"],
            ["far", "WA"],
        ]);
        expect(out.text()).toContain("WA (line 1: 0 vs 0.000002)");

        const exact = await runTests({
            projectRoot,
            config,
            filters: ["close"],
            stdout: createCapture().stream,
            stderr: createCapture().stream,
        });
        expect(exact.results[0]?.verdict).toBe("WA");
    });
});

const interactiveSolutionScript = `const reader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();
let buffer = "";
async function readLine() {
    while (true) {
        const index = buffer.indexOf("\\n");
        if (index >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            return line;
        }
        const result = await reader.read();
        if (result.done) {
            return buffer === "" ? null : buffer;
        }
        buffer += decoder.decode(result.value, { stream: true });
    }
}
const line = await readLine();
if (line === "hang") {
    while (true) {}
}
if (line === "re") {
    process.exit(3);
}
if (line === "wa") {
    console.log("0");
    console.log("0");
} else {
    const parts = line.split(" ").map(Number);
    console.log(String(parts[0] + parts[1]));
    console.log(String(parts[0] * parts[1]));
}
`;

const interactiveInteractorScript = `import { readFileSync } from "node:fs";
const input = readFileSync(process.argv[2], "utf8").trim();
console.log(input);
if (input === "hang") {
    await new Promise(() => {});
}
const reader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();
let buffer = "";
async function readLine() {
    while (true) {
        const index = buffer.indexOf("\\n");
        if (index >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            return line;
        }
        const result = await reader.read();
        if (result.done) {
            return buffer === "" ? null : buffer;
        }
        buffer += decoder.decode(result.value, { stream: true });
    }
}
const first = await readLine();
const second = await readLine();
const parts = input.split(" ").map(Number);
const expected =
    input === "wa"
        ? ["1", "1"]
        : [String(parts[0] + parts[1]), String(parts[0] * parts[1])];
if (first === expected[0] && second === expected[1]) {
    process.exit(0);
}
console.error("wrong answer: expected " + expected.join(" ") + ", got " + first + " " + second);
process.exit(1);
`;

describe("interactive judging", () => {
    async function createInteractiveProject(cases?: Record<string, string>): Promise<string> {
        const projectRoot = await createProject();
        await mkdir(join(projectRoot, "src"), { recursive: true });
        await writeFile(join(projectRoot, "src", "main.ts"), interactiveSolutionScript);
        await writeFile(join(projectRoot, "src", "interactor.ts"), interactiveInteractorScript);
        for (const [name, input] of Object.entries(cases ?? { "sample-1": "1 2" })) {
            await writeCase(join(projectRoot, "test"), name, `${input}\n`);
        }
        return projectRoot;
    }

    function interactiveConfig(
        options: {
            timeout?: number;
            interactor?: Partial<NonNullable<Config["test"]["interactor"]>>;
        } = {},
    ): Config {
        return createConfig({
            source: "src/main.ts",
            languages: {
                ts: { source: "src/*.ts", run: [process.execPath, "run", "{source}"] },
            },
            test: {
                timeout: 2,
                interactor: {
                    source: "src/interactor.ts",
                    run: [process.execPath, "run", "{source}", "{infile}"],
                    timeout: options.timeout ?? 2,
                    ...options.interactor,
                },
            },
        });
    }

    it("discovers *.in files, ignores *.out, and falls back to one session", async () => {
        const projectRoot = await createProject();
        await writeCase(join(projectRoot, "test"), "sample-1", "1 2\n", "wrong\n");
        await writeCase(join(projectRoot, "test"), "sample-2", "3 4\n", "wrong\n");

        const cases = await discoverInteractiveTestCases(join(projectRoot, "test"), []);
        expect(cases.map((item) => [item.name, item.expectedOutputPath])).toEqual([
            ["sample-1", undefined],
            ["sample-2", undefined],
        ]);

        await rm(join(projectRoot, "test"), { recursive: true, force: true });
        await mkdir(join(projectRoot, "test"), { recursive: true });
        expect(await discoverInteractiveTestCases(join(projectRoot, "test"), [])).toEqual([
            { name: "interactive", inputPath: "", expectedOutputPath: undefined },
        ]);
        await expect(
            discoverInteractiveTestCases(join(projectRoot, "test"), ["x"]),
        ).rejects.toThrow('The directory has no "*.in" files.');
    });

    it("prefers the solution's failures over the interactor's verdict", () => {
        const base = {
            solution: {
                exitCode: 0,
                signal: null,
                timedOut: false,
                outputLimitExceeded: false,
                maxRssBytes: 1024,
            },
            interactor: { exitCode: 0, signal: null, outputLimitExceeded: false },
            sessionTimedOut: false,
            memoryMiB: 1024,
            interactorStderr: "",
        };

        expect(judgeInteractiveResult(base).verdict).toBe("AC");
        expect(
            judgeInteractiveResult({ ...base, interactor: { ...base.interactor, exitCode: 1 } }),
        ).toEqual({
            verdict: "WA",
            detail: "interactor exited with code 1",
            comparison: undefined,
        });
        expect(
            judgeInteractiveResult({
                ...base,
                interactor: { ...base.interactor, exitCode: 1 },
                interactorStderr: "\nwrong answer: 3 != 7\n",
            }).detail,
        ).toBe("wrong answer: 3 != 7");
        expect(
            judgeInteractiveResult({
                ...base,
                solution: { ...base.solution, exitCode: 3 },
                interactor: { ...base.interactor, exitCode: 0 },
            }).verdict,
        ).toBe("RE");
        expect(
            judgeInteractiveResult({
                ...base,
                solution: { ...base.solution, timedOut: true },
            }).verdict,
        ).toBe("TLE");
        expect(judgeInteractiveResult({ ...base, sessionTimedOut: true }).verdict).toBe("TLE");
        expect(
            judgeInteractiveResult({
                ...base,
                solution: { ...base.solution, maxRssBytes: 2 * 1024 * 1024 },
                memoryMiB: 1,
            }).verdict,
        ).toBe("MLE");
        expect(
            judgeInteractiveResult({
                ...base,
                interactor: { ...base.interactor, signal: "SIGSEGV" },
                interactorStderr: "",
            }),
        ).toEqual({
            verdict: "RE",
            detail: "interactor killed by SIGSEGV",
            comparison: undefined,
        });
    });

    it("judges with an interactor and shows the transcript for a failure", async () => {
        const projectRoot = await createInteractiveProject({ "sample-1": "1 2", "sample-2": "wa" });
        const out = createCapture();
        const err = createCapture();

        const result = await runTests({
            projectRoot,
            config: interactiveConfig(),
            interactive: true,
            stdout: out.stream,
            stderr: err.stream,
        });

        expect(result.results.map((item) => [item.name, item.verdict])).toEqual([
            ["sample-1", "AC"],
            ["sample-2", "WA"],
        ]);
        expect(result.exitCode).toBe(2);
        const text = out.text();
        expect(text).toContain("WA (wrong answer: expected 1 1, got 0 0)");
        expect(text).toContain("interactive:");
        expect(text).toContain("J> wa");
        expect(text).toContain("S> 0");
        expect(text).toContain("interactor stderr:");
        expect(text).not.toContain("J> 1 2");
    });

    it("shows the transcript of a passing case only with verbose", async () => {
        const projectRoot = await createInteractiveProject({ "sample-1": "1 2" });
        const out = createCapture();

        await runTests({
            projectRoot,
            config: interactiveConfig(),
            interactive: true,
            filters: ["sample-1"],
            verbose: true,
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        const text = out.text();
        expect(text).toContain("J> 1 2");
        expect(text).toContain("S> 3");
        expect(text).toContain("S> 2");
    });

    it("stops a session that exceeds the interactor timeout", async () => {
        const projectRoot = await createInteractiveProject({ "sample-1": "hang" });
        const out = createCapture();

        const result = await runTests({
            projectRoot,
            config: interactiveConfig({ timeout: 0.4, interactor: { timeout: 0.4 } }),
            interactive: true,
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        expect(result.results[0]?.verdict).toBe("TLE");
        expect(result.exitCode).toBe(2);
        expect(out.text()).toContain("TLE (interactive session > 0.4 s)");
    });

    it("requires [test.interactor] when --interactive is passed", async () => {
        const projectRoot = await createInteractiveProject();

        await expect(
            runTests({
                projectRoot,
                config: createConfig({
                    source: "src/main.ts",
                    languages: {
                        ts: { source: "src/*.ts", run: [process.execPath, "run", "{source}"] },
                    },
                }),
                interactive: true,
                stdout: createCapture().stream,
                stderr: createCapture().stream,
            }),
        ).rejects.toThrow("Interactive mode needs [test.interactor]");
    });

    it("runs one session when the directory has no *.in", async () => {
        const projectRoot = await createProject();
        await mkdir(join(projectRoot, "src"), { recursive: true });
        await writeFile(join(projectRoot, "src", "main.ts"), "console.log('hi');\n");
        await writeFile(
            join(projectRoot, "src", "interactor.ts"),
            "console.log('go');\nawait Bun.stdin.text().catch(() => {});\n",
        );
        await mkdir(join(projectRoot, "test"), { recursive: true });
        const out = createCapture();

        const result = await runTests({
            projectRoot,
            config: interactiveConfig({
                interactor: { run: [process.execPath, "run", "{source}"] },
            }),
            interactive: true,
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        expect(result.results.map((item) => [item.name, item.verdict])).toEqual([
            ["interactive", "AC"],
        ]);
        expect(out.text()).toContain("1 case(s): 1 passed");
    });

    it("keeps draining when the solution exits before the interactor writes", async () => {
        const projectRoot = await createProject();
        await mkdir(join(projectRoot, "src"), { recursive: true });
        await writeFile(join(projectRoot, "src", "main.ts"), "process.exit(0);\n");
        // The delay guarantees the solution is gone before the first prompt, so
        // the relay writes into a closed pipe. That used to escape as an
        // unhandled EPIPE rejection and fail the whole test run on Windows.
        await writeFile(
            join(projectRoot, "src", "interactor.ts"),
            'await Bun.sleep(100);\nconsole.log("go");\nawait Bun.stdin.text().catch(() => {});\n',
        );
        await writeCase(join(projectRoot, "test"), "sample-1", "1 2\n");
        const out = createCapture();

        const result = await runTests({
            projectRoot,
            config: interactiveConfig(),
            interactive: true,
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        expect(result.results.map((item) => [item.name, item.verdict])).toEqual([
            ["sample-1", "AC"],
        ]);
        expect(result.exitCode).toBe(0);
    });

    it("rejects {infile} when the case has no input file", async () => {
        const projectRoot = await createProject();
        await mkdir(join(projectRoot, "src"), { recursive: true });
        await writeFile(join(projectRoot, "src", "main.ts"), "console.log('hi');\n");
        await writeFile(
            join(projectRoot, "src", "interactor.ts"),
            "await Bun.stdin.text().catch(() => {});\n",
        );
        await mkdir(join(projectRoot, "test"), { recursive: true });

        await expect(
            runTests({
                projectRoot,
                config: interactiveConfig(),
                interactive: true,
                stdout: createCapture().stream,
                stderr: createCapture().stream,
            }),
        ).rejects.toThrow("test.interactor.run uses {infile}");
    });
});

const judgeSolutionScript = `const parts = (await Bun.stdin.text()).trim().split(/\\s+/);
if (parts[0] === "4") {
    console.log("4 4");
} else if (parts[0] === "re") {
    process.exit(3);
} else {
    console.log(parts.slice().reverse().join(" "));
}
console.error("solution-note");
`;

const judgeCheckerScript = `import { readFileSync } from "node:fs";
const expected = readFileSync(process.argv[2], "utf8")
    .trim()
    .split(/\\s+/)
    .map(Number)
    .sort((left, right) => left - right);
const actual = (await Bun.stdin.text())
    .trim()
    .split(/\\s+/)
    .filter((token) => token !== "")
    .map(Number)
    .sort((left, right) => left - right);
if (actual.length !== expected.length) {
    console.error("wrong count");
    process.exit(1);
}
if (actual.some((value, index) => value !== expected[index])) {
    console.error("wrong values");
    process.exit(1);
}
process.exit(0);
`;

const judgeOutputOnlyCheckerScript = `const text = await Bun.stdin.text();
if (text.trim() === "") {
    console.error("empty output");
    process.exit(1);
}
process.exit(0);
`;

describe("checker judging", () => {
    async function createJudgeProject(): Promise<string> {
        const projectRoot = await createProject();
        await mkdir(join(projectRoot, "src"), { recursive: true });
        await writeFile(join(projectRoot, "src", "main.ts"), judgeSolutionScript);
        await writeFile(join(projectRoot, "src", "checker.ts"), judgeCheckerScript);
        await writeFile(
            join(projectRoot, "src", "output-checker.ts"),
            judgeOutputOnlyCheckerScript,
        );
        await writeCase(join(projectRoot, "test"), "sample-1", "1 2 3\n", "9 9 9\n");
        await writeCase(join(projectRoot, "test"), "sample-2", "4 5\n", "4 4\n");
        await writeCase(join(projectRoot, "test"), "sample-3", "re\n");
        return projectRoot;
    }

    function judgeConfig(
        options: {
            timeout?: number;
            judge?: Partial<NonNullable<Config["test"]["judge"]>>;
        } = {},
    ): Config {
        return createConfig({
            source: "src/main.ts",
            languages: {
                ts: { source: "src/*.ts", run: [process.execPath, "run", "{source}"] },
            },
            test: {
                timeout: 2,
                judge: {
                    source: "src/checker.ts",
                    run: [process.execPath, "run", "{source}", "{infile}"],
                    timeout: options.timeout ?? 2,
                    ...options.judge,
                },
            },
        });
    }

    it("discovers *.in files, ignores *.out, and requires an input", async () => {
        const projectRoot = await createProject();
        await writeCase(join(projectRoot, "test"), "sample-1", "1 2\n", "wrong\n");

        const cases = await discoverJudgeTestCases(join(projectRoot, "test"), []);
        expect(cases).toEqual([
            {
                name: "sample-1",
                inputPath: join(projectRoot, "test", "sample-1.in"),
                expectedOutputPath: undefined,
            },
        ]);

        await rm(join(projectRoot, "test"), { recursive: true, force: true });
        await mkdir(join(projectRoot, "test"), { recursive: true });
        await expect(discoverJudgeTestCases(join(projectRoot, "test"), [])).rejects.toThrow(
            "--judge needs at least one input file",
        );
    });

    it("prefers the solution's failures over the checker's verdict", () => {
        const base = {
            solution: {
                exitCode: 0,
                signal: null,
                timedOut: false,
                outputLimitExceeded: false,
                maxRssBytes: 1024,
            },
            judge: {
                exitCode: 0,
                signal: null,
                timedOut: false,
                outputLimitExceeded: false,
            },
            memoryMiB: 1024,
            judgeStderr: "",
        };

        expect(judgeCheckerResult(base).verdict).toBe("AC");
        expect(judgeCheckerResult({ ...base, judge: { ...base.judge, exitCode: 1 } })).toEqual({
            verdict: "WA",
            detail: "judge exited with code 1",
            comparison: undefined,
        });
        expect(
            judgeCheckerResult({
                ...base,
                judge: { ...base.judge, exitCode: 1 },
                judgeStderr: "\nwrong values\n",
            }).detail,
        ).toBe("wrong values");
        expect(
            judgeCheckerResult({
                ...base,
                solution: { ...base.solution, exitCode: 3 },
            }).verdict,
        ).toBe("RE");
        expect(
            judgeCheckerResult({
                ...base,
                solution: { ...base.solution, timedOut: true },
            }).verdict,
        ).toBe("TLE");
        expect(
            judgeCheckerResult({
                ...base,
                solution: { ...base.solution, maxRssBytes: 2 * 1024 * 1024 },
                memoryMiB: 1,
            }).verdict,
        ).toBe("MLE");
        expect(
            judgeCheckerResult({ ...base, judge: { ...base.judge, timedOut: true } }).verdict,
        ).toBe("TLE");
        expect(
            judgeCheckerResult({ ...base, judge: { ...base.judge, signal: "SIGSEGV" } }),
        ).toEqual({
            verdict: "RE",
            detail: "judge killed by SIGSEGV",
            comparison: undefined,
        });
        expect(
            judgeCheckerResult({
                ...base,
                judge: { ...base.judge, outputLimitExceeded: true },
            }),
        ).toEqual({
            verdict: "RE",
            detail: "judge output limit exceeded",
            comparison: undefined,
        });
    });

    it("accepts any valid answer and ignores *.out", async () => {
        const projectRoot = await createJudgeProject();
        const out = createCapture();

        const result = await runTests({
            projectRoot,
            config: judgeConfig(),
            judge: true,
            filters: ["sample-1", "sample-2"],
            showStderr: "never",
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        expect(result.results.map((item) => [item.name, item.verdict])).toEqual([
            ["sample-1", "AC"],
            ["sample-2", "WA"],
        ]);
        expect(result.exitCode).toBe(2);
        const text = out.text();
        expect(text).toContain("WA (wrong values)");
        expect(text).toContain("judge stderr:");
        expect(text).toContain("wrong values");
        expect(text).toContain("Line │ Input");
        expect(text).toContain("Line │ Output");
        expect(text).not.toContain("Expected");
        expect(text).not.toContain("solution-note");
    });

    it("shows the output and checker stderr for a passing case when verbose", async () => {
        const projectRoot = await createJudgeProject();
        const out = createCapture();

        await runTests({
            projectRoot,
            config: judgeConfig(),
            judge: true,
            filters: ["sample-1"],
            verbose: true,
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        const text = out.text();
        expect(text).toContain("Line │ Output");
        expect(text).toContain("3 2 1");
        expect(text).not.toContain("judge stderr:");
        expect(text).toContain("solution-note");
    });

    it("lets the checker run without {infile}", async () => {
        const projectRoot = await createJudgeProject();
        const out = createCapture();

        const result = await runTests({
            projectRoot,
            config: judgeConfig({
                judge: {
                    source: "src/output-checker.ts",
                    run: [process.execPath, "run", "{source}"],
                },
            }),
            judge: true,
            filters: ["sample-1"],
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        expect(result.results[0]?.verdict).toBe("AC");
        expect(result.exitCode).toBe(0);
    });

    it("stops a checker that exceeds test.judge.timeout", async () => {
        const projectRoot = await createJudgeProject();
        await writeFile(
            join(projectRoot, "src", "checker.ts"),
            "await Bun.stdin.text();\nawait new Promise(() => {});\n",
        );
        const out = createCapture();

        const result = await runTests({
            projectRoot,
            config: judgeConfig({ timeout: 0.4 }),
            judge: true,
            filters: ["sample-1"],
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        expect(result.results[0]?.verdict).toBe("TLE");
        expect(out.text()).toContain("TLE (judge timeout > 0.4 s)");
    });

    it("does not run the checker when the solution fails", async () => {
        const projectRoot = await createJudgeProject();
        const out = createCapture();

        const result = await runTests({
            projectRoot,
            config: judgeConfig(),
            judge: true,
            filters: ["sample-3"],
            stdout: out.stream,
            stderr: createCapture().stream,
        });

        expect(result.results[0]?.verdict).toBe("RE");
        expect(out.text()).not.toContain("judge stderr:");
    });

    it("requires [test.judge] when --judge is passed", async () => {
        const projectRoot = await createJudgeProject();

        await expect(
            runTests({
                projectRoot,
                config: createConfig({
                    source: "src/main.ts",
                    languages: {
                        ts: { source: "src/*.ts", run: [process.execPath, "run", "{source}"] },
                    },
                }),
                judge: true,
                stdout: createCapture().stream,
                stderr: createCapture().stream,
            }),
        ).rejects.toThrow("Judge mode needs [test.judge]");
    });

    it("rejects --judge together with --interactive", async () => {
        const projectRoot = await createJudgeProject();

        await expect(
            runTests({
                projectRoot,
                config: judgeConfig(),
                interactive: true,
                judge: true,
                stdout: createCapture().stream,
                stderr: createCapture().stream,
            }),
        ).rejects.toThrow("--interactive and --judge cannot be used together.");
    });
});
