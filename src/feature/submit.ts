import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { confirm } from "@inquirer/prompts";
import { AtCoderClient, parseAtCoderTask, type AtCoderSubmitPage } from "@neoj/api/atcoder";
import {
    CodeforcesClient,
    extractCodeforcesProblemRoute,
    type CodeforcesSubmitPage,
} from "@neoj/api/codeforces";
import type { ProblemKey } from "@neoj/api/problem";
import {
    buildShareOjSubmissionUrl,
    decodeShareOjShortId,
    parseShareOjContestProblemUrl,
    parseShareOjProblemId,
    ShareOjApiError,
    ShareOjClient,
    type ShareOjSubmission,
} from "@neoj/api/shareoj";
import { YukicoderClient } from "@neoj/api/yukicoder";
import { consola } from "consola";

import { getAtCoderSession, loginToAtCoder } from "@/feature/login/atcoder";
import {
    getCodeforcesSession,
    loginToCodeforces,
    persistCodeforcesSession,
} from "@/feature/login/codeforces";
import { getShareOjAccessToken, loginToShareOj } from "@/feature/login/shareoj";
import { getYukicoderAuth, isYukicoderLoggedIn, loginToYukicoder } from "@/feature/login/yukicoder";
import { findProblemSource } from "@/feature/problem-sources";
import { createAnsiStyles, supportsColor, type AnsiStyles } from "@/lib/util/ansi";
import { readAuth } from "@/lib/util/auth";
import { openInBrowser } from "@/lib/util/browser";
import { formatBytes } from "@/lib/util/bytes";
import { copyToClipboard } from "@/lib/util/clipboard";
import { runCommand } from "@/lib/util/command-runner";
import { loadConfig, type Config } from "@/lib/util/config";
import { hasErrorCode } from "@/lib/util/errors";
import type { ProblemMetadata } from "@/lib/util/problem-metadata";
import { readProblemMetadata } from "@/lib/util/problem-metadata";
import type { ProgressStream } from "@/lib/util/progress";
import { requireInitializedProject } from "@/lib/util/project";
import { formatSourceLimit, sourceLimitBytes } from "@/lib/util/source-limit";
import {
    detectLanguage,
    expandTokens,
    readLanguages,
    resolveTestSource,
    type ResolvedSource,
    type TestLanguage,
} from "@/lib/util/test-runner";

export type SubmitPlatform = "atcoder" | "yukicoder" | "shareoj" | "codeforces";

export interface SubmitLanguageCandidate {
    id: string;
    name: string;
    group?: string;
    version?: string;
}

export interface SubmissionResult {
    /** Missing when the submission succeeded but its ID could not be read yet. */
    submissionId: string | undefined;
    submissionUrl: string;
}

export interface SubmissionTarget {
    platform: SubmitPlatform;
    displayName: string;
    /** Fetch submission metadata and return warnings such as Turnstile. */
    prepare(): Promise<string[]>;
    getLanguages(): Promise<SubmitLanguageCandidate[]>;
    submit(source: string, languageId: string): Promise<SubmissionResult>;
}

export interface CreateTargetInput {
    platform: SubmitPlatform;
    problemUrl: string;
    displayName: string;
    config: Config;
    /** The problem key recorded at download time (ShareOJ contest URLs). */
    problemKey?: ProblemKey;
}

export interface SubmitDependencies {
    confirm?: (options: { message: string; default: boolean }) => Promise<boolean>;
    copyToClipboard?: (text: string) => Promise<boolean>;
    openInBrowser?: (url: string) => Promise<boolean>;
    sleep?: (milliseconds: number) => Promise<void>;
    warn?: (message: string) => void;
    info?: (message: string) => void;
    createTarget?: (input: CreateTargetInput) => Promise<SubmissionTarget | undefined>;
}

export interface WaitBeforeSubmitOptions {
    stream?: ProgressStream;
    sleep?: (milliseconds: number) => Promise<void>;
    intervalMs?: number;
}

export interface PrepareSubmissionOptions {
    projectRoot: string;
    source: ResolvedSource;
    language: TestLanguage;
    timeoutSeconds: number;
    platform: string;
    problemUrl: string;
}

const presubmitOutputLimitBytes = 8 * 1024 * 1024;

/** Split submitted text into lines without inventing a line for a final newline. */
export function splitSourceLines(text: string): string[] {
    const normalized = text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
    if (normalized === "") {
        return [];
    }

    const lines = normalized.split("\n");
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }

    return lines;
}

function numberLines(
    lines: readonly string[],
    firstLineNumber: number,
    totalLines: number,
    styles: AnsiStyles,
): string[] {
    const width = String(totalLines).length;
    return lines.map(
        (line, index) =>
            `${styles.dim(String(firstLineNumber + index).padStart(width))} ${styles.dim("│")} ${line}`,
    );
}

/** Render the head and tail of a submission, with real line numbers. */
export function formatSubmitPreview(
    text: string,
    previewLines: number,
    styles: AnsiStyles = createAnsiStyles(false),
): string[] {
    const lines = splitSourceLines(text);
    const limit = Math.max(1, Math.floor(previewLines));
    const total = lines.length;
    if (total === 0) {
        return ["(empty)"];
    }
    if (total <= limit * 2) {
        return numberLines(lines, 1, total, styles);
    }

    return [
        ...numberLines(lines.slice(0, limit), 1, total, styles),
        "...",
        ...numberLines(lines.slice(-limit), total - limit + 1, total, styles),
    ];
}

/** A one-line description of the submitted text's size. */
export function describeSubmissionSize(text: string): string {
    const lines = splitSourceLines(text).length;
    return `${lines} line(s), ${formatBytes(Buffer.byteLength(text, "utf8"))}`;
}

function formatSeconds(seconds: number): string {
    return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

function renderWaitBar(remainingMs: number, totalMs: number): string {
    const width = 20;
    const ratio = totalMs === 0 ? 1 : 1 - remainingMs / totalMs;
    const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
    const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
    return `\rSubmitting in ${(remainingMs / 1000).toFixed(1)}s [${bar}]`;
}

/**
 * Wait before submitting. A terminal shows a live bar on standard error; a
 * pipe gets one plain line so captured output stays readable.
 */
export async function waitBeforeSubmit(
    seconds: number,
    options: WaitBeforeSubmitOptions = {},
): Promise<void> {
    if (!(seconds > 0)) {
        return;
    }

    const stream = options.stream ?? process.stderr;
    if (stream.isTTY !== true) {
        stream.write(`Waiting ${formatSeconds(seconds)} seconds before submitting...\n`);
        return;
    }

    const sleep =
        options.sleep ??
        ((milliseconds: number) =>
            new Promise<void>((resolve) => {
                setTimeout(resolve, milliseconds);
            }));
    const intervalMs = options.intervalMs ?? 100;
    const totalMs = seconds * 1000;
    let remainingMs = totalMs;

    try {
        while (remainingMs > 0) {
            stream.write(renderWaitBar(remainingMs, totalMs));
            const delay = Math.min(intervalMs, remainingMs);
            await sleep(delay);
            remainingMs -= delay;
        }
    } finally {
        stream.write("\r\u001B[K");
    }
}

/** List platform languages in a form suitable for a configuration error. */
export function formatLanguageCandidates(languages: readonly SubmitLanguageCandidate[]): string {
    if (languages.length === 0) {
        return "  (the platform returned no languages)";
    }

    return languages
        .map((language) => {
            const extra = [language.group, language.version].filter(
                (value): value is string => value !== undefined && value !== "",
            );
            const detail = extra.length === 0 ? "" : ` (${extra.join(", ")})`;
            return `  - ${language.id}: ${language.name}${detail}`;
        })
        .join("\n");
}

/**
 * Pick the platform language ID.
 *
 * `--platform-language` wins, then `[languages.<key>.submit]`. When neither is
 * set, the available languages are listed instead of prompting, so scripts can
 * rely on a deterministic failure.
 */
export async function resolveSubmitLanguage(
    language: Pick<TestLanguage, "key" | "submit">,
    platform: string,
    platformLanguage: string | undefined,
    getLanguages: () => Promise<readonly SubmitLanguageCandidate[]>,
): Promise<string> {
    const explicit = platformLanguage?.trim();
    if (explicit !== undefined && explicit !== "") {
        return explicit;
    }

    const configured = language.submit[platform]?.trim();
    if (configured !== undefined && configured !== "") {
        return configured;
    }

    const languages = await getLanguages();
    throw new Error(
        `languages.${language.key}.submit.${platform} is not set. Set it to one of:\n${formatLanguageCandidates(languages)}`,
    );
}

function describeExit(result: { exitCode: number | null; signal: string | null }): string {
    if (result.signal !== null) {
        return `killed by ${result.signal}`;
    }

    return `exit code ${result.exitCode ?? "unknown"}`;
}

function isEmptyOutput(text: string): boolean {
    return text.trim().length === 0;
}

/**
 * Run the language's presubmit command and return the text to submit.
 *
 * Without a presubmit command the source file is submitted unchanged. The
 * original file is never modified: `{outfile}` points into a temporary
 * directory that is removed even when the command fails.
 */
export async function prepareSubmissionSource(options: PrepareSubmissionOptions): Promise<string> {
    const presubmit = options.language.presubmit;
    if (presubmit === undefined) {
        return await readFile(options.source.absolutePath, "utf8");
    }

    const temporaryDirectory = await mkdtemp(join(tmpdir(), "neoj-submit-"));
    const usesOutfile = presubmit.some((token) => token.includes("{outfile}"));
    try {
        const outfile = join(
            temporaryDirectory,
            `submission${extname(options.source.absolutePath)}`,
        );
        const argv = expandTokens(
            presubmit,
            {
                source: options.source.absolutePath,
                outfile,
                outdir: temporaryDirectory,
                dir: options.projectRoot,
                testdir: "",
            },
            `languages.${options.language.key}.presubmit`,
        );
        const result = await runCommand({
            argv,
            cwd: options.projectRoot,
            timeoutMs: options.timeoutSeconds * 1000,
            outputLimitBytes: presubmitOutputLimitBytes,
            env: {
                ...process.env,
                NEOJ_PLATFORM: options.platform,
                NEOJ_PROBLEM_URL: options.problemUrl,
                NEOJ_LANGUAGE: options.language.key,
            },
        });

        if (result.outputLimitExceeded) {
            throw new Error("The presubmit command produced too much output.");
        }
        if (result.timedOut) {
            throw new Error(
                `The presubmit command timed out after ${formatSeconds(options.timeoutSeconds)} seconds.`,
            );
        }
        if (result.exitCode !== 0) {
            const stderr = result.stderr.trim();
            throw new Error(
                `The presubmit command failed (${describeExit(result)}).${stderr === "" ? "" : `\n${stderr}`}`,
            );
        }

        if (!usesOutfile) {
            if (isEmptyOutput(result.stdout)) {
                throw new Error("The presubmit command produced no output.");
            }
            return result.stdout;
        }

        let outputStat;
        try {
            outputStat = await stat(outfile);
        } catch (error) {
            if (hasErrorCode(error, "ENOENT")) {
                throw new Error(
                    `The presubmit command did not create the output file "${outfile}".`,
                );
            }
            throw error;
        }
        if (!outputStat.isFile()) {
            throw new Error(`The presubmit output "${outfile}" is not a regular file.`);
        }
        if (outputStat.size === 0) {
            throw new Error("The presubmit command produced no output.");
        }

        return await readFile(outfile, "utf8");
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
}

function toSubmitPlatform(name: string): SubmitPlatform {
    if (name === "atcoder" || name === "yukicoder" || name === "shareoj" || name === "codeforces") {
        return name;
    }

    throw new TypeError(`Submissions are not supported for "${name}".`);
}

/** Warnings that do not need the network. */
export function getOfflineSubmitWarnings(context: {
    platform: SubmitPlatform;
    problemUrl: string;
    metadata: ProblemMetadata;
    now?: Temporal.Instant;
}): string[] {
    if (context.platform !== "atcoder") {
        return [];
    }

    const warnings: string[] = [];
    const { contestId } = parseAtCoderTask(context.problemUrl);
    if (contestId.startsWith("adt_")) {
        warnings.push(
            "This is an AtCoder Daily Training contest, where Turnstile may block automatic submission. If the request is rejected, submit from the browser.",
        );
    }

    const range = context.metadata.contestrange;
    if (range !== undefined) {
        try {
            const now = context.now ?? Temporal.Now.instant();
            const start = Temporal.Instant.from(range.start);
            const end = Temporal.Instant.from(range.end);
            if (
                Temporal.Instant.compare(now, start) < 0 ||
                Temporal.Instant.compare(now, end) > 0
            ) {
                warnings.push(
                    `The contest window is ${range.start} to ${range.end}. Automatic submission outside it may be blocked by Turnstile; if the request is rejected, submit from the browser.`,
                );
            }
        } catch {
            // Malformed metadata should not prevent a submission attempt.
        }
    }

    return warnings;
}

async function createDefaultTarget(
    input: CreateTargetInput,
): Promise<SubmissionTarget | undefined> {
    if (input.platform === "atcoder") {
        return await createAtCoderTarget(input);
    }
    if (input.platform === "codeforces") {
        return await createCodeforcesTarget(input);
    }
    if (input.platform === "shareoj") {
        return await createShareOjTarget(input);
    }

    return await createYukicoderTarget(input);
}

async function createCodeforcesTarget(
    input: CreateTargetInput,
): Promise<SubmissionTarget | undefined> {
    const client = new CodeforcesClient();
    let savedSession = getCodeforcesSession((await readAuth()).codeforces);
    // Keep the cookies that were on disk before this run so a rotation during
    // validation is saved too.
    const initialSession = savedSession;
    let loggedIn = savedSession === undefined ? false : await client.login(savedSession);

    if (!loggedIn) {
        if (!input.config.login.auto_login) {
            throw new Error(
                'Not logged in to Codeforces. Run "neoj login codeforces" or set login.auto_login = true.',
            );
        }

        const accepted = await loginToCodeforces();
        if (!accepted) {
            return undefined;
        }

        savedSession = getCodeforcesSession((await readAuth()).codeforces);
        if (savedSession === undefined || !(await client.login(savedSession))) {
            throw new Error(
                'Codeforces login did not produce a valid session. Run "neoj login codeforces" and try again.',
            );
        }
    }

    // Codeforces rotates its session cookies. Persist the current values so the
    // next command does not need a new login; failing to save must not turn a
    // successful submission into an error.
    const persistSession = async (): Promise<void> => {
        await persistCodeforcesSession(client, initialSession);
    };
    await persistSession();

    // Reject a problem URL that cannot be mapped to a contest before asking
    // the user for anything else.
    extractCodeforcesProblemRoute(input.problemUrl);
    let page: CodeforcesSubmitPage | undefined;
    return {
        platform: "codeforces",
        displayName: input.displayName,
        async prepare() {
            page = await client.getSubmitPage(input.problemUrl);
            await persistSession();
            return [];
        },
        async getLanguages() {
            return (await (page ?? client.getSubmitPage(input.problemUrl))).languages.map(
                (language) => ({
                    id: language.id,
                    name: language.name,
                }),
            );
        },
        async submit(source, languageId) {
            const result = await client.submit(input.problemUrl, languageId, source, page);
            await persistSession();
            return result;
        },
    };
}

async function createAtCoderTarget(
    input: CreateTargetInput,
): Promise<SubmissionTarget | undefined> {
    const client = new AtCoderClient();
    const auth = await readAuth();
    const savedSession = getAtCoderSession(auth.atcoder);
    let loggedIn = savedSession === undefined ? false : await client.login(savedSession);

    if (!loggedIn) {
        if (!input.config.login.auto_login) {
            throw new Error(
                'Not logged in to AtCoder. Run "neoj login atcoder" or set login.auto_login = true.',
            );
        }

        const accepted = await loginToAtCoder();
        if (!accepted) {
            return undefined;
        }

        const newSession = getAtCoderSession((await readAuth()).atcoder);
        if (newSession === undefined || !(await client.login(newSession))) {
            throw new Error(
                'AtCoder login did not produce a valid session. Run "neoj login atcoder" and try again.',
            );
        }
    }

    let page: AtCoderSubmitPage | undefined;
    return {
        platform: "atcoder",
        displayName: input.displayName,
        async prepare() {
            page = await client.getSubmitPage(input.problemUrl);
            return page.hasTurnstile
                ? [
                      "AtCoder returned a Turnstile challenge on the submit page. Automatic submission may be rejected; if that happens, submit from the browser.",
                  ]
                : [];
        },
        async getLanguages() {
            return (await client.getLanguages(input.problemUrl)).map((language) => ({
                id: language.id,
                name: language.name,
                group: language.group,
            }));
        },
        async submit(source, languageId) {
            return await client.submit(input.problemUrl, languageId, source, page);
        },
    };
}

async function createShareOjTarget(
    input: CreateTargetInput,
): Promise<SubmissionTarget | undefined> {
    const client = new ShareOjClient();
    const auth = await readAuth();
    let token = await getShareOjAccessToken(auth.shareoj, client);

    if (token === undefined) {
        if (!input.config.login.auto_login) {
            throw new Error(
                'Not logged in to ShareOJ. Run "neoj login shareoj" or set login.auto_login = true.',
            );
        }

        const accepted = await loginToShareOj();
        if (!accepted) {
            return undefined;
        }

        token = await getShareOjAccessToken((await readAuth()).shareoj, client);
        if (token === undefined) {
            throw new Error(
                'ShareOJ login did not save a credential. Run "neoj login shareoj" and try again.',
            );
        }
    }
    const accessToken = token;

    // The problem ID is the UUID the API accepted at download time. A direct
    // problem URL can be decoded offline; a contest URL relies on the stored key.
    let problemId: string;
    try {
        problemId =
            input.problemKey !== undefined
                ? decodeShareOjShortId(input.problemKey.slug)
                : parseShareOjProblemId(input.problemUrl);
    } catch {
        throw new Error(
            `Could not determine the ShareOJ problem ID from "${input.problemUrl}". Run "neoj download ${input.problemUrl}" again to record it.`,
        );
    }

    let contestShortId: string | undefined;
    try {
        contestShortId = parseShareOjContestProblemUrl(input.problemUrl).contestShortId;
    } catch {
        contestShortId = undefined;
    }
    const contestId =
        contestShortId === undefined ? undefined : decodeShareOjShortId(contestShortId);

    return {
        platform: "shareoj",
        displayName: input.displayName,
        async prepare() {
            return [];
        },
        async getLanguages() {
            return (await client.getRuntimes()).map((runtime) => ({
                id: runtime.id,
                name: runtime.label,
            }));
        },
        async submit(source, languageId) {
            const post = (credential: string) =>
                client.submit(credential, {
                    problemId,
                    contestId,
                    runtime: languageId,
                    source,
                });

            let submission: ShareOjSubmission;
            try {
                submission = await post(accessToken);
            } catch (error) {
                // The access token may have expired since it was read.
                if (!(error instanceof ShareOjApiError) || error.status !== 401) {
                    throw error;
                }
                const renewed = await getShareOjAccessToken((await readAuth()).shareoj, client);
                if (renewed === undefined) {
                    throw new Error(
                        'The ShareOJ session has expired. Run "neoj login shareoj" and try again.',
                        { cause: error },
                    );
                }
                submission = await post(renewed);
            }

            return {
                submissionId: submission.id,
                submissionUrl: buildShareOjSubmissionUrl(submission.id, contestShortId),
            };
        },
    };
}

async function createYukicoderTarget(
    input: CreateTargetInput,
): Promise<SubmissionTarget | undefined> {
    const client = new YukicoderClient();
    const auth = await readAuth();
    let savedAuth = getYukicoderAuth(auth.yukicoder);
    let loggedIn = savedAuth !== undefined && (await isYukicoderLoggedIn(savedAuth));

    if (!loggedIn) {
        if (!input.config.login.auto_login) {
            throw new Error(
                'Not logged in to yukicoder. Run "neoj login yukicoder" or set login.auto_login = true.',
            );
        }

        const accepted = await loginToYukicoder();
        if (!accepted) {
            return undefined;
        }

        savedAuth = getYukicoderAuth((await readAuth()).yukicoder);
        if (savedAuth === undefined) {
            throw new Error(
                'yukicoder login did not save a credential. Run "neoj login yukicoder" and try again.',
            );
        }
    }

    const credential =
        savedAuth === undefined
            ? undefined
            : savedAuth.method === "token"
              ? savedAuth.token
              : savedAuth.apiKey;
    if (credential === undefined) {
        throw new Error(
            'yukicoder login did not save a credential. Run "neoj login yukicoder" and try again.',
        );
    }
    return {
        platform: "yukicoder",
        displayName: input.displayName,
        async prepare() {
            return [];
        },
        async getLanguages() {
            return (await client.getLanguages()).map((language) => ({
                id: language.id,
                name: language.name,
                version: language.version,
            }));
        },
        async submit(source, languageId) {
            return await client.submit(input.problemUrl, credential, languageId, source);
        },
    };
}

export interface RunSubmitOptions {
    projectRoot: string;
    config: Config;
    cwd: string;
    source?: string;
    language?: string;
    platformLanguage?: string;
    yes?: boolean;
    /** `0` submits immediately; undefined uses `submit.wait`. */
    waitSeconds?: number;
    /** `false` skips the presubmit command. */
    presubmit?: boolean;
    dryRun?: boolean;
    /** Submit even when the source is over the platform's documented limit. */
    ignoreLimit?: boolean;
    /** undefined uses `submit.open`. */
    open?: boolean;
    stdout?: ProgressStream;
    stderr?: ProgressStream;
    dependencies?: SubmitDependencies;
    now?: Temporal.Instant;
}

export interface SubmitResult {
    status: "submitted" | "cancelled" | "dry-run";
    submissionId?: string;
    submissionUrl?: string;
}

export async function runSubmit(options: RunSubmitOptions): Promise<SubmitResult> {
    const platformLanguage = options.platformLanguage?.trim();
    if (options.dryRun === true && platformLanguage !== undefined && platformLanguage !== "") {
        throw new Error("--dry-run cannot be combined with --platform-language.");
    }

    const stdout = options.stdout ?? process.stdout;
    const stderr = options.stderr ?? process.stderr;
    const styles = createAnsiStyles(supportsColor(stdout));
    const dependencies = options.dependencies ?? {};
    const warn = dependencies.warn ?? ((message: string) => consola.warn(message));
    const info = dependencies.info ?? ((message: string) => consola.info(message));

    const metadata = await readProblemMetadata(options.projectRoot);
    if (metadata === undefined) {
        throw new Error('No problem is recorded. Run "neoj download <url>" first.');
    }

    const problemSource = findProblemSource(metadata.url);
    const platform = toSubmitPlatform(problemSource.name);
    const languages = readLanguages(options.config);
    if (languages.size === 0) {
        throw new Error(
            'No [languages.<key>] section is defined. Add one with "source" and "run".',
        );
    }

    const spec = options.source ?? options.config.test.source;
    if (spec === undefined || spec.trim() === "") {
        throw new Error(
            'No source file to submit. Set test.source in neoj.toml or run "neoj submit <source>".',
        );
    }

    const resolved = await resolveTestSource(
        options.projectRoot,
        { source: options.source, cwd: options.cwd, config: options.config },
        spec,
    );
    const language = detectLanguage(languages, resolved.relativePath, options.language);

    const content =
        options.presubmit === false || language.presubmit === undefined
            ? await readFile(resolved.absolutePath, "utf8")
            : await prepareSubmissionSource({
                  projectRoot: options.projectRoot,
                  source: resolved,
                  language,
                  timeoutSeconds: options.config.submit.presubmit_timeout,
                  platform,
                  problemUrl: metadata.url,
              });
    if (isEmptyOutput(content)) {
        throw new Error(`"${resolved.relativePath}" is empty, so there is nothing to submit.`);
    }

    // The limit applies to the text that is sent, after the presubmit command.
    const sourceBytes = Buffer.byteLength(content, "utf8");
    const sourceLimit = sourceLimitBytes[platform];
    if (sourceBytes > sourceLimit) {
        const limitLabel = formatSourceLimit(platform);
        if (options.ignoreLimit === true) {
            info(
                `Skipped the source size check (--ignore-limit): ${formatBytes(sourceBytes)} for a ${limitLabel} limit.`,
            );
        } else if (options.config.submit.check_limit === false) {
            info(
                `Skipped the source size check (submit.check_limit = false): ${formatBytes(sourceBytes)} for a ${limitLabel} limit.`,
            );
        } else {
            throw new Error(
                `The source is ${formatBytes(sourceBytes)} (${sourceBytes.toLocaleString("en-US")} bytes), over the ${problemSource.displayName} limit of ${limitLabel} (${sourceLimit.toLocaleString("en-US")} bytes). Shorten it by at least ${formatBytes(sourceBytes - sourceLimit)}, or pass --ignore-limit to submit anyway.`,
            );
        }
    }

    if (options.dryRun !== true && options.config.submit.clip === "always") {
        const copied = await (dependencies.copyToClipboard ?? copyToClipboard)(content);
        if (!copied) {
            warn("Could not copy the source to the clipboard; continuing with the submission.");
        }
    }

    stdout.write(
        `Submitting ${resolved.relativePath} (languages.${language.key}, ${problemSource.displayName})\n`,
    );
    stdout.write(`${describeSubmissionSize(content)}\n\n`);
    for (const line of formatSubmitPreview(content, options.config.submit.preview_lines, styles)) {
        stdout.write(`${line}\n`);
    }
    stdout.write("\n");

    for (const warning of getOfflineSubmitWarnings({
        platform,
        problemUrl: metadata.url,
        metadata,
        now: options.now,
    })) {
        warn(warning);
    }

    if (options.dryRun === true) {
        return { status: "dry-run" };
    }

    if (options.yes !== true && options.config.submit.confirm) {
        const accepted = await (dependencies.confirm ?? confirm)({
            message: `Submit ${resolved.relativePath} to ${problemSource.displayName}?`,
            default: false,
        });
        if (!accepted) {
            info("Submission cancelled.");
            return { status: "cancelled" };
        }
    }

    await waitBeforeSubmit(options.waitSeconds ?? options.config.submit.wait, {
        stream: stderr,
        sleep: dependencies.sleep,
    });

    const target = await (dependencies.createTarget ?? createDefaultTarget)({
        platform,
        problemUrl: metadata.url,
        displayName: problemSource.displayName,
        config: options.config,
        problemKey: metadata.key,
    });
    if (target === undefined) {
        info("Login cancelled.");
        return { status: "cancelled" };
    }

    for (const warning of await target.prepare()) {
        warn(warning);
    }

    try {
        const languageId = await resolveSubmitLanguage(
            language,
            target.platform,
            platformLanguage,
            () => target.getLanguages(),
        );
        const result = await target.submit(content, languageId);

        info(
            result.submissionId === undefined
                ? `Submitted to ${target.displayName}.`
                : `Submitted to ${target.displayName} (ID: ${result.submissionId}).`,
        );
        stdout.write(`${result.submissionUrl}\n`);

        const shouldOpen = options.open ?? options.config.submit.open;
        if (shouldOpen) {
            const opened = await (dependencies.openInBrowser ?? openInBrowser)(
                result.submissionUrl,
            );
            if (!opened) {
                warn(
                    `Could not open the browser automatically. Open this URL manually: ${result.submissionUrl}`,
                );
            }
        }

        return {
            status: "submitted",
            submissionId: result.submissionId,
            submissionUrl: result.submissionUrl,
        };
    } catch (error) {
        if (options.config.submit.clip === "fail") {
            const copied = await (dependencies.copyToClipboard ?? copyToClipboard)(content);
            if (copied) {
                warn("Copied the source to the clipboard so you can submit it in the browser.");
            } else {
                warn("Could not copy the source to the clipboard.");
            }
        }

        throw error;
    }
}

function parseWaitSeconds(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new InvalidArgumentError(
            `Expected a non-negative number of seconds, got "${value}".`,
        );
    }

    return parsed;
}

export function createSubmitCommand(): Command<[string | undefined]> {
    return new Command("submit")
        .alias("s")
        .alias("submits")
        .description("Submit the solution for the current problem")
        .argument("[source]", "Source file to submit (defaults to test.source)")
        .option("-l, --language <key>", "Language definition to use")
        .option("-p, --platform-language <id>", "Platform language ID to submit as")
        .option("--yes", "Skip the confirmation prompt")
        .option("--wait <seconds>", "Seconds to wait before submitting", parseWaitSeconds)
        .option("--no-wait", "Submit immediately")
        .option("--no-presubmit", "Submit the source file without running presubmit")
        .option("--dry-run", "Show the preview without contacting the platform")
        .option("--ignore-limit", "Submit even when the source is over the platform's limit")
        .option("--open", "Open the submission page after submitting")
        .option("--no-open", "Do not open the submission page")
        .action(async (source, options) => {
            try {
                const projectRoot = await requireInitializedProject(process.cwd());
                const config = await loadConfig();
                const result = await runSubmit({
                    projectRoot,
                    config,
                    cwd: process.cwd(),
                    source,
                    language: options.language,
                    platformLanguage: options.platformLanguage,
                    yes: options.yes,
                    waitSeconds: options.wait === false ? 0 : options.wait,
                    presubmit: options.presubmit,
                    dryRun: options.dryRun,
                    ignoreLimit: options.ignoreLimit,
                    open: options.open,
                    stdout: process.stdout,
                    stderr: process.stderr,
                });
                if (result.status === "cancelled") {
                    return;
                }
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
