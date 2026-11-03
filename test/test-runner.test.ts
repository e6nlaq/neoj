import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "@/lib/util/config";
import {
    collectCacheFiles,
    computeBuildKey,
    detectLanguage,
    discoverTestCases,
    expandTokens,
    judgeCommandResult,
    naturalCompare,
    readLanguages,
    resolveSourceFile,
    runTests,
    type TestLanguage,
} from "@/lib/util/test-runner";

const strict = { ignoreTrailingSpace: false, ignoreTrailingNewline: false };

let testRoot: string | undefined;

afterEach(async () => {
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
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
}): Config {
    return {
        src: undefined,
        login: { open_browser: true },
        testcase: { folder: "test", filename: "sample-{}", ...options.testcase },
        test: {
            source: options.source,
            timeout: 10,
            memory: 1024,
            parallel: true,
            cache: false,
            ignore_trailing_space: false,
            ignore_trailing_newline: false,
            show_stderr: "always",
            ...options.test,
        },
        languages: options.languages ?? {},
        download: { show_sample: false },
        stash: { auto_stash: false, auto_apply: false, force: true },
        template: { enable: false, mode: "overlay" },
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

        expect(resolved.relativePath).toBe("main.cpp");
        expect(resolved.absolutePath.endsWith("main.cpp")).toBe(true);
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

        expect(note).toBe("    ac-note");
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
});
