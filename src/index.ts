#!/usr/bin/env bun

import { consola } from "consola";

import { createProgram } from "@/feature/program";

if (typeof Bun === "undefined") {
    consola.error("Please run this script with bun.");
    process.exit(1);
}

const program = createProgram();
program.configureOutput({
    writeErr: (str) => consola.error(str.trimEnd()),
});
await program.parseAsync();
