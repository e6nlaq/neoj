import { homedir } from "node:os";
import { join } from "node:path";

import * as v from "valibot";

import { findProjectConfig } from "./project";

export const configSchema = v.strictObject({});
export type Config = v.InferOutput<typeof configSchema>;

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
    const mergedConfig = mergeConfig(globalConfig, projectConfig);
    const result = v.safeParse(configSchema, mergedConfig);

    if (!result.success) {
        throw new Error("Configuration does not match the config schema.", {
            cause: result.issues,
        });
    }

    return result.output;
}
