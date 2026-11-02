import { homedir } from "node:os";
import { join } from "node:path";

import * as v from "valibot";

import { findProjectConfig } from "./project";

const testcaseFilenameSchema = v.pipe(
    v.string(),
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

export const configSchema = v.strictObject({
    src: v.optional(v.pipe(v.string(), v.minLength(1))),
    login: v.optional(
        v.strictObject({
            open_browser: v.optional(v.boolean(), true),
        }),
        { open_browser: true },
    ),
    testcase: v.optional(
        v.strictObject({
            folder: v.optional(v.pipe(v.string(), v.minLength(1)), "test"),
            filename: v.optional(testcaseFilenameSchema, "sample-{}"),
        }),
        { folder: "test", filename: "sample-{}" },
    ),
    download: v.optional(
        v.strictObject({
            show_sample: v.optional(v.boolean(), false),
        }),
        { show_sample: false },
    ),
    stash: v.optional(
        v.strictObject({
            auto_stash: v.optional(v.boolean(), false),
            auto_apply: v.optional(v.boolean(), false),
            force: v.optional(v.boolean(), true),
        }),
        { auto_stash: false, auto_apply: false, force: true },
    ),
    template: v.optional(
        v.strictObject({
            enable: v.optional(v.boolean(), false),
            folder: v.optional(v.pipe(v.string(), v.minLength(1))),
            mode: v.optional(v.picklist(["overlay", "replace"]), "overlay"),
        }),
        { enable: false, mode: "overlay" },
    ),
});

export type Config = v.InferOutput<typeof configSchema>;

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
    const globalConfigPath = join(homedir(), ".neoj.toml");
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
