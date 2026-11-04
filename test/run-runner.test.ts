import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { runSolution } from "@/feature/run";
import { runProgram, splitRunArguments } from "@/lib/util/run-runner";

const originalCwd = process.cwd();
const originalUserProfile = process.env.USERPROFILE;
const originalHome = process.env.HOME;
let testRoot: string | undefined;
let projectRoot: string | undefined;

afterEach(async () => {
    process.chdir(originalCwd);
    if (originalUserProfile === undefined) {
        delete process.env.USERPROFILE;
    } else {
        process.env.USERPROFILE = originalUserProfile;
    }
    if (originalHome === undefined) {
        delete process.env.HOME;
    } else {
        process.env.HOME = originalHome;
    }

    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
        projectRoot = undefined;
    }
});

function createCapture(): { stream: { write(chunk: string): boolean }; text(): string } {
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

async function buildEntries(project: string): Promise<string[]> {
    const directory = join(project, ".neoj", "build");
    return existsSync(directory) ? readdir(directory) : [];
}

const runnerScript = `await Bun.write("args.json", JSON.stringify(process.argv.slice(2)));`;

const compiledLanguage = `
[languages.ts]
source = "src/*.ts"
compile = [{execPath}, "build", "{source}", "--outfile", "{outfile}"]
run = [{execPath}, "{outfile}"]
`.replaceAll("{execPath}", JSON.stringify(process.execPath));

const interpretedLanguage = `
[languages.ts]
source = "src/*.ts"
run = [{execPath}, "run", "{source}"]
`.replaceAll("{execPath}", JSON.stringify(process.execPath));

async function createProject(config: string, script = runnerScript): Promise<string> {
    testRoot = await mkdtemp(join(dirname(originalCwd), "neoj-run-test-"));
    const home = join(testRoot, "home");
    const project = join(testRoot, "project");
    await mkdir(home, { recursive: true });
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src", "main.ts"), script);
    await writeFile(join(project, "neoj.toml"), config);
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    process.chdir(project);
    projectRoot = project;
    return project;
}

describe("splitRunArguments", () => {
    it("takes the first operand as the source and forwards the rest", () => {
        expect(splitRunArguments([])).toEqual({ source: undefined, programArgs: [] });
        expect(splitRunArguments(["main"])).toEqual({ source: "main", programArgs: [] });
        expect(splitRunArguments(["main", "-x", "1"])).toEqual({
            source: "main",
            programArgs: ["-x", "1"],
        });
        expect(splitRunArguments(["main", "--silent", "--cache"])).toEqual({
            source: "main",
            programArgs: ["--silent", "--cache"],
        });
    });

    it("skips the neoj options that come before the source", () => {
        expect(splitRunArguments(["--silent", "main"])).toEqual({
            source: "main",
            programArgs: [],
        });
        expect(splitRunArguments(["-l", "ts", "main", "-x"])).toEqual({
            source: "main",
            programArgs: ["-x"],
        });
        expect(splitRunArguments(["--language=ts", "main"])).toEqual({
            source: "main",
            programArgs: [],
        });
        expect(splitRunArguments(["-lts", "main"])).toEqual({ source: "main", programArgs: [] });
        expect(splitRunArguments(["--cache", "--no-cache", "--silent"])).toEqual({
            source: undefined,
            programArgs: [],
        });
    });

    it("treats a -- before the source as the start of the program arguments", () => {
        expect(splitRunArguments(["--", "-x", "1"])).toEqual({
            source: undefined,
            programArgs: ["-x", "1"],
        });
        expect(splitRunArguments(["--silent", "--", "-x"])).toEqual({
            source: undefined,
            programArgs: ["-x"],
        });
        expect(splitRunArguments(["-l", "ts", "--"])).toEqual({
            source: undefined,
            programArgs: [],
        });
        expect(splitRunArguments(["--", "--"])).toEqual({
            source: undefined,
            programArgs: ["--"],
        });
    });

    it("drops one -- after the source and keeps the remaining ones", () => {
        expect(splitRunArguments(["main", "--"])).toEqual({ source: "main", programArgs: [] });
        expect(splitRunArguments(["main", "--", "-x"])).toEqual({
            source: "main",
            programArgs: ["-x"],
        });
        expect(splitRunArguments(["main", "a", "--", "b", "--", "c"])).toEqual({
            source: "main",
            programArgs: ["a", "b", "--", "c"],
        });
    });
});

describe("runProgram", () => {
    it("forwards the arguments and working directory, then returns the exit code", async () => {
        const project = await createProject("");
        await writeFile(
            join(project, "main.ts"),
            'await Bun.write("out.json", JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));',
        );

        const result = await runProgram({
            argv: [process.execPath, "run", "main.ts", "-x", "1"],
            cwd: project,
            stdio: "ignore",
        });

        expect(result).toEqual({ exitCode: 0, signal: null });
        const written = JSON.parse(await readFile(join(project, "out.json"), "utf8"));
        expect(written.args).toEqual(["-x", "1"]);
        expect(written.cwd).toBe(await realpath(project));
    });

    it("returns the program's own exit code", async () => {
        const project = await createProject("");

        const result = await runProgram({
            argv: [process.execPath, "-e", "process.exit(7)"],
            cwd: project,
            stdio: "ignore",
        });

        expect(result.exitCode).toBe(7);
        expect(result.signal).toBeNull();
    });

    it("reports an executable that cannot be started", async () => {
        const project = await createProject("");

        await expect(
            runProgram({
                argv: ["neoj-no-such-program-to-run"],
                cwd: project,
                stdio: "ignore",
            }),
        ).rejects.toThrow("Failed to start the program");
    });
});

describe("runSolution", () => {
    it("runs test.source with the program arguments and forwards them verbatim", async () => {
        const project = await createProject(`
[test]
source = "src/main.ts"
${interpretedLanguage}
`);

        const result = await runSolution({
            programArgs: ["-x", "1", "--silent"],
            stdio: "ignore",
            stderr: createCapture().stream,
        });

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(await readFile(join(project, "args.json"), "utf8"))).toEqual([
            "-x",
            "1",
            "--silent",
        ]);
    });

    it("prefers the positional source and accepts aliases", async () => {
        const project = await createProject(`
[alias]
fast = "src/main.ts"
${interpretedLanguage}
`);

        const stderr = createCapture();
        const result = await runSolution({
            source: "fast",
            programArgs: [],
            stdio: "ignore",
            stderr: stderr.stream,
        });

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(await readFile(join(project, "args.json"), "utf8"))).toEqual([]);
        expect(stderr.text()).toBe("");
    });

    it("returns the program's exit code", async () => {
        await createProject(
            `
[test]
source = "src/main.ts"
${interpretedLanguage}
`,
            "process.exit(5);",
        );

        const result = await runSolution({
            programArgs: [],
            stdio: "ignore",
            stderr: createCapture().stream,
        });

        expect(result.exitCode).toBe(5);
    });

    it("prints the compile result, hides it when silent, and reuses the cache", async () => {
        const project = await createProject(`
[test]
source = "src/main.ts"
${compiledLanguage}
`);

        const first = createCapture();
        expect(
            (
                await runSolution({
                    programArgs: [],
                    stdio: "ignore",
                    stderr: first.stream,
                })
            ).exitCode,
        ).toBe(0);
        expect(first.text()).toContain("Compiled src/main.ts (languages.ts) in");
        expect(await buildEntries(project)).toEqual([]);

        const silentRun = createCapture();
        await runSolution({
            programArgs: [],
            stdio: "ignore",
            silent: true,
            stderr: silentRun.stream,
        });
        expect(silentRun.text()).toBe("");

        const cached = createCapture();
        await runSolution({
            programArgs: [],
            stdio: "ignore",
            cache: true,
            stderr: cached.stream,
        });
        const reused = createCapture();
        await runSolution({
            programArgs: [],
            stdio: "ignore",
            cache: true,
            stderr: reused.stream,
        });
        expect(reused.text()).toContain("Reused the cached build for src/main.ts (languages.ts).");
        expect(await buildEntries(project)).toHaveLength(1);
    });

    it("reads silent from [run] and still prints compiler diagnostics", async () => {
        await createProject(
            `
[test]
source = "src/main.ts"
[run]
silent = true
[languages.ts]
source = "src/*.ts"
compile = [{execPath}, "build", "missing.ts", "--outfile", "{outfile}"]
run = [{execPath}, "{outfile}"]
`.replaceAll("{execPath}", JSON.stringify(process.execPath)),
        );

        const stderr = createCapture();
        await expect(
            runSolution({ programArgs: [], stdio: "ignore", stderr: stderr.stream }),
        ).rejects.toThrow("Compilation failed for languages.ts");

        expect(stderr.text()).toContain("error:");
        expect(stderr.text()).not.toContain("Compiled");
        expect(await buildEntries(projectRoot!)).toEqual([]);
    });
});
