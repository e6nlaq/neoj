import { program } from "@commander-js/extra-typings";
import { consola } from "consola";

import { version } from "../package.json";

if (typeof Bun === "undefined") {
    consola.error("Please run this script with bun.");
    process.exit(1);
}

program.configureOutput({
    writeErr: (str) => consola.error(str),
});

program.name("neoj").version(version).description("A CLI tool for neoj.");

program
    .command("print")
    .argument("<file>", "ww")
    .option("-d, --double-sided", "double-sided")
    .action((targetFile, options) => {
        // command-arguments and options are fully typed
        console.log(targetFile, options);
    });
program.parse();
