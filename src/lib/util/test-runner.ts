import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { arch, availableParallelism, platform } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { createAnsiStyles, supportsColor, type AnsiStyles } from "@/lib/util/ansi";
import { runCommand, type CommandResult } from "@/lib/util/command-runner";
import type { Config, ShowStderrMode } from "@/lib/util/config";
import { hasErrorCode } from "@/lib/util/errors";
import {
    compareOutput,
    formatComparison,
    formatLinesTable,
    type CaseVerdict,
    type ComparisonOptions,
    type ComparisonResult,
} from "@/lib/util/judge";
import { maxValue } from "@/lib/util/numbers";
import { createProgressBar } from "@/lib/util/progress";
import { resolveTestcaseDirectory } from "@/lib/util/testcase";

const buildDirectoryName = "build";
const executableBaseName = "a";
const compileTimeoutMs = 10 * 60 * 1000;

export const placeholderNames = ["source", "outfile", "outdir", "dir", "testdir"] as const;

type PlaceholderName = (typeof placeholderNames)[number];

const placeholderPattern = /\{([^{}]*)\}/gu;

export interface TestLanguage {
    key: string;
    sourcePatterns: readonly string[];
    compile: readonly string[] | undefined;
    run: readonly string[];
    timeoutSeconds: number | undefined;
    memoryMiB: number | undefined;
    cacheFiles: readonly string[];
}

export interface TestCase {
    name: string;
    inputPath: string;
    expectedOutputPath: string | undefined;
}

export interface TestCaseResult {
    name: string;
    verdict: CaseVerdict;
    durationMs: number;
    stdout: string;
    stderr: string;
    input: string | undefined;
    exitCode: number | null;
    signal: string | null;
    maxRssBytes: number | undefined;
    comparison: ComparisonResult | undefined;
    detail: string | undefined;
}

export interface RunTestsOptions {
    projectRoot: string;
    config: Config;
    /** Base directory for a `neoj test <source>` path; defaults to the process directory. */
    cwd?: string;
    source?: string;
    language?: string;
    jobs?: number;
    parallel?: boolean;
    timeoutSeconds?: number;
    memoryMiB?: number;
    filters?: readonly string[];
    cache?: boolean;
    ignoreTrailingSpace?: boolean;
    ignoreTrailingNewline?: boolean;
    showStderr?: ShowStderrMode;
    /** Defaults to `test.show_line_numbers`. */
    lineNumbers?: boolean;
    progress?: boolean;
    verbose?: boolean;
    stdout?: ProgressStream;
    stderr?: ProgressStream;
}

export interface RunTestsResult {
    results: readonly TestCaseResult[];
    exitCode: 0 | 2;
}

interface ProgressStream {
    write(chunk: string): unknown;
    isTTY?: boolean;
    columns?: number;
}

export interface BuildKeyInput {
    language: TestLanguage;
    sourceRelativePath: string;
    sourceContents: Uint8Array | string;
    cacheFiles: readonly { relativePath: string; contents: Uint8Array | string }[];
    platform: string;
    arch: string;
}

function toPatternList(value: string | readonly string[] | undefined): string[] {
    if (value === undefined) {
        return [];
    }

    return typeof value === "string" ? [value] : [...value];
}

function toRelativePattern(pattern: string, label: string): string {
    const normalized = pattern.split("\\").join("/");
    if (normalized === "" || normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) {
        throw new Error(`${label} must be a relative glob, but got "${pattern}".`);
    }
    if (normalized.split("/").includes("..")) {
        throw new Error(`${label} must stay inside the project, but got "${pattern}".`);
    }

    return normalized;
}

/** Validate the language definitions and fill in their defaults. */
export function readLanguages(config: Config): Map<string, TestLanguage> {
    const languages = new Map<string, TestLanguage>();

    for (const [key, value] of Object.entries(config.languages)) {
        const label = `languages.${key}`;
        const compile =
            value.compile === undefined || value.compile.length === 0
                ? undefined
                : [...value.compile];

        languages.set(key, {
            key,
            sourcePatterns: toPatternList(value.source).map((pattern) =>
                toRelativePattern(pattern, `${label}.source`),
            ),
            compile,
            run: [...value.run],
            timeoutSeconds: value.timeout,
            memoryMiB: value.memory,
            cacheFiles: toPatternList(value.cache_files).map((pattern) =>
                toRelativePattern(pattern, `${label}.cache_files`),
            ),
        });
    }

    return languages;
}

export interface ResolvedSource {
    absolutePath: string;
    relativePath: string;
}

/** Why a source path could not be used. */
export type SourceResolveFailure =
    | "empty"
    | "outside"
    | "missing"
    | "resolves-outside"
    | "not-a-file";

export type SourceResolveResult =
    | { ok: true; source: ResolvedSource }
    | { ok: false; reason: SourceResolveFailure };

/**
 * Resolve a plain (non-glob) source path to a file inside the project.
 *
 * The failure reason is returned instead of thrown so that callers can word
 * the error for an alias or a command-line argument.
 */
export async function tryResolveSource(
    projectRoot: string,
    baseDirectory: string,
    spec: string,
): Promise<SourceResolveResult> {
    const trimmed = spec.trim();
    if (trimmed === "") {
        return { ok: false, reason: "empty" };
    }

    const root = await realpath(projectRoot);
    const absoluteBaseDirectory = await realpath(baseDirectory);
    const absolutePath = resolve(absoluteBaseDirectory, trimmed);
    const relativeToRoot = relative(root, absolutePath);
    if (
        relativeToRoot === "" ||
        relativeToRoot === ".." ||
        relativeToRoot.startsWith(`..${sep}`) ||
        isAbsolute(relativeToRoot)
    ) {
        return { ok: false, reason: "outside" };
    }

    let realPath: string;
    try {
        realPath = await realpath(absolutePath);
    } catch (error) {
        if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR")) {
            return { ok: false, reason: "missing" };
        }
        throw error;
    }

    const realRelative = relative(root, realPath);
    if (realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
        return { ok: false, reason: "resolves-outside" };
    }

    if (!(await stat(realPath)).isFile()) {
        return { ok: false, reason: "not-a-file" };
    }

    return {
        ok: true,
        source: { absolutePath: realPath, relativePath: realRelative.split(sep).join("/") },
    };
}

function sourceError(reason: SourceResolveFailure, spec: string): Error {
    switch (reason) {
        case "empty": {
            return new Error("The source file must not be empty.");
        }
        case "outside": {
            return new Error(`Source file "${spec}" must be inside the project.`);
        }
        case "missing": {
            return new Error(
                `Source file "${spec}" does not exist. Pass a file path, not a glob, or fix test.source.`,
            );
        }
        case "resolves-outside": {
            return new Error(`Source file "${spec}" resolves outside the project.`);
        }
        case "not-a-file": {
            return new Error(`Source "${spec}" is not a regular file.`);
        }
    }
}

/** Resolve a plain (non-glob) source path and require it to be a file inside the project. */
export async function resolveSourceFile(
    projectRoot: string,
    baseDirectory: string,
    spec: string,
): Promise<ResolvedSource> {
    const result = await tryResolveSource(projectRoot, baseDirectory, spec);
    if (result.ok) {
        return result.source;
    }

    throw sourceError(result.reason, spec);
}

const aliasFailureReasons: Record<SourceResolveFailure, string> = {
    empty: "is empty",
    outside: "is outside the project",
    missing: "does not exist",
    "resolves-outside": "resolves outside the project",
    "not-a-file": "is not a regular file",
};

/**
 * Resolve the file an alias points at.
 *
 * Alias targets are always relative to the project root, so an alias behaves
 * the same from any subdirectory.
 */
export async function resolveAliasSource(
    projectRoot: string,
    name: string,
    target: string,
): Promise<ResolvedSource> {
    const result = await tryResolveSource(projectRoot, projectRoot, target);
    if (result.ok) {
        return result.source;
    }

    throw new Error(
        `Alias "${name}" points to "${target}", which ${aliasFailureReasons[result.reason]}.`,
    );
}

/** List the configured aliases for an error message. */
export function describeAliases(aliases: Readonly<Record<string, string>>): string {
    const names = Object.keys(aliases).sort(naturalCompare);
    if (names.length === 0) {
        return "No aliases are defined in [alias].";
    }

    return `Available aliases: ${names.join(", ")}.`;
}

/**
 * Pick the source file to test: an alias, then a path, then `test.source`.
 *
 * Only the positional argument is matched against `[alias]`; `test.source` is
 * always a literal path.
 */
export async function resolveTestSource(
    projectRoot: string,
    options: Pick<RunTestsOptions, "source" | "cwd" | "config">,
    spec: string,
): Promise<ResolvedSource> {
    const positional = options.source;
    if (positional === undefined) {
        return resolveSourceFile(projectRoot, projectRoot, spec);
    }

    const target = Object.hasOwn(options.config.alias, positional)
        ? options.config.alias[positional]
        : undefined;
    if (target !== undefined) {
        return resolveAliasSource(projectRoot, positional, target);
    }

    const result = await tryResolveSource(projectRoot, options.cwd ?? process.cwd(), positional);
    if (result.ok) {
        return result.source;
    }
    if (result.reason === "missing") {
        throw new Error(
            `Neither a file nor an alias matches "${positional}". ${describeAliases(options.config.alias)}`,
        );
    }

    throw sourceError(result.reason, positional);
}

/** Pick the language whose source glob covers `sourceRelativePath`. */
export function detectLanguage(
    languages: ReadonlyMap<string, TestLanguage>,
    sourceRelativePath: string,
    forcedKey?: string,
): TestLanguage {
    if (forcedKey !== undefined) {
        const forced = languages.get(forcedKey);
        if (forced === undefined) {
            throw new Error(
                `Unknown language "${forcedKey}". Defined languages: ${[...languages.keys()].join(", ")}.`,
            );
        }
        const matches = forced.sourcePatterns.some((pattern) =>
            new Bun.Glob(pattern).match(sourceRelativePath),
        );
        if (!matches) {
            throw new Error(
                `"${sourceRelativePath}" does not match languages.${forcedKey}.source (${forced.sourcePatterns.join(", ")}).`,
            );
        }

        return forced;
    }

    const matches = [...languages.values()].filter((language) =>
        language.sourcePatterns.some((pattern) => new Bun.Glob(pattern).match(sourceRelativePath)),
    );

    if (matches.length === 1) {
        return matches[0]!;
    }
    if (matches.length === 0) {
        throw new Error(
            `No language matches "${sourceRelativePath}". Add or adjust a [languages.<key>] source glob.`,
        );
    }

    throw new Error(
        `"${sourceRelativePath}" matches several languages: ${matches.map((language) => `languages.${language.key}`).join(", ")}. Pass --language <key> to choose one.`,
    );
}

/** Replace `{source}`, `{outfile}`, and friends, rejecting unknown placeholders. */
export function expandTokens(
    tokens: readonly string[],
    values: Readonly<Record<PlaceholderName, string>>,
    label: string,
): string[] {
    return tokens.map((token) => {
        for (const match of token.matchAll(placeholderPattern)) {
            const name = match[1] ?? "";
            if (!(placeholderNames as readonly string[]).includes(name)) {
                throw new Error(
                    `${label} uses the unknown placeholder "{${name}}". Supported placeholders: ${placeholderNames.map((placeholder) => `{${placeholder}}`).join(", ")}.`,
                );
            }
        }

        let expanded = token;
        for (const name of placeholderNames) {
            expanded = expanded.replaceAll(`{${name}}`, values[name]);
        }

        return expanded;
    });
}

/** Chunk a name so that digit runs compare as numbers, e.g. `sample-2` before `sample-10`. */
function nameChunks(name: string): string[] {
    return name.match(/\d+|\D+/gu) ?? [];
}

export function naturalCompare(left: string, right: string): number {
    const leftChunks = nameChunks(left);
    const rightChunks = nameChunks(right);
    const length = Math.min(leftChunks.length, rightChunks.length);

    for (let index = 0; index < length; index += 1) {
        const leftChunk = leftChunks[index]!;
        const rightChunk = rightChunks[index]!;
        const leftNumeric = /^\d/u.test(leftChunk);
        const rightNumeric = /^\d/u.test(rightChunk);

        if (leftNumeric && rightNumeric) {
            const difference = Number(leftChunk) - Number(rightChunk);
            if (difference !== 0) {
                return difference < 0 ? -1 : 1;
            }
            if (leftChunk.length !== rightChunk.length) {
                return leftChunk.length - rightChunk.length;
            }
        } else if (leftChunk !== rightChunk) {
            return leftChunk < rightChunk ? -1 : 1;
        }
    }

    if (leftChunks.length !== rightChunks.length) {
        return leftChunks.length - rightChunks.length;
    }

    return left === right ? 0 : left < right ? -1 : 1;
}

/** Collect `*.in` / `*.out` pairs from the test-case directory, in natural order. */
export async function discoverTestCases(
    directory: string,
    filters: readonly string[],
): Promise<TestCase[]> {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
            throw new Error(
                `Test-case directory "${directory}" does not exist. Run "neoj download <url>" first.`,
                { cause: error },
            );
        }
        throw error;
    }

    const outputs = new Set(
        entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".out"))
            .map((entry) => entry.name.slice(0, -".out".length)),
    );
    const names = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".in"))
        .map((entry) => entry.name.slice(0, -".in".length))
        .sort(naturalCompare);

    if (names.length === 0) {
        throw new Error(`No test case ("*.in") found in "${directory}".`);
    }

    let selected = names;
    if (filters.length > 0) {
        selected = names.filter((name) => filters.includes(name));
        if (selected.length === 0) {
            throw new Error(
                `No test case matches ${filters.map((filter) => `"${filter}"`).join(", ")}. Available: ${names.map((name) => `"${name}"`).join(", ")}.`,
            );
        }
    }

    return selected.map((name) => ({
        name,
        inputPath: join(directory, `${name}.in`),
        expectedOutputPath: outputs.has(name) ? join(directory, `${name}.out`) : undefined,
    }));
}

/** Expand `cache_files` globs, sorted so the cache key is stable. */
export async function collectCacheFiles(
    projectRoot: string,
    patterns: readonly string[],
): Promise<{ relativePath: string; absolutePath: string }[]> {
    const seen = new Set<string>();
    const files: { relativePath: string; absolutePath: string }[] = [];

    for (const pattern of patterns) {
        const glob = new Bun.Glob(pattern);
        for await (const path of glob.scan({
            cwd: projectRoot,
            onlyFiles: true,
            dot: true,
            absolute: false,
        })) {
            const relativePath = path.split(/[\\/]/u).join("/");
            if (seen.has(relativePath)) {
                continue;
            }
            seen.add(relativePath);
            files.push({ relativePath, absolutePath: join(projectRoot, path) });
        }
    }

    return files.sort((left, right) => naturalCompare(left.relativePath, right.relativePath));
}

/**
 * Hash everything that changes the compiled binary: the commands, the source
 * text, extra headers, and the platform.
 */
export function computeBuildKey(input: BuildKeyInput): string {
    const hash = createHash("sha256");
    hash.update("neoj-test-v1\n");
    hash.update(`language:${input.language.key}\n`);
    hash.update(`compile:${JSON.stringify(input.language.compile ?? [])}\n`);
    hash.update(`run:${JSON.stringify(input.language.run)}\n`);
    hash.update(`platform:${input.platform}/${input.arch}\n`);
    hash.update(`source:${input.sourceRelativePath}\n`);
    hash.update(input.sourceContents);
    hash.update("\n");
    for (const file of input.cacheFiles) {
        hash.update(`cache:${file.relativePath}\n`);
        hash.update(file.contents);
        hash.update("\n");
    }

    return hash.digest("hex");
}

function resolveExecutablePath(outfilePath: string): string {
    if (platform() === "win32" && !existsSync(outfilePath) && existsSync(`${outfilePath}.exe`)) {
        return `${outfilePath}.exe`;
    }

    return outfilePath;
}

function describeExit(result: CommandResult): string {
    if (result.signal !== null) {
        return `killed by ${result.signal}`;
    }

    return `exit code ${result.exitCode ?? "unknown"}`;
}

function formatDuration(durationMs: number): string {
    return durationMs < 1000
        ? `${Math.round(durationMs)} ms`
        : `${(durationMs / 1000).toFixed(2)} s`;
}

function formatMiB(bytes: number): string {
    return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

/** Peak memory of one case, or `? MiB` when the platform does not report it. */
function formatMemory(bytes: number | undefined): string {
    return bytes === undefined ? "? MiB" : formatMiB(bytes);
}

/** Split captured output into lines, dropping a trailing empty line. */
function outputLines(text: string): string[] {
    const normalized = text.replace(/\r\n/gu, "\n").replace(/\n+$/u, "");
    if (normalized === "") {
        return [];
    }

    return normalized.split("\n");
}

function takeLines(text: string, limit: number): { lines: string[]; omitted: number } {
    const lines = outputLines(text);
    return { lines: lines.slice(0, limit), omitted: Math.max(0, lines.length - limit) };
}

interface CaseContext {
    projectRoot: string;
    runTokens: readonly string[];
    timeoutSeconds: number;
    memoryMiB: number;
    comparison: ComparisonOptions;
    verbose: boolean;
}

export interface JudgeInput {
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    outputLimitExceeded: boolean;
    maxRssBytes: number | undefined;
    stdout: string;
    /** Missing when the case has no `.out` file. */
    expectedOutput: string | undefined;
    memoryMiB: number;
    comparison: ComparisonOptions;
}

export interface JudgeResult {
    verdict: CaseVerdict;
    detail: string | undefined;
    comparison: ComparisonResult | undefined;
}

/** Turn one finished run into a verdict; memory is checked after the fact. */
export function judgeCommandResult(input: JudgeInput): JudgeResult {
    if (input.outputLimitExceeded) {
        return { verdict: "RE", detail: "output limit exceeded", comparison: undefined };
    }
    if (input.timedOut) {
        return { verdict: "TLE", detail: undefined, comparison: undefined };
    }
    if (input.maxRssBytes !== undefined && input.maxRssBytes > input.memoryMiB * 1024 * 1024) {
        return { verdict: "MLE", detail: undefined, comparison: undefined };
    }
    if (input.exitCode !== 0) {
        return {
            verdict: "RE",
            detail:
                input.signal !== null
                    ? `killed by ${input.signal}`
                    : `exit code ${input.exitCode ?? "unknown"}`,
            comparison: undefined,
        };
    }
    if (input.expectedOutput === undefined) {
        return {
            verdict: "UNJUDGED",
            detail: "expected output missing",
            comparison: undefined,
        };
    }

    const comparison = compareOutput(input.expectedOutput, input.stdout, input.comparison);
    return {
        verdict: comparison.matched ? "AC" : "WA",
        detail: undefined,
        comparison,
    };
}

async function runTestCase(testCase: TestCase, context: CaseContext): Promise<TestCaseResult> {
    const result = await runCommand({
        argv: context.runTokens,
        cwd: context.projectRoot,
        stdinFile: testCase.inputPath,
        timeoutMs: Math.round(context.timeoutSeconds * 1000),
    });

    const expectedOutput =
        testCase.expectedOutputPath === undefined
            ? undefined
            : await Bun.file(testCase.expectedOutputPath).text();
    const judged = judgeCommandResult({
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        outputLimitExceeded: result.outputLimitExceeded,
        maxRssBytes: result.maxRssBytes,
        stdout: result.stdout,
        expectedOutput,
        memoryMiB: context.memoryMiB,
        comparison: context.comparison,
    });

    return {
        name: testCase.name,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        input:
            context.verbose || judged.verdict !== "AC"
                ? await Bun.file(testCase.inputPath).text()
                : undefined,
        exitCode: result.exitCode,
        signal: result.signal,
        maxRssBytes: result.maxRssBytes,
        verdict: judged.verdict,
        detail: judged.detail,
        comparison: judged.comparison,
    };
}

function verdictDescription(
    result: TestCaseResult,
    timeoutSeconds: number,
    memoryMiB: number,
): string {
    switch (result.verdict) {
        case "AC": {
            return "AC";
        }
        case "WA": {
            const line = result.comparison?.firstMismatchLine;
            return line === undefined ? "WA" : `WA (line ${line})`;
        }
        case "TLE": {
            return `TLE (${formatDuration(result.durationMs)} > ${timeoutSeconds} s)`;
        }
        case "MLE": {
            return `MLE (> ${memoryMiB} MiB)`;
        }
        case "RE": {
            return `RE (${result.detail ?? "runtime error"})`;
        }
        case "UNJUDGED": {
            return "UNJUDGED (expected output missing)";
        }
    }
}

function verdictSymbol(result: TestCaseResult, styles: AnsiStyles): string {
    switch (result.verdict) {
        case "AC": {
            return styles.green("✓");
        }
        case "UNJUDGED": {
            return styles.yellow("?");
        }
        default: {
            return styles.red("✗");
        }
    }
}

function colorVerdict(result: TestCaseResult, text: string, styles: AnsiStyles): string {
    switch (result.verdict) {
        case "AC": {
            return styles.green(text);
        }
        case "UNJUDGED": {
            return styles.yellow(text);
        }
        default: {
            return styles.red(text);
        }
    }
}

function formatCaseLine(
    result: TestCaseResult,
    nameWidth: number,
    timeoutSeconds: number,
    memoryMiB: number,
    styles: AnsiStyles,
): string {
    const description = colorVerdict(
        result,
        verdictDescription(result, timeoutSeconds, memoryMiB),
        styles,
    );
    return `${verdictSymbol(result, styles)} ${result.name.padEnd(nameWidth)}  ${formatDuration(result.durationMs).padStart(8)}  ${formatMemory(result.maxRssBytes).padStart(8)}  ${description}`;
}

/** Detail lines sit under the case line, indented past the verdict symbol. */
const detailIndent = "    ";

function indent(lines: readonly string[]): string[] {
    return lines.map((line) => (line === "" ? line : `${detailIndent}${line}`));
}

interface CaseDetailOptions {
    verbose: boolean;
    showStderr: ShowStderrMode;
    /** Prefix the tables with line numbers. */
    lineNumbers: boolean;
    /** Rows shown per block before `… N more line(s)`. */
    displayLines: number;
}

function tableBlock(
    text: string,
    header: string,
    options: CaseDetailOptions,
    styles: AnsiStyles,
): string[] {
    const { lines, omitted } = takeLines(text, options.displayLines);
    if (lines.length === 0) {
        return [];
    }

    return formatLinesTable(lines, {
        styles,
        header,
        lineNumbers: options.lineNumbers,
        omitted,
    });
}

function buildCaseDetails(
    result: TestCaseResult,
    options: CaseDetailOptions,
    styles: AnsiStyles,
    columns: number,
): string[] {
    const details = verdictDetails(result, options, styles, columns);

    if (result.stderr.trim() !== "" && shouldShowStderr(result.verdict, options.showStderr)) {
        // Standard error is printed verbatim, without color, so a compiler or
        // interpreter's own formatting stays intact.
        if (details.length > 0) {
            details.push("");
        }
        details.push(`${detailIndent}stderr:`);
        for (const line of outputLines(result.stderr)) {
            details.push(`${detailIndent}  ${line}`);
        }
    }

    return details;
}

function shouldShowStderr(verdict: CaseVerdict, mode: ShowStderrMode): boolean {
    if (mode === "never") {
        return false;
    }
    if (mode === "always") {
        return true;
    }

    return verdict !== "AC";
}

function verdictDetails(
    result: TestCaseResult,
    options: CaseDetailOptions,
    styles: AnsiStyles,
    columns: number,
): string[] {
    const blocks: string[][] = [];
    const input = result.input;
    if (input !== undefined) {
        blocks.push(tableBlock(input, "Input", options, styles));
    }

    if (result.verdict === "WA" && result.comparison !== undefined) {
        blocks.push(
            formatComparison(result.comparison, {
                styles,
                columns,
                sideBySide: styles.enabled && columns >= 100,
                lineNumbers: options.lineNumbers,
            }),
        );
    } else if (result.verdict === "UNJUDGED") {
        blocks.push(tableBlock(result.stdout, "Output", options, styles));
    } else if (options.verbose === true && result.verdict === "AC") {
        // A verbose AC run is the only time the expected output is not shown,
        // so print the actual output instead.
        blocks.push(tableBlock(result.stdout, "Output", options, styles));
    }

    const details: string[] = [];
    for (const block of blocks) {
        if (block.length === 0) {
            continue;
        }
        if (details.length > 0) {
            details.push("");
        }
        details.push(...indent(block));
    }

    return details;
}

function defaultJobCount(caseCount: number): number {
    let cpuCount = 1;
    try {
        cpuCount = availableParallelism();
    } catch {
        cpuCount = 1;
    }

    return Math.max(1, Math.min(cpuCount, caseCount));
}

export interface BuildSolutionOptions {
    projectRoot: string;
    config: Config;
    /** Command that requested the build; used to word the missing-source error. */
    command: "test" | "run";
    /** Base directory for a positional source path; defaults to the process directory. */
    cwd?: string;
    source?: string;
    language?: string;
    cache?: boolean;
    /** Test-case directory the caller already resolved for `{testdir}`. */
    testDirectory?: string;
    /** Receives the compiler's own output, without a trailing newline. */
    onCompilerOutput?: (chunk: string) => void;
    /** Receives the "compiled" line, without a trailing newline. */
    onCompiled?: (line: string) => void;
    /** Receives the "reused the cached build" line, without a trailing newline. */
    onCached?: (line: string) => void;
}

export interface BuiltSolution {
    projectRoot: string;
    language: TestLanguage;
    /** Defined when `{testdir}` was needed or the caller supplied a directory. */
    testDirectory: string | undefined;
    runTokens: string[];
    buildDirectory: string;
    outfilePath: string;
    cacheEnabled: boolean;
    buildDirectoryCreated: boolean;
}

/**
 * Resolve the source, compile it when needed, and return the command that runs it.
 *
 * Throws for configuration, source, and compile problems.
 */
export async function buildSolution(options: BuildSolutionOptions): Promise<BuiltSolution> {
    const projectRoot = await realpath(options.projectRoot);
    const languages = readLanguages(options.config);
    if (languages.size === 0) {
        throw new Error(
            'No [languages.<key>] section is defined. Add one with "source", "run", and optionally "compile".',
        );
    }

    const spec = options.source ?? options.config.test.source;
    if (spec === undefined || spec.trim() === "") {
        throw new Error(
            `No source file to ${options.command}. Set test.source in neoj.toml or run "neoj ${options.command} <source>".`,
        );
    }

    const resolved = await resolveTestSource(projectRoot, options, spec);
    const language = detectLanguage(languages, resolved.relativePath, options.language);

    const testDirectory =
        options.testDirectory ??
        ([...(language.compile ?? []), ...language.run].some((token) => token.includes("{testdir}"))
            ? await resolveTestcaseDirectory(
                  projectRoot,
                  options.config.testcase.folder,
                  options.config.src,
              )
            : undefined);

    const cacheEnabled = options.cache ?? options.config.test.cache;
    const cacheFiles = await collectCacheFiles(projectRoot, language.cacheFiles);
    const cacheFileContents = await Promise.all(
        cacheFiles.map(async (file) => ({
            relativePath: file.relativePath,
            contents: await readFile(file.absolutePath),
        })),
    );
    const buildKey = computeBuildKey({
        language,
        sourceRelativePath: resolved.relativePath,
        sourceContents: await readFile(resolved.absolutePath),
        cacheFiles: cacheFileContents,
        platform: platform(),
        arch: arch(),
    });

    const buildDirectory = join(projectRoot, ".neoj", buildDirectoryName, buildKey);
    const outfilePath = join(buildDirectory, executableBaseName);
    const placeholders: Record<PlaceholderName, string> = {
        source: resolved.absolutePath,
        outfile: outfilePath,
        outdir: buildDirectory,
        dir: projectRoot,
        testdir: testDirectory ?? "",
    };

    const label = `languages.${language.key}`;
    const compileTokens =
        language.compile === undefined
            ? undefined
            : expandTokens(language.compile, placeholders, `${label}.compile`);
    if (compileTokens !== undefined) {
        const referencesOutput = (language.compile ?? []).some(
            (token) => token.includes("{outfile}") || token.includes("{outdir}"),
        );
        if (!referencesOutput) {
            throw new Error(`${label}.compile must reference {outfile} or {outdir}.`);
        }
    }
    // Fail on unknown placeholders before running the compiler.
    expandTokens(language.run, placeholders, `${label}.run`);

    let buildDirectoryCreated = false;
    try {
        if (compileTokens !== undefined) {
            if (cacheEnabled && existsSync(resolveExecutablePath(outfilePath))) {
                options.onCached?.(
                    `Reused the cached build for ${resolved.relativePath} (${label}).`,
                );
            } else {
                await rm(buildDirectory, { recursive: true, force: true });
                await mkdir(buildDirectory, { recursive: true });
                buildDirectoryCreated = true;

                const compiled = await runCommand({
                    argv: compileTokens,
                    cwd: projectRoot,
                    timeoutMs: compileTimeoutMs,
                });
                if (compiled.timedOut || compiled.exitCode !== 0) {
                    if (compiled.stdout.trim() !== "") {
                        options.onCompilerOutput?.(compiled.stdout.trimEnd());
                    }
                    if (compiled.stderr.trim() !== "") {
                        options.onCompilerOutput?.(compiled.stderr.trimEnd());
                    }
                    throw new Error(
                        compiled.timedOut
                            ? `Compilation timed out for ${label} after 10 minutes.`
                            : `Compilation failed for ${label} (${describeExit(compiled)}).`,
                    );
                }

                options.onCompiled?.(
                    `Compiled ${resolved.relativePath} (${label}) in ${formatDuration(compiled.durationMs)}.`,
                );
            }
        } else if (language.run.some((token) => token.includes("{outdir}"))) {
            await mkdir(buildDirectory, { recursive: true });
            buildDirectoryCreated = true;
        }

        const runTokens = expandTokens(
            language.run,
            { ...placeholders, outfile: resolveExecutablePath(outfilePath) },
            `${label}.run`,
        );

        return {
            projectRoot,
            language,
            testDirectory,
            runTokens,
            buildDirectory,
            outfilePath,
            cacheEnabled,
            buildDirectoryCreated,
        };
    } catch (error) {
        if (!cacheEnabled && buildDirectoryCreated) {
            await rm(buildDirectory, { recursive: true, force: true });
        }
        throw error;
    }
}

/** Delete the build directory after a run, unless the build is cached. */
export async function cleanupBuild(solution: BuiltSolution): Promise<void> {
    if (!solution.cacheEnabled && solution.buildDirectoryCreated) {
        await rm(solution.buildDirectory, { recursive: true, force: true });
    }
}

/**
 * Build the selected source once, then run every test case and print a report.
 *
 * Throws for configuration, source, and compile problems; test failures are
 * reported through the returned exit code (`2`) instead.
 */
export async function runTests(options: RunTestsOptions): Promise<RunTestsResult> {
    const stdout = options.stdout ?? process.stdout;
    const stderr = options.stderr ?? process.stderr;
    const styles = createAnsiStyles(supportsColor(stdout));
    const columns =
        (stdout as { columns?: number }).columns === undefined
            ? 80
            : Math.max(40, (stdout as { columns?: number }).columns!);

    const projectRoot = await realpath(options.projectRoot);
    const testDirectory = await resolveTestcaseDirectory(
        projectRoot,
        options.config.testcase.folder,
        options.config.src,
    );
    const cases = await discoverTestCases(testDirectory, options.filters ?? []);

    const built = await buildSolution({
        projectRoot,
        config: options.config,
        command: "test",
        cwd: options.cwd,
        source: options.source,
        language: options.language,
        cache: options.cache,
        testDirectory,
        onCompilerOutput: (chunk) => stderr.write(`${chunk}\n`),
        onCompiled: (line) => stderr.write(`${line}\n`),
        onCached: options.verbose === true ? (line) => stderr.write(`${line}\n`) : undefined,
    });
    const language = built.language;

    const timeoutSeconds =
        options.timeoutSeconds ?? language.timeoutSeconds ?? options.config.test.timeout;
    const memoryMiB = options.memoryMiB ?? language.memoryMiB ?? options.config.test.memory;
    const comparison: ComparisonOptions = {
        ignoreTrailingSpace:
            options.ignoreTrailingSpace ?? options.config.test.ignore_trailing_space,
        ignoreTrailingNewline:
            options.ignoreTrailingNewline ?? options.config.test.ignore_trailing_newline,
    };
    const showStderr = options.showStderr ?? options.config.test.show_stderr;

    const progress = createProgressBar({
        total: cases.length,
        label: "Testing",
        stream: stderr,
        enabled: (options.progress ?? true) && stderr.isTTY === true,
    });

    try {
        const parallel = options.parallel ?? options.config.test.parallel;
        const jobCount = !parallel ? 1 : (options.jobs ?? defaultJobCount(cases.length));
        const jobLimit = Math.max(1, Math.min(jobCount, cases.length));

        const context: CaseContext = {
            projectRoot,
            runTokens: built.runTokens,
            timeoutSeconds,
            memoryMiB,
            comparison,
            verbose: options.verbose === true,
        };

        const results: TestCaseResult[] = [];
        const counters = { ac: 0, unjudged: 0, failed: 0 };
        const nameWidth = maxValue(
            cases.map((item) => item.name.length),
            0,
        );
        let nextIndex = 0;
        let firstError: unknown;
        const startedAt = performance.now();

        const worker = async (): Promise<void> => {
            while (firstError === undefined) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= cases.length) {
                    return;
                }

                const testCase = cases[index]!;
                try {
                    const result = await runTestCase(testCase, context);
                    results[index] = result;
                    if (result.verdict === "AC") {
                        counters.ac += 1;
                    } else if (result.verdict === "UNJUDGED") {
                        counters.unjudged += 1;
                    } else {
                        counters.failed += 1;
                    }

                    if (progress.enabled) {
                        progress.advance(`pass ${counters.ac} fail ${counters.failed}`);
                    }
                } catch (error) {
                    // Stop scheduling work, but let the cases already running finish
                    // before the build directory is cleaned up.
                    firstError = error;
                    return;
                }
            }
        };

        await Promise.all(Array.from({ length: jobLimit }, () => worker()));
        progress.finish();
        if (firstError !== undefined) {
            throw firstError;
        }

        const elapsed = performance.now() - startedAt;
        const detailOptions: CaseDetailOptions = {
            verbose: options.verbose === true,
            showStderr,
            lineNumbers: options.lineNumbers ?? options.config.test.show_line_numbers,
            displayLines: options.config.test.display_lines,
        };
        for (const [index, result] of results.entries()) {
            stdout.write(
                `${formatCaseLine(result, nameWidth, timeoutSeconds, memoryMiB, styles)}\n`,
            );
            for (const line of buildCaseDetails(result, detailOptions, styles, columns)) {
                stdout.write(`${line}\n`);
            }
            if (result.verdict !== "AC" && index < results.length - 1) {
                // Separate a failing case from the next one with two blank lines.
                stdout.write("\n\n");
            }
        }

        const total = results.length;
        const slowest = maxValue(
            results.map((result) => result.durationMs),
            0,
        );
        const rated = results
            .map((result) => result.maxRssBytes)
            .filter((bytes): bytes is number => bytes !== undefined);
        const peak = rated.length === 0 ? undefined : maxValue(rated);
        const summary = `${total} case(s): ${counters.ac} passed, ${counters.failed} failed, ${counters.unjudged} unjudged (${formatDuration(elapsed)}; slowest ${formatDuration(slowest)}, peak ${formatMemory(peak)}).`;
        stdout.write(`${counters.failed > 0 ? styles.red(summary) : styles.green(summary)}\n`);

        return { results, exitCode: counters.failed > 0 ? 2 : 0 };
    } finally {
        progress.finish();
        await cleanupBuild(built);
    }
}
