import { dirname, resolve } from "node:path";

import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { getAtCoderSession, loginToAtCoder } from "@/feature/login/atcoder";
import { findProblemSource } from "@/feature/problem-sources";
import { AtCoderClient, parseAtCoderTask } from "@/lib/service/atcoder";
import { YukicoderClient } from "@/lib/service/yukicoder";
import { readAuth } from "@/lib/util/auth";
import { loadConfig, type Config } from "@/lib/util/config";
import { maxValue } from "@/lib/util/numbers";
import { readProblemMetadata, type ProblemMetadata } from "@/lib/util/problem-metadata";
import type { ProgressStream } from "@/lib/util/progress";
import { findProjectConfig } from "@/lib/util/project";

export const fallbackAtCoderContestId = "abc100";

export type LanguagePlatform = "atcoder" | "yukicoder";

/** One selectable language on a platform. */
export interface PlatformLanguage {
    id: string;
    name: string;
    /** AtCoder's option group or yukicoder's runtime version. */
    detail?: string;
}

/** How one platform's language list is fetched. */
export interface LanguageTarget {
    platform: LanguagePlatform;
    displayName: string;
    /** Contest ID or other context shown after the display name. */
    context?: string;
    list(): Promise<readonly PlatformLanguage[]>;
}

export interface CreateLanguageTargetInput {
    platform: LanguagePlatform;
    /** Contest to query for AtCoder; undefined falls back to `abc100`. */
    contestId: string | undefined;
    fallback: boolean;
    config: Config;
}

export interface LanguagesDependencies {
    createTarget?: (input: CreateLanguageTargetInput) => Promise<LanguageTarget | undefined>;
    info?: (message: string) => void;
}

export interface RunLanguagesOptions {
    config: Config;
    cwd: string;
    /** Positional platform name; undefined uses the current problem. */
    platform?: string;
    filter?: string;
    stdout?: ProgressStream;
    dependencies?: LanguagesDependencies;
}

export type RunLanguagesResult =
    | { status: "cancelled" }
    | { status: "listed"; platform: LanguagePlatform; count: number };

export interface LanguageListing {
    displayName: string;
    context: string | undefined;
    platform: LanguagePlatform;
    languages: readonly PlatformLanguage[];
    configuredIds: ReadonlySet<string>;
    configuredKeys: readonly string[];
    filter: string | undefined;
}

export function parseLanguagePlatform(value: string): LanguagePlatform {
    const name = value.trim();
    if (name === "atcoder" || name === "yukicoder") {
        return name;
    }

    throw new Error(`Unsupported platform "${value}". Supported platforms: atcoder, yukicoder.`);
}

export function resolveLanguagesPlatform(
    platform: string | undefined,
    metadata: ProblemMetadata | undefined,
): LanguagePlatform {
    if (platform !== undefined) {
        return parseLanguagePlatform(platform);
    }
    if (metadata === undefined) {
        throw new Error(
            'No problem is recorded. Pass a platform: "neoj languages atcoder" or "neoj languages yukicoder".',
        );
    }

    return parseLanguagePlatform(findProblemSource(metadata.url).name);
}

/** Platform IDs already configured for `neoj submit`, and the keys that set them. */
export function collectConfiguredLanguageIds(
    config: Config,
    platform: LanguagePlatform,
): { ids: Set<string>; keys: string[] } {
    const ids = new Set<string>();
    const keys: string[] = [];
    for (const [key, language] of Object.entries(config.languages)) {
        const id = language.submit?.[platform]?.trim();
        if (id === undefined || id === "") {
            continue;
        }

        ids.add(id);
        keys.push(key);
    }

    return { ids, keys };
}

/** Case-insensitive substring match over the ID, name, and detail. */
export function filterPlatformLanguages(
    languages: readonly PlatformLanguage[],
    filter: string | undefined,
): PlatformLanguage[] {
    const needle = filter?.trim().toLowerCase();
    if (needle === undefined || needle === "") {
        return [...languages];
    }

    return languages.filter((language) =>
        [language.id, language.name, language.detail ?? ""].some((value) =>
            value.toLowerCase().includes(needle),
        ),
    );
}

function languageLabel(language: PlatformLanguage): string {
    return language.detail === undefined || language.detail === ""
        ? language.name
        : `${language.name} (${language.detail})`;
}

/** Render the listing as an aligned table with a marker for configured IDs. */
export function formatLanguageListing(listing: LanguageListing): string[] {
    const header =
        listing.context === undefined
            ? listing.displayName
            : `${listing.displayName} (${listing.context})`;
    const lines = [header];

    if (listing.languages.length === 0) {
        lines.push(
            listing.filter === undefined || listing.filter.trim() === ""
                ? "The platform returned no languages."
                : `No languages matched "${listing.filter}".`,
        );
        return lines;
    }

    const idWidth = maxValue(
        listing.languages.map((language) => language.id.length),
        2,
    );
    const textWidth = maxValue(
        listing.languages.map((language) => languageLabel(language).length),
        "Language".length,
    );

    lines.push(`  ${"ID".padEnd(idWidth)}  Language`);
    for (const language of listing.languages) {
        const marker = listing.configuredIds.has(language.id) ? "  *" : "";
        lines.push(
            `  ${language.id.padEnd(idWidth)}  ${languageLabel(language).padEnd(textWidth)}${marker}`.trimEnd(),
        );
    }

    lines.push("");
    if (listing.configuredKeys.length === 0) {
        lines.push(
            `No ID is configured. Add languages.<key>.submit.${listing.platform} in neoj.toml, or run "neoj submit --platform-language <id>".`,
        );
    } else {
        const keys = listing.configuredKeys.map(
            (key) => `languages.${key}.submit.${listing.platform}`,
        );
        lines.push(`* matches ${keys.join(", ")} in neoj.toml.`);
    }

    return lines;
}

function atCoderContestId(metadata: ProblemMetadata | undefined): string | undefined {
    if (metadata === undefined) {
        return undefined;
    }

    try {
        return parseAtCoderTask(metadata.url).contestId;
    } catch {
        return undefined;
    }
}

async function createAtCoderLanguageTarget(
    input: CreateLanguageTargetInput,
): Promise<LanguageTarget | undefined> {
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

    const contestId = input.contestId ?? fallbackAtCoderContestId;
    return {
        platform: "atcoder",
        displayName: "AtCoder",
        context: input.fallback
            ? `${contestId}, fallback contest because no AtCoder problem is recorded`
            : contestId,
        async list() {
            return (await client.getLanguagesForContest(contestId)).map((language) => ({
                id: language.id,
                name: language.name,
                detail: language.group,
            }));
        },
    };
}

async function createYukicoderLanguageTarget(): Promise<LanguageTarget> {
    const client = new YukicoderClient();
    return {
        platform: "yukicoder",
        displayName: "yukicoder",
        async list() {
            return (await client.getLanguages()).map((language) => ({
                id: language.id,
                name: language.name,
                detail: language.version,
            }));
        },
    };
}

async function createDefaultLanguageTarget(
    input: CreateLanguageTargetInput,
): Promise<LanguageTarget | undefined> {
    if (input.platform === "atcoder") {
        return await createAtCoderLanguageTarget(input);
    }

    return await createYukicoderLanguageTarget();
}

export async function runLanguages(options: RunLanguagesOptions): Promise<RunLanguagesResult> {
    const stdout = options.stdout ?? process.stdout;
    const dependencies = options.dependencies ?? {};
    const info = dependencies.info ?? ((message: string) => consola.info(message));

    const configPath = await findProjectConfig(options.cwd);
    const projectRoot = configPath === undefined ? resolve(options.cwd) : dirname(configPath);
    const metadata = await readProblemMetadata(projectRoot);
    const platform = resolveLanguagesPlatform(options.platform, metadata);
    const contestId = platform === "atcoder" ? atCoderContestId(metadata) : undefined;
    const fallback = platform === "atcoder" && contestId === undefined;

    const target = await (dependencies.createTarget ?? createDefaultLanguageTarget)({
        platform,
        contestId,
        fallback,
        config: options.config,
    });
    if (target === undefined) {
        info("Login cancelled.");
        return { status: "cancelled" };
    }

    const languages = filterPlatformLanguages(await target.list(), options.filter);
    const configured = collectConfiguredLanguageIds(options.config, platform);
    const lines = formatLanguageListing({
        displayName: target.displayName,
        context: target.context,
        platform,
        languages,
        configuredIds: configured.ids,
        configuredKeys: configured.keys,
        filter: options.filter,
    });
    stdout.write(`${lines.join("\n")}\n`);

    return { status: "listed", platform, count: languages.length };
}

export function createLanguagesCommand(): Command<[string | undefined]> {
    return new Command("languages")
        .alias("langs")
        .description("List the language IDs a platform accepts")
        .argument("[platform]", "Platform name: atcoder or yukicoder")
        .option("--filter <text>", "Show only languages matching this text")
        .action(async (platform, options) => {
            try {
                const config = await loadConfig();
                const result = await runLanguages({
                    config,
                    cwd: process.cwd(),
                    platform,
                    filter: options.filter,
                    stdout: process.stdout,
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
