import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    collectConfiguredLanguageIds,
    filterPlatformLanguages,
    formatLanguageListing,
    resolveLanguagesPlatform,
    runLanguages,
    type CreateLanguageTargetInput,
    type LanguageTarget,
    type PlatformLanguage,
} from "@/feature/languages";
import type { Config } from "@/lib/util/config";

let testRoot: string | undefined;

afterEach(async () => {
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

function createConfig(): Config {
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
            check_limit: true,
        },
        testcase: { folder: "test", filename: "sample-{}" },
        handmade: { filename: "handmade-{}" },
        generate: {
            gen: undefined,
            naive: undefined,
            filename: "random-{}",
            count: 1,
            timeout: 10,
            parallel: true,
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
        languages: {
            cpp: {
                source: "src/*.cpp",
                run: ["{outfile}"],
                submit: { atcoder: "5001", yukicoder: "5001" },
            },
        },
        update: { enabled: true, interval: 259_200 },
        download: { show_sample: false },
        stash: { auto_stash: false, auto_apply: false, force: true },
        template: { enable: false, exclude: [], mode: "overlay" },
    };
}

async function createProject(options: { problemUrl?: string } = {}): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-languages-test-"));
    await Bun.write(join(testRoot, "neoj.toml"), "");
    if (options.problemUrl !== undefined) {
        await mkdir(join(testRoot, ".neoj"), { recursive: true });
        await Bun.write(
            join(testRoot, ".neoj", "problem.json"),
            `${JSON.stringify({ url: options.problemUrl })}\n`,
        );
    }

    return testRoot;
}

const atCoderLanguages: PlatformLanguage[] = [
    { id: "5001", name: "C++ 20", detail: "C++" },
    { id: "5002", name: "Python", detail: "Python" },
];

function createFakeTarget(input: CreateLanguageTargetInput): LanguageTarget {
    const displayName =
        input.platform === "atcoder"
            ? "AtCoder"
            : input.platform === "codeforces"
              ? "Codeforces"
              : input.platform === "shareoj"
                ? "ShareOJ"
                : "yukicoder";
    const context =
        input.platform === "atcoder"
            ? (input.contestId ?? "abc100")
            : input.platform === "codeforces"
              ? input.fallback
                  ? `${input.contestId ?? "1"}, fallback contest because no Codeforces problem is recorded`
                  : (input.contestId ?? "1")
              : undefined;
    return {
        platform: input.platform,
        displayName,
        context,
        async list() {
            return atCoderLanguages;
        },
    };
}

describe("formatLanguageListing", () => {
    it("aligns the ID column and prints the language with its source limit", () => {
        const lines = formatLanguageListing({
            displayName: "AtCoder",
            context: "abc300",
            platform: "atcoder",
            languages: atCoderLanguages,
            configuredIds: new Set(["5001"]),
            configuredKeys: ["cpp"],
            filter: undefined,
        });

        expect(lines[0]).toBe("AtCoder (abc300) — 512 KiB source limit");
        expect(lines[1]).toBe("  ID    Language");
        expect(lines[2]).toContain("5001");
        expect(lines[2]?.endsWith(" *")).toBe(true);
        expect(lines[3]).toContain("5002");
        expect(lines.some((line) => line.includes("languages.cpp.submit.atcoder"))).toBe(true);
    });

    it("names the source limit of every platform", () => {
        const listing = (
            platform: "atcoder" | "yukicoder" | "shareoj" | "codeforces",
            displayName: string,
        ) =>
            formatLanguageListing({
                displayName,
                context: undefined,
                platform,
                languages: atCoderLanguages,
                configuredIds: new Set(),
                configuredKeys: [],
                filter: undefined,
            })[0];

        expect(listing("yukicoder", "yukicoder")).toBe("yukicoder — 128 KiB source limit");
        expect(listing("shareoj", "ShareOJ")).toBe("ShareOJ — 128 KiB source limit");
        expect(listing("codeforces", "Codeforces")).toBe("Codeforces — 256 KiB source limit");
    });

    it("explains how to configure an ID when none is set", () => {
        const lines = formatLanguageListing({
            displayName: "yukicoder",
            context: undefined,
            platform: "yukicoder",
            languages: [{ id: "1", name: "C++17", detail: "g++ 12.2" }],
            configuredIds: new Set(),
            configuredKeys: [],
            filter: undefined,
        });

        expect(lines[0]).toBe("yukicoder — 128 KiB source limit");
        expect(lines.at(-1)).toBe(
            'No ID is configured. Add languages.<key>.submit.yukicoder in neoj.toml, or run "neoj submit --platform-language <id>".',
        );
    });

    it("reports an empty result for a filter", () => {
        const lines = formatLanguageListing({
            displayName: "yukicoder",
            context: undefined,
            platform: "yukicoder",
            languages: [],
            configuredIds: new Set(),
            configuredKeys: [],
            filter: "rust",
        });

        expect(lines[0]).toBe("yukicoder — 128 KiB source limit");
        expect(lines).toContain('No languages matched "rust".');
    });
});

describe("filterPlatformLanguages", () => {
    it("matches the ID, name, and detail without case sensitivity", () => {
        expect(
            filterPlatformLanguages(atCoderLanguages, "PYTHON").map((language) => language.id),
        ).toEqual(["5002"]);
        expect(
            filterPlatformLanguages(atCoderLanguages, "c++").map((language) => language.id),
        ).toEqual(["5001"]);
        expect(
            filterPlatformLanguages(atCoderLanguages, "500").map((language) => language.id),
        ).toEqual(["5001", "5002"]);
    });

    it("keeps everything for an empty filter", () => {
        expect(filterPlatformLanguages(atCoderLanguages, undefined)).toHaveLength(2);
        expect(filterPlatformLanguages(atCoderLanguages, "  ")).toHaveLength(2);
    });
});

describe("collectConfiguredLanguageIds", () => {
    it("collects trimmed IDs and the keys that set them", () => {
        const config = createConfig();
        config.languages.py = {
            source: "src/*.py",
            run: ["python"],
            submit: { atcoder: " 5002 " },
        };
        config.languages.rust = { source: "src/*.rs", run: ["{outfile}"] };

        expect(collectConfiguredLanguageIds(config, "atcoder")).toEqual({
            ids: new Set(["5001", "5002"]),
            keys: ["cpp", "py"],
        });
        expect(collectConfiguredLanguageIds(config, "yukicoder")).toEqual({
            ids: new Set(["5001"]),
            keys: ["cpp"],
        });
    });
});

describe("resolveLanguagesPlatform", () => {
    it("uses the current problem when the platform is omitted", () => {
        expect(
            resolveLanguagesPlatform(undefined, {
                url: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
            }),
        ).toBe("atcoder");
        expect(
            resolveLanguagesPlatform(undefined, { url: "https://yukicoder.me/problems/no/480" }),
        ).toBe("yukicoder");
    });

    it("prefers the explicit platform and validates it", () => {
        expect(
            resolveLanguagesPlatform("yukicoder", {
                url: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
            }),
        ).toBe("yukicoder");
        expect(
            resolveLanguagesPlatform("codeforces", {
                url: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
            }),
        ).toBe("codeforces");
        expect(() => resolveLanguagesPlatform("aoj", undefined)).toThrow(
            'Unsupported platform "aoj". Supported platforms: atcoder, yukicoder, shareoj, codeforces.',
        );
    });

    it("asks for a platform when no problem is recorded", () => {
        expect(() => resolveLanguagesPlatform(undefined, undefined)).toThrow(
            'No problem is recorded. Pass a platform: "neoj languages atcoder", "neoj languages yukicoder", "neoj languages shareoj", or "neoj languages codeforces".',
        );
    });
});

describe("runLanguages", () => {
    it("lists the current problem's contest languages and marks the configured ID", async () => {
        const root = await createProject({
            problemUrl: "https://atcoder.jp/contests/abc300/tasks/abc300_a",
        });
        const stdout = createCapture();
        let captured: CreateLanguageTargetInput | undefined;

        const result = await runLanguages({
            config: createConfig(),
            cwd: root,
            stdout: stdout.stream,
            dependencies: {
                createTarget: async (input) => {
                    captured = input;
                    return createFakeTarget(input);
                },
            },
        });

        expect(result).toEqual({ status: "listed", platform: "atcoder", count: 2 });
        expect(captured).toMatchObject({
            platform: "atcoder",
            contestId: "abc300",
            fallback: false,
        });
        expect(stdout.text()).toContain("AtCoder (abc300) — 512 KiB source limit");
        expect(stdout.text()).toContain("* matches languages.cpp.submit.atcoder in neoj.toml.");
    });

    it("works for yukicoder without a recorded problem", async () => {
        const root = await createProject();
        const stdout = createCapture();
        let captured: CreateLanguageTargetInput | undefined;

        const result = await runLanguages({
            config: createConfig(),
            cwd: root,
            platform: "yukicoder",
            stdout: stdout.stream,
            dependencies: {
                createTarget: async (input) => {
                    captured = input;
                    return createFakeTarget(input);
                },
            },
        });

        expect(result).toEqual({ status: "listed", platform: "yukicoder", count: 2 });
        expect(captured).toMatchObject({
            platform: "yukicoder",
            contestId: undefined,
            fallback: false,
        });
        expect(stdout.text()).toContain("yukicoder — 128 KiB source limit");
    });

    it("falls back to abc100 when no AtCoder problem is recorded", async () => {
        const root = await createProject();
        let captured: CreateLanguageTargetInput | undefined;

        const result = await runLanguages({
            config: createConfig(),
            cwd: root,
            platform: "atcoder",
            stdout: createCapture().stream,
            dependencies: {
                createTarget: async (input) => {
                    captured = input;
                    return createFakeTarget(input);
                },
            },
        });

        expect(result.status).toBe("listed");
        expect(captured).toMatchObject({
            platform: "atcoder",
            contestId: undefined,
            fallback: true,
        });
    });

    it("uses the Codeforces contest of the recorded problem", async () => {
        const root = await createProject({
            problemUrl: "https://codeforces.com/problemset/problem/1900/B",
        });
        const stdout = createCapture();
        let captured: CreateLanguageTargetInput | undefined;

        const result = await runLanguages({
            config: createConfig(),
            cwd: root,
            platform: "codeforces",
            stdout: stdout.stream,
            dependencies: {
                createTarget: async (input) => {
                    captured = input;
                    return createFakeTarget(input);
                },
            },
        });

        expect(result).toEqual({ status: "listed", platform: "codeforces", count: 2 });
        expect(captured).toMatchObject({
            platform: "codeforces",
            contestId: "1900",
            fallback: false,
        });
        expect(stdout.text()).toContain("Codeforces (1900) — 256 KiB source limit");
    });

    it("falls back to contest 1 for Codeforces without a recorded problem", async () => {
        const root = await createProject();
        const stdout = createCapture();
        let captured: CreateLanguageTargetInput | undefined;

        const result = await runLanguages({
            config: createConfig(),
            cwd: root,
            platform: "codeforces",
            stdout: stdout.stream,
            dependencies: {
                createTarget: async (input) => {
                    captured = input;
                    return createFakeTarget(input);
                },
            },
        });

        expect(result.status).toBe("listed");
        expect(captured).toMatchObject({
            platform: "codeforces",
            contestId: undefined,
            fallback: true,
        });
        expect(stdout.text()).toContain(
            "Codeforces (1, fallback contest because no Codeforces problem is recorded)",
        );
    });

    it("treats a cancelled login as a normal exit", async () => {
        const root = await createProject({ problemUrl: "https://yukicoder.me/problems/no/480" });
        const infos: string[] = [];

        const result = await runLanguages({
            config: createConfig(),
            cwd: root,
            platform: "atcoder",
            stdout: createCapture().stream,
            dependencies: {
                createTarget: async () => undefined,
                info: (message) => infos.push(message),
            },
        });

        expect(result).toEqual({ status: "cancelled" });
        expect(infos).toEqual(["Login cancelled."]);
    });

    it("prints only the matching languages and reports an empty filter", async () => {
        const root = await createProject({ problemUrl: "https://yukicoder.me/problems/no/480" });
        const stdout = createCapture();

        await runLanguages({
            config: createConfig(),
            cwd: root,
            filter: "python",
            stdout: stdout.stream,
            dependencies: { createTarget: async (input) => createFakeTarget(input) },
        });

        expect(stdout.text()).toContain("5002");
        expect(stdout.text()).not.toContain("5001");

        const empty = createCapture();
        await runLanguages({
            config: createConfig(),
            cwd: root,
            filter: "rust",
            stdout: empty.stream,
            dependencies: { createTarget: async (input) => createFakeTarget(input) },
        });
        expect(empty.text()).toContain('No languages matched "rust".');
    });
});
