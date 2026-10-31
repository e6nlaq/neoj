import { program } from "@commander-js/extra-typings";
import { consola } from "consola";

import { createInitCommand } from "@/feature/init";
import { createLoginCommand } from "@/feature/login";
import { createLogoutCommand } from "@/feature/logout";
import { createStatusCommand } from "@/feature/status";

import { version } from "../package.json";

if (typeof Bun === "undefined") {
    consola.error("Please run this script with bun.");
    process.exit(1);
}

program.configureOutput({
    writeErr: (str) => consola.error(str.trimEnd()),
});

program.name("neoj").version(version).description("A CLI tool for neoj.");

program.addCommand(createInitCommand());
program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createStatusCommand());
program.parse();
