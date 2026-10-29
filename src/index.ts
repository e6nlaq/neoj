import { program } from "@commander-js/extra-typings";
import { consola } from "consola";

import { version } from "../package.json";
import { createLoginCommand } from "./feature/login";
import { createStatusCommand } from "./feature/status";

if (typeof Bun === "undefined") {
    consola.error("Please run this script with bun.");
    process.exit(1);
}

program.configureOutput({
    writeErr: (str) => consola.error(str),
});

program.name("neoj").version(version).description("A CLI tool for neoj.");

program.addCommand(createLoginCommand());
program.addCommand(createStatusCommand());
program.parse();
