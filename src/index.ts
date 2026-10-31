#!/usr/bin/env bun

import { program } from "@commander-js/extra-typings";
import { consola } from "consola";

import { createDownloadCommand } from "@/feature/download";
import { applyHelpBanner } from "@/feature/help-banner";
import { createInitCommand } from "@/feature/init";
import { createLoginCommand } from "@/feature/login";
import { createLogoutCommand } from "@/feature/logout";
import { createStatusCommand } from "@/feature/status";

import { version, description } from "../package.json";

if (typeof Bun === "undefined") {
    consola.error("Please run this script with bun.");
    process.exit(1);
}

program.configureOutput({
    writeErr: (str) => consola.error(str.trimEnd()),
});

program.name("neoj").version(version).description(description);
applyHelpBanner(program);

program.addCommand(createInitCommand());
program.addCommand(createDownloadCommand());
program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createStatusCommand());
program.parse();
