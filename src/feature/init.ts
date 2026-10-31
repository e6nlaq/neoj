import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { hasErrorCode } from "../lib/util/errors";
import { findProjectConfig } from "../lib/util/project";
import { copyTemplateFiles } from "../lib/util/template";

async function findTemplateDirectory(): Promise<string> {
    const candidates = [
        join(import.meta.dir, "assets", "template"),
        join(import.meta.dir, "..", "assets", "template"),
    ];

    for (const candidate of candidates) {
        try {
            if ((await stat(candidate)).isDirectory()) {
                return candidate;
            }
        } catch (error) {
            if (!hasErrorCode(error, "ENOENT") && !hasErrorCode(error, "ENOTDIR")) {
                throw error;
            }
        }
    }

    throw new Error("Could not locate the bundled project templates.");
}

export function createInitCommand(): Command {
    return new Command("init")
        .description("Initialize a project from the bundled templates")
        .option("-f, --force", "Overwrite existing files")
        .action(async ({ force }) => {
            try {
                const cwd = resolve(process.cwd());
                const projectConfigPath = await findProjectConfig(cwd);
                const destinationDirectory = projectConfigPath ? dirname(projectConfigPath) : cwd;

                if (projectConfigPath !== undefined && destinationDirectory !== cwd) {
                    consola.info(
                        `Found "${projectConfigPath}". Initializing in "${destinationDirectory}".`,
                    );
                }

                const templateDirectory = await findTemplateDirectory();
                const result = await copyTemplateFiles(
                    templateDirectory,
                    destinationDirectory,
                    force,
                );

                if (result.errors.length === 0) {
                    consola.success(
                        `Copied ${result.copied.length} template file(s) to "${destinationDirectory}".`,
                    );
                } else {
                    consola.info(
                        `Copied ${result.copied.length} template file(s) to "${destinationDirectory}".`,
                    );
                }

                if (result.skipped.length > 0) {
                    consola.warn("Skipped existing paths:");
                    for (const path of result.skipped) {
                        consola.info(`  ${path}`);
                    }
                }

                for (const { path, error } of result.errors) {
                    consola.error(`Failed to copy "${path}": ${error.message}`);
                }
                if (result.errors.length > 0) {
                    process.exitCode = 1;
                }
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
