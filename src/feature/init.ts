import { dirname, resolve } from "node:path";

import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { findProjectConfig } from "@/lib/util/project";
import { copyTemplateFiles } from "@/lib/util/template";
import { templateFiles } from "@/lib/util/template-assets";

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

                const result = await copyTemplateFiles(templateFiles, destinationDirectory, force);

                const summary = `Copied ${result.copied.length} template file(s) to "${destinationDirectory}".`;
                if (result.errors.length === 0) {
                    consola.success(summary);
                } else {
                    consola.info(summary);
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
