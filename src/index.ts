#!/usr/bin/env bun

import { consola, createConsola } from "consola";

import { createProgram } from "@/feature/program";
import { getPendingUpdateNotification, isUpdateNotificationSuppressed } from "@/lib/util/update";

if (typeof Bun === "undefined") {
    consola.error("Please run this script with bun.");
    process.exit(1);
}

const program = createProgram();
program.configureOutput({
    writeErr: (str) => consola.error(str.trimEnd()),
});
await program.parseAsync();

// Update notifications run after the command has finished so they never delay
// the main work. `completions` is excluded because its stdout must stay clean,
// and `--version` never reaches this point (commander exits on it).
const invokedCommand = typeof program.args[0] === "string" ? program.args[0] : undefined;
if (!isUpdateNotificationSuppressed(invokedCommand)) {
    const notification = await getPendingUpdateNotification();
    if (notification !== undefined) {
        // Print on stderr so piping a command's stdout stays clean.
        const updateConsola = createConsola({
            stdout: process.stderr as unknown as typeof process.stdout,
        });
        updateConsola.info(notification);
    }
}
