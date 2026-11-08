import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    describeSubmissionSize,
    formatSubmitPreview,
    getOfflineSubmitWarnings,
    prepareSubmissionSource,
    resolveSubmitLanguage,
    runSubmit,
    splitSourceLines,
    waitBeforeSubmit,
    type SubmissionTarget,
} from "@/feature/submit";
import type { Config } from "@/lib/util/config";
import type { ProblemMetadata } from "@/lib/util/problem-metadata";
import type { TestLanguage } from "@/lib/util/test-runner";

const originalCwd = process.cwd();
let testRoot: string | undefined;

afterEach(async () => {
    process.chdir(originalCwd);
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true, maxRetries: 3 });
        testRoot = undefined;
    }
});

function createCapture(): {
    stream: { write(chunk: string): boolean; isTTY?: boolean };
    text(): string;
} {
    let text = "";
    return {
        stream: {
            write(chunk: string) {
                text += chunk;
                return true;
            },
        },
        text: () => text,
    };
}

function createLanguage(overrides: Partial<TestLanguage> = {}): TestLanguage {
    return {
        key: "cpp",
        sourcePatterns: ["src/*.cpp"],
        compile: undefined,
        run: ["{outfile}"],
        timeoutSeconds: undefined,
        memoryMiB: undefined,
        cacheFiles: [],
        presubmit: undefined,
        submit: {},
        ...overrides,
    };
}

function createConfig(overrides: Partial<Config["submit"]> = {}): Config {
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
            ...overrides,
        },
        testcase: { folder: "test", filename: "sample-{}" },
        handmade: { filename: "handmade-{}" },
        run: { silent: false },
        test: {
            source: "src/main.cpp",
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
        languages: {
            cpp: {
                source: "src/*.cpp",
                run: ["{outfile}"],
            },
        },
        download: { show_sample: false },
        stash: { auto_stash: false, auto_apply: false, force: true },
        template: { enable: false, mode: "overlay" },
    };
}

function setSubmitLanguage(config: Config, languageId = "5001"): Config {
    const cpp = config.languages.cpp;
    if (cpp === undefined) {
        throw new Error("test setup is missing the cpp language");
    }

    cpp.submit = { atcoder: languageId };
    return config;
}

async function createProject(
    options: {
        problemUrl?: string;
        contestrange?: { start: string; end: string };
    } = {},
): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-submit-test-"));
    await Bun.write(join(testRoot, "neoj.toml"), "");
    await mkdir(join(testRoot, "src"), { recursive: true });
    await Bun.write(join(testRoot, "src", "main.cpp"), "int main() { return 0; }\n");
    if (options.problemUrl !== undefined) {
        await mkdir(join(testRoot, ".neoj"), { recursive: true });
        await Bun.write(
            join(testRoot, ".neoj", "problem.json"),
            `${JSON.stringify({
                url: options.problemUrl,
                ...(options.contestrange === undefined
                    ? {}
                    : { contestrange: options.contestrange }),
            })}\n`,
        );
    }

    return testRoot;
}

function createFakeTarget(
    options: {
        languages?: { id: string; name: string; group?: string; version?: string }[];
        submit?: (
            source: string,
            languageId: string,
        ) => Promise<{
            submissionId: string | undefined;
            submissionUrl: string;
        }>;
        warnings?: string[];
    } = {},
): SubmissionTarget & {
    submitted: { source: string; languageId: string }[];
    prepared: number;
} {
    const submitted: { source: string; languageId: string }[] = [];
    let prepared = 0;
    return {
        platform: "atcoder",
        displayName: "AtCoder",
        submitted,
        get prepared() {
            return prepared;
        },
        async prepare() {
            prepared += 1;
            return options.warnings ?? [];
        },
        async getLanguages() {
            return (
                options.languages ?? [
                    { id: "5001", name: "C++ 20", group: "C++" },
                    { id: "5002", name: "Python", version: "3.11" },
                ]
            );
        },
        async submit(source, languageId) {
            submitted.push({ source, languageId });
            if (options.submit !== undefined) {
                return await options.submit(source, languageId);
            }
            return {
                submissionId: "123456",
                submissionUrl: "https://atcoder.jp/contests/abc300/submissions/123456",
            };
        },
    };
}

describe("splitSourceLines and preview", () => {
    it("normalizes CRLF and ignores a final newline", () => {
        expect(splitSourceLines("a\r\nb\r\n")).toEqual(["a", "b"]);
        expect(splitSourceLines("a\rb")).toEqual(["a", "b"]);
        expect(splitSourceLines("")).toEqual([]);
    });

    it("shows the whole text when it fits in two blocks", () => {
        const text = ["1", "2", "3", "4"].join("\n");
        expect(formatSubmitPreview(text, 2)).toEqual(["1 | 1", "2 | 2", "3 | 3", "4 | 4"]);
    });

    it("shows the head and tail with real line numbers and an ellipsis", () => {
        const lines = Array.from({ length: 11 }, (_, index) => `L${index + 1}`);
        const preview = formatSubmitPreview(lines.join("\n"), 2);

        expect(preview).toEqual([" 1 | L1", " 2 | L2", "...", "10 | L10", "11 | L11"]);
    });

    it("describes the line count and byte size", () => {
        expect(describeSubmissionSize("a\nb\n")).toBe("2 line(s), 4 B");
        expect(describeSubmissionSize("")).toBe("0 line(s), 0 B");
    });
});

describe("waitBeforeSubmit", () => {
    it("writes one plain line when standard error is not a terminal", async () => {
        const capture = createCapture();
        const delays: number[] = [];

        await waitBeforeSubmit(2.5, {
            stream: capture.stream,
            sleep: async (milliseconds) => {
                delays.push(milliseconds);
            },
        });

        expect(capture.text()).toBe("Waiting 2.5 seconds before submitting...\n");
        expect(delays).toEqual([]);
    });

    it("draws a countdown bar on a terminal", async () => {
        const capture = createCapture();
        capture.stream.isTTY = true;
        const delays: number[] = [];

        await waitBeforeSubmit(0.3, {
            stream: capture.stream,
            intervalMs: 100,
            sleep: async (milliseconds) => {
                delays.push(milliseconds);
            },
        });

        expect(delays).toEqual([100, 100, 100]);
        expect(capture.text()).toContain("Submitting in 0.3s [");
        expect(capture.text()).toContain("Submitting in 0.2s [");
        expect(capture.text()).toContain("Submitting in 0.1s [");
        expect(capture.text().endsWith("\r\u001B[K")).toBe(true);
    });

    it("does nothing for zero seconds", async () => {
        const capture = createCapture();
        await waitBeforeSubmit(0, { stream: capture.stream });
        expect(capture.text()).toBe("");
    });
});

describe("resolveSubmitLanguage", () => {
    const language = createLanguage({ submit: { atcoder: "5001" } });

    it("prefers the explicit platform language", async () => {
        await expect(
            resolveSubmitLanguage(language, "atcoder", "6001", async () => {
                throw new Error("should not fetch");
            }),
        ).resolves.toBe("6001");
    });

    it("uses the configured platform language", async () => {
        await expect(
            resolveSubmitLanguage(language, "atcoder", undefined, async () => {
                throw new Error("should not fetch");
            }),
        ).resolves.toBe("5001");
    });

    it("lists the candidates when no language is configured", async () => {
        await expect(
            resolveSubmitLanguage(createLanguage(), "atcoder", undefined, async () => [
                { id: "5001", name: "C++ 20", group: "C++" },
                { id: "5002", name: "Python", version: "3.11" },
            ]),
        ).rejects.toThrow(
            "languages.cpp.submit.atcoder is not set. Set it to one of:\n  - 5001: C++ 20 (C++)\n  - 5002: Python (3.11)",
        );
    });
});

describe("prepareSubmissionSource", () => {
    it("reads the source file when no presubmit command is configured", async () => {
        const root = await createProject();
        const sourcePath = join(root, "src", "main.cpp");

        await expect(
            prepareSubmissionSource({
                projectRoot: root,
                source: { absolutePath: sourcePath, relativePath: "src/main.cpp" },
                language: createLanguage(),
                timeoutSeconds: 5,
                platform: "atcoder",
                problemUrl: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
            }),
        ).resolves.toBe("int main() { return 0; }\n");
    });

    it("runs the presubmit command with the documented environment", async () => {
        const root = await createProject();
        const sourcePath = join(root, "src", "main.cpp");
        const script = join(root, "presubmit.mjs");
        await Bun.write(
            script,
            [
                'import { readFileSync, writeFileSync } from "node:fs";',
                'const source = readFileSync(process.argv[2], "utf8");',
                "writeFileSync(",
                "  process.argv[3],",
                '  `${process.env.NEOJ_PLATFORM}/${process.env.NEOJ_LANGUAGE}/${process.env.NEOJ_PROBLEM_URL}\\n${process.argv[3].endsWith(".cpp") ? "cpp" : "other"}\\n${source}`,',
                ");",
            ].join("\n"),
        );

        const content = await prepareSubmissionSource({
            projectRoot: root,
            source: { absolutePath: sourcePath, relativePath: "src/main.cpp" },
            language: createLanguage({
                presubmit: [process.execPath, script, "{source}", "{outfile}"],
            }),
            timeoutSeconds: 5,
            platform: "atcoder",
            problemUrl: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
        });

        expect(content).toContain("atcoder/cpp/https://atcoder.jp/contests/abc300/tasks/abc300_a");
        expect(content).toContain("\ncpp\n");
        expect(content).toContain("int main() { return 0; }");
        await expect(readFile(sourcePath, "utf8")).resolves.toBe("int main() { return 0; }\n");
    });

    it("uses standard output when the command does not write {outfile}", async () => {
        const root = await createProject();
        const sourcePath = join(root, "src", "main.cpp");
        const script = join(root, "presubmit.mjs");
        await Bun.write(script, 'process.stdout.write("from stdout\\n");');

        await expect(
            prepareSubmissionSource({
                projectRoot: root,
                source: { absolutePath: sourcePath, relativePath: "src/main.cpp" },
                language: createLanguage({
                    presubmit: [process.execPath, script],
                }),
                timeoutSeconds: 5,
                platform: "yukicoder",
                problemUrl: "https://yukicoder.me/problems/no/480",
            }),
        ).resolves.toBe("from stdout\n");
    });

    it("reports the command's standard error when it fails", async () => {
        const root = await createProject();
        const script = join(root, "presubmit.mjs");
        await Bun.write(script, 'process.stderr.write("compile error\\n"); process.exit(3);');

        await expect(
            prepareSubmissionSource({
                projectRoot: root,
                source: {
                    absolutePath: join(root, "src", "main.cpp"),
                    relativePath: "src/main.cpp",
                },
                language: createLanguage({
                    presubmit: [process.execPath, script],
                }),
                timeoutSeconds: 5,
                platform: "atcoder",
                problemUrl: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
            }),
        ).rejects.toThrow("The presubmit command failed (exit code 3).\ncompile error");
    });

    it("rejects an empty result", async () => {
        const root = await createProject();
        const script = join(root, "presubmit.mjs");
        await Bun.write(script, "");

        await expect(
            prepareSubmissionSource({
                projectRoot: root,
                source: {
                    absolutePath: join(root, "src", "main.cpp"),
                    relativePath: "src/main.cpp",
                },
                language: createLanguage({
                    presubmit: [process.execPath, script],
                }),
                timeoutSeconds: 5,
                platform: "atcoder",
                problemUrl: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
            }),
        ).rejects.toThrow("The presubmit command produced no output.");
    });
});

describe("getOfflineSubmitWarnings", () => {
    const atCoderUrl = "https://atcoder.jp/contests/abc300/tasks/abc300_a";

    it("warns about AtCoder Daily Training", () => {
        const metadata: ProblemMetadata = {
            url: "https://atcoder.jp/contests/adt_easy_20250101_1/tasks/adt_easy_20250101_1_a",
        };

        expect(
            getOfflineSubmitWarnings({
                platform: "atcoder",
                problemUrl: metadata.url,
                metadata,
            }),
        ).toHaveLength(1);
    });

    it("warns outside the recorded contest window", () => {
        const metadata: ProblemMetadata = {
            url: atCoderUrl,
            contestrange: {
                start: "2026-01-01T00:00:00Z",
                end: "2026-01-02T00:00:00Z",
            },
        };

        const warnings = getOfflineSubmitWarnings({
            platform: "atcoder",
            problemUrl: atCoderUrl,
            metadata,
            now: Temporal.Instant.from("2026-02-01T00:00:00Z"),
        });

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("contest window");
    });

    it("does not warn inside the contest window or for yukicoder", () => {
        const metadata: ProblemMetadata = {
            url: atCoderUrl,
            contestrange: {
                start: "2026-01-01T00:00:00Z",
                end: "2026-01-02T00:00:00Z",
            },
        };

        expect(
            getOfflineSubmitWarnings({
                platform: "atcoder",
                problemUrl: atCoderUrl,
                metadata,
                now: Temporal.Instant.from("2026-01-01T12:00:00Z"),
            }),
        ).toEqual([]);
        expect(
            getOfflineSubmitWarnings({
                platform: "yukicoder",
                problemUrl: "https://yukicoder.me/problems/no/480",
                metadata: { url: "https://yukicoder.me/problems/no/480" },
            }),
        ).toEqual([]);
    });
});

describe("runSubmit", () => {
    const problemUrl = "https://atcoder.jp/contests/abc300/tasks/abc300_a";

    it("shows the preview and stops without contacting the platform in dry-run mode", async () => {
        const root = await createProject({ problemUrl });
        const stdout = createCapture();
        const stderr = createCapture();
        const warnings: string[] = [];
        let targetCreated = false;

        const result = await runSubmit({
            projectRoot: root,
            config: createConfig(),
            cwd: root,
            dryRun: true,
            waitSeconds: 30,
            yes: true,
            stdout: stdout.stream,
            stderr: stderr.stream,
            dependencies: {
                createTarget: async () => {
                    targetCreated = true;
                    return createFakeTarget();
                },
                warn: (message) => warnings.push(message),
            },
        });

        expect(result).toEqual({ status: "dry-run" });
        expect(targetCreated).toBe(false);
        expect(stderr.text()).toBe("");
        expect(stdout.text()).toContain("Submitting src/main.cpp (languages.cpp, AtCoder)");
        expect(stdout.text()).toContain("1 | int main() { return 0; }");
    });

    it("rejects --platform-language together with --dry-run", async () => {
        const root = await createProject({ problemUrl });

        await expect(
            runSubmit({
                projectRoot: root,
                config: createConfig(),
                cwd: root,
                dryRun: true,
                platformLanguage: "5001",
            }),
        ).rejects.toThrow("--dry-run cannot be combined with --platform-language.");
    });

    it("submits after confirmation and opens the submission URL", async () => {
        const root = await createProject({ problemUrl });
        const stdout = createCapture();
        const target = createFakeTarget();
        const opened: string[] = [];
        const infos: string[] = [];
        const config = createConfig({ wait: 0 });
        setSubmitLanguage(config);

        const result = await runSubmit({
            projectRoot: root,
            config,
            cwd: root,
            waitSeconds: 0,
            stdout: stdout.stream,
            stderr: createCapture().stream,
            dependencies: {
                createTarget: async () => target,
                confirm: async () => true,
                openInBrowser: async (url) => {
                    opened.push(url);
                    return true;
                },
                info: (message) => infos.push(message),
            },
        });

        expect(result.status).toBe("submitted");
        expect(result.submissionId).toBe("123456");
        expect(target.submitted).toEqual([
            { source: "int main() { return 0; }\n", languageId: "5001" },
        ]);
        expect(opened).toEqual(["https://atcoder.jp/contests/abc300/submissions/123456"]);
        expect(infos).toContain("Submitted to AtCoder (ID: 123456).");
        expect(stdout.text()).toContain("https://atcoder.jp/contests/abc300/submissions/123456");
    });

    it("returns cancelled without submitting when the confirmation is declined", async () => {
        const root = await createProject({ problemUrl });
        const target = createFakeTarget();
        const infos: string[] = [];

        const result = await runSubmit({
            projectRoot: root,
            config: createConfig(),
            cwd: root,
            waitSeconds: 0,
            stdout: createCapture().stream,
            stderr: createCapture().stream,
            dependencies: {
                createTarget: async () => target,
                confirm: async () => false,
                info: (message) => infos.push(message),
            },
        });

        expect(result).toEqual({ status: "cancelled" });
        expect(target.submitted).toEqual([]);
        expect(infos).toEqual(["Submission cancelled."]);
    });

    it("treats a cancelled login as a normal exit", async () => {
        const root = await createProject({ problemUrl });
        const infos: string[] = [];

        const result = await runSubmit({
            projectRoot: root,
            config: createConfig(),
            cwd: root,
            waitSeconds: 0,
            yes: true,
            stdout: createCapture().stream,
            stderr: createCapture().stream,
            dependencies: {
                createTarget: async () => undefined,
                info: (message) => infos.push(message),
            },
        });

        expect(result).toEqual({ status: "cancelled" });
        expect(infos).toEqual(["Login cancelled."]);
    });

    it("lists languages when the platform language is not configured", async () => {
        const root = await createProject({ problemUrl });

        await expect(
            runSubmit({
                projectRoot: root,
                config: createConfig(),
                cwd: root,
                waitSeconds: 0,
                yes: true,
                stdout: createCapture().stream,
                stderr: createCapture().stream,
                dependencies: {
                    createTarget: async () => createFakeTarget(),
                },
            }),
        ).rejects.toThrow(
            "languages.cpp.submit.atcoder is not set. Set it to one of:\n  - 5001: C++ 20 (C++)\n  - 5002: Python (3.11)",
        );
    });

    it("copies before submitting when submit.clip is always", async () => {
        const root = await createProject({ problemUrl });
        const copies: string[] = [];
        const target = createFakeTarget();
        const config = createConfig({ clip: "always", wait: 0 });
        setSubmitLanguage(config);

        await runSubmit({
            projectRoot: root,
            config,
            cwd: root,
            waitSeconds: 0,
            yes: true,
            stdout: createCapture().stream,
            stderr: createCapture().stream,
            dependencies: {
                createTarget: async () => target,
                copyToClipboard: async (text) => {
                    copies.push(text);
                    return true;
                },
                openInBrowser: async () => true,
            },
        });

        expect(copies).toEqual(["int main() { return 0; }\n"]);
        expect(target.submitted).toHaveLength(1);
    });

    it("copies when submission fails and still reports the failure when submit.clip is fail", async () => {
        const root = await createProject({ problemUrl });
        const copies: string[] = [];
        const warnings: string[] = [];
        const config = createConfig({ clip: "fail", wait: 0 });
        setSubmitLanguage(config);

        await expect(
            runSubmit({
                projectRoot: root,
                config,
                cwd: root,
                waitSeconds: 0,
                yes: true,
                stdout: createCapture().stream,
                stderr: createCapture().stream,
                dependencies: {
                    createTarget: async () =>
                        createFakeTarget({
                            submit: async () => {
                                throw new Error("submission rejected");
                            },
                        }),
                    copyToClipboard: async (text) => {
                        copies.push(text);
                        return true;
                    },
                    warn: (message) => warnings.push(message),
                },
            }),
        ).rejects.toThrow("submission rejected");

        expect(copies).toEqual(["int main() { return 0; }\n"]);
        expect(warnings).toContain(
            "Copied the source to the clipboard so you can submit it in the browser.",
        );
    });

    it("warns instead of failing when the browser cannot be opened", async () => {
        const root = await createProject({ problemUrl });
        const warnings: string[] = [];
        const config = createConfig({ wait: 0 });
        setSubmitLanguage(config);

        const result = await runSubmit({
            projectRoot: root,
            config,
            cwd: root,
            waitSeconds: 0,
            yes: true,
            stdout: createCapture().stream,
            stderr: createCapture().stream,
            dependencies: {
                createTarget: async () => createFakeTarget(),
                openInBrowser: async () => false,
                warn: (message) => warnings.push(message),
            },
        });

        expect(result.status).toBe("submitted");
        expect(warnings.some((warning) => warning.includes("Open this URL manually"))).toBe(true);
    });
});
