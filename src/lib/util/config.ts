import { homedir } from "node:os";
import { join } from "node:path";

import * as v from "valibot";

import { findProjectConfig } from "./project";

const testcaseFilenameSchema = v.pipe(
    v.string(),
    v.metadata({
        pattern: '^[^<>:"/\\\\|?*{}]*\\{\\}[^<>:"/\\\\|?*{}]*$',
        description:
            "Base name for each sample file. Must contain exactly one {} that is replaced by the sample number.",
    }),
    v.check((pattern) => {
        const invalidFileNameCharacters = '<>:"/\\|?*';
        return (
            pattern.split("{}").length === 2 &&
            !Array.from(pattern).some(
                (character) =>
                    invalidFileNameCharacters.includes(character) || character.charCodeAt(0) < 32,
            )
        );
    }, "testcase.filename must contain exactly one {} and be a file name."),
);

/** How much of the program's standard error `neoj test` prints. */
export const showStderrModes = ["always", "failure", "never"] as const;

export type ShowStderrMode = (typeof showStderrModes)[number];

const aliasNameSchema = v.pipe(
    v.string(),
    v.metadata({
        pattern: "^(?!\\.{1,2}$)[^/\\\\]+$",
        description: 'Alias name. Must not be ".", "..", or contain a path separator.',
    }),
    v.minLength(1),
    v.check(
        (name) => name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\"),
        'Alias names must not be ".", "..", or contain a path separator.',
    ),
);

const globListSchema = v.union([
    v.pipe(v.string(), v.minLength(1)),
    v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1)),
]);

const languageSchema = v.pipe(
    v.strictObject({
        source: v.pipe(
            globListSchema,
            v.description(
                "Glob (or globs) that select the files written in this language, relative to the project root.",
            ),
        ),
        compile: v.optional(
            v.pipe(
                v.array(v.pipe(v.string(), v.minLength(1))),
                v.description(
                    "Command and arguments that build {source} into {outfile} or {outdir}. Omit it for interpreted languages.",
                ),
            ),
        ),
        run: v.pipe(
            v.array(v.pipe(v.string(), v.minLength(1))),
            v.minLength(1),
            v.description("Command and arguments that run the program."),
        ),
        timeout: v.optional(
            v.pipe(
                v.number(),
                v.minValue(0.001),
                v.description("Time limit for this language in seconds."),
            ),
        ),
        memory: v.optional(
            v.pipe(
                v.number(),
                v.integer(),
                v.minValue(1),
                v.description("Memory limit for this language in MiB."),
            ),
        ),
        cache_files: v.optional(
            v.pipe(
                globListSchema,
                v.description(
                    "Extra files whose contents belong in the compile cache key, such as shared headers.",
                ),
            ),
        ),
    }),
    v.description("How to build and run one language."),
);

export const configSchema = v.pipe(
    v.strictObject({
        src: v.optional(
            v.pipe(
                v.string(),
                v.minLength(1),
                v.description(
                    "Destination directory for the solution template, relative to the project root. Required when template.enable is true.",
                ),
            ),
        ),
        alias: v.optional(
            v.pipe(
                v.record(
                    aliasNameSchema,
                    v.pipe(
                        v.string(),
                        v.minLength(1),
                        v.description(
                            "Path of the source file this alias expands to, relative to the project root.",
                        ),
                    ),
                ),
                v.description(
                    "Extra names for source files, accepted by neoj test in place of a path.",
                ),
            ),
            {},
        ),
        login: v.optional(
            v.pipe(
                v.strictObject({
                    open_browser: v.optional(
                        v.pipe(
                            v.boolean(),
                            v.description(
                                "Open the browser automatically during the yukicoder device flow.",
                            ),
                        ),
                        true,
                    ),
                }),
                v.description("How neoj behaves during login."),
            ),
            { open_browser: true },
        ),
        testcase: v.optional(
            v.pipe(
                v.strictObject({
                    folder: v.optional(
                        v.pipe(
                            v.string(),
                            v.minLength(1),
                            v.description(
                                "Directory that receives downloaded samples, relative to the project root.",
                            ),
                        ),
                        "test",
                    ),
                    filename: v.optional(testcaseFilenameSchema, "sample-{}"),
                }),
                v.description("Where and how sample tests are written."),
            ),
            { folder: "test", filename: "sample-{}" },
        ),
        test: v.optional(
            v.pipe(
                v.strictObject({
                    source: v.optional(
                        v.pipe(
                            v.string(),
                            v.minLength(1),
                            v.description(
                                "Source file that neoj test builds by default, relative to the project root.",
                            ),
                        ),
                    ),
                    timeout: v.optional(
                        v.pipe(
                            v.number(),
                            v.minValue(0.001),
                            v.description("Default time limit per test case in seconds."),
                        ),
                        10,
                    ),
                    memory: v.optional(
                        v.pipe(
                            v.number(),
                            v.integer(),
                            v.minValue(1),
                            v.description("Default memory limit per test case in MiB."),
                        ),
                        1024,
                    ),
                    parallel: v.optional(
                        v.pipe(v.boolean(), v.description("Run test cases in parallel.")),
                        true,
                    ),
                    cache: v.optional(
                        v.pipe(
                            v.boolean(),
                            v.description(
                                "Keep compiled binaries in .neoj/build and skip compiling unchanged sources.",
                            ),
                        ),
                        false,
                    ),
                    ignore_trailing_space: v.optional(
                        v.pipe(
                            v.boolean(),
                            v.description(
                                "Ignore whitespace at the end of each output line when comparing.",
                            ),
                        ),
                        false,
                    ),
                    ignore_trailing_newline: v.optional(
                        v.pipe(
                            v.boolean(),
                            v.description(
                                "Ignore missing or extra newlines at the end of the output when comparing.",
                            ),
                        ),
                        false,
                    ),
                    show_stderr: v.optional(
                        v.pipe(
                            v.picklist(showStderrModes),
                            v.description(
                                'Print the program\'s standard error in the report: "always", "failure" (only when a case did not pass), or "never".',
                            ),
                        ),
                        "always",
                    ),
                }),
                v.description("How neoj builds and runs test cases."),
            ),
            {
                timeout: 10,
                memory: 1024,
                parallel: true,
                cache: false,
                ignore_trailing_space: false,
                ignore_trailing_newline: false,
                show_stderr: "always",
            },
        ),
        languages: v.optional(
            v.pipe(
                v.record(v.pipe(v.string(), v.minLength(1)), languageSchema),
                v.description(
                    "Build and run commands per language, keyed by a name you choose such as cpp.",
                ),
            ),
            {},
        ),
        download: v.optional(
            v.pipe(
                v.strictObject({
                    show_sample: v.optional(
                        v.pipe(
                            v.boolean(),
                            v.description(
                                "Print every downloaded sample's input and output after writing the files.",
                            ),
                        ),
                        false,
                    ),
                }),
                v.description("How neoj reports downloaded samples."),
            ),
            { show_sample: false },
        ),
        stash: v.optional(
            v.pipe(
                v.strictObject({
                    auto_stash: v.optional(
                        v.pipe(
                            v.boolean(),
                            v.description(
                                "Save the current problem's work before download replaces it.",
                            ),
                        ),
                        false,
                    ),
                    auto_apply: v.optional(
                        v.pipe(
                            v.boolean(),
                            v.description(
                                "Restore the downloaded problem's stash when one exists.",
                            ),
                        ),
                        false,
                    ),
                    force: v.optional(
                        v.pipe(
                            v.boolean(),
                            v.description(
                                "Allow neoj stash save to replace an existing stash without --force.",
                            ),
                        ),
                        true,
                    ),
                }),
                v.description("How neoj keeps per-problem work in sync with downloads."),
            ),
            { auto_stash: false, auto_apply: false, force: true },
        ),
        template: v.optional(
            v.pipe(
                v.strictObject({
                    enable: v.optional(
                        v.pipe(
                            v.boolean(),
                            v.description(
                                "Apply the template to src after each successful download. Requires src and template.folder.",
                            ),
                        ),
                        false,
                    ),
                    folder: v.optional(
                        v.pipe(
                            v.string(),
                            v.minLength(1),
                            v.description(
                                "Directory holding the template files, relative to the project root.",
                            ),
                        ),
                    ),
                    mode: v.optional(
                        v.pipe(
                            v.picklist(["overlay", "replace"]),
                            v.metadata({
                                evenBetterToml: {
                                    docs: {
                                        enumValues: [
                                            "Copy the template over src, replacing files that exist in both places.",
                                            "Remove the contents of src before copying the template.",
                                        ],
                                    },
                                },
                            }),
                            v.description("How the template is applied to src."),
                        ),
                        "overlay",
                    ),
                }),
                v.description("Template files applied to src after a download."),
            ),
            { enable: false, mode: "overlay" },
        ),
    }),
    v.description("neoj configuration, read from ~/.neoj.toml and the nearest project neoj.toml."),
);

export type Config = v.InferOutput<typeof configSchema>;

function getHomeDirectory(): string {
    const home = process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME;
    return home || homedir();
}

function getValueType(value: unknown): string {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }

    return typeof value;
}

function getIssuePath(issue: v.BaseIssue<unknown>): string {
    const path = issue.path?.map((item) => String(item.key)).join(".");
    return path || "<root>";
}

function getIssueValue(value: unknown, issue: v.BaseIssue<unknown>): unknown {
    let currentValue = value;
    for (const item of issue.path ?? []) {
        if (
            typeof currentValue !== "object" ||
            currentValue === null ||
            !Object.hasOwn(currentValue, String(item.key))
        ) {
            return issue.input;
        }
        currentValue = Reflect.get(currentValue, String(item.key)) as unknown;
    }

    return currentValue;
}

function getIssueReason(issue: v.BaseIssue<unknown>, path: string): string {
    if (issue.kind === "schema" && issue.type === "strict_object") {
        return "Unknown configuration key.";
    }
    if (issue.kind === "schema") {
        return `Expected ${issue.expected ?? "a valid value"}.`;
    }
    if (path === "testcase.filename" && issue.type === "check") {
        return "Must contain exactly one {} and be a file name.";
    }
    if (path === "testcase.folder" && issue.type === "min_length") {
        return "Must not be empty.";
    }
    if (path.startsWith("alias.")) {
        if (issue.type === "check") {
            return 'Must not be ".", "..", or contain a path separator.';
        }
        if (issue.type === "min_length") {
            return "Must not be empty.";
        }
    }

    return "Does not satisfy the field validation rule.";
}

type ConfigTable = Record<string, unknown>;

function isConfigTable(value: unknown): value is ConfigTable {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
    );
}

export function mergeConfig(base: ConfigTable, override: ConfigTable): ConfigTable {
    const result = Object.assign(Object.create(null), base) as ConfigTable;

    for (const [key, value] of Object.entries(override)) {
        const baseValue = base[key];
        result[key] =
            isConfigTable(baseValue) && isConfigTable(value)
                ? mergeConfig(baseValue, value)
                : value;
    }

    return result;
}

async function readConfigFile(path: string): Promise<ConfigTable> {
    const file = Bun.file(path);
    if (!(await file.exists())) {
        return {};
    }

    let parsed: object;
    try {
        parsed = Bun.TOML.parse(await file.text());
    } catch (error) {
        throw new Error(`Failed to parse config file "${path}".`, { cause: error });
    }

    if (!isConfigTable(parsed)) {
        throw new Error(`Config file "${path}" must contain a TOML table.`);
    }

    return parsed;
}

export async function loadConfig(): Promise<Config> {
    const globalConfigPath = join(getHomeDirectory(), ".neoj.toml");
    const projectConfigPath = await findProjectConfig(process.cwd());
    const globalConfig = await readConfigFile(globalConfigPath);
    const projectConfig = projectConfigPath ? await readConfigFile(projectConfigPath) : {};
    const projectOnlyKeys = ["src", "template"].filter((key) => key in globalConfig);
    if (projectOnlyKeys.length > 0) {
        throw new Error(
            `Configuration keys ${projectOnlyKeys.map((key) => `"${key}"`).join(", ")} may only be set in a project neoj.toml ("${globalConfigPath}").`,
        );
    }

    const mergedConfig = mergeConfig(globalConfig, projectConfig);
    const result = v.safeParse(configSchema, mergedConfig);

    if (!result.success) {
        const sourcePaths: string[] = [];
        if (await Bun.file(globalConfigPath).exists()) {
            sourcePaths.push(globalConfigPath);
        }
        if (projectConfigPath !== undefined) {
            sourcePaths.push(projectConfigPath);
        }

        const issueDetails = result.issues.map((issue) => {
            const path = getIssuePath(issue);
            const value = getIssueValue(mergedConfig, issue);
            return `  - ${path}: ${getIssueReason(issue, path)} (actual type: ${getValueType(value)})`;
        });
        const sources = sourcePaths.map((path) => `  - ${path}`).join("\n");
        const message = [
            "Configuration does not match the config schema after merging these files:",
            sources || "  - No config files found.",
            "Issues:",
            ...issueDetails,
        ].join("\n");
        throw new Error(message, { cause: result.issues });
    }

    if (result.output.template.enable) {
        const missingKeys = [];
        if (result.output.src === undefined) {
            missingKeys.push("src");
        }
        if (result.output.template.folder === undefined) {
            missingKeys.push("template.folder");
        }
        if (missingKeys.length > 0) {
            throw new Error(
                `Configuration in project file "${projectConfigPath ?? "neoj.toml"}" requires ${missingKeys.join(" and ")} when template.enable is true.`,
            );
        }
    }

    return result.output;
}
