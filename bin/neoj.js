#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { dirname, join } from "node:path";

// Keep this table in sync with the `@neoj/cli-*` packages. npm 12 blocks
// dependency install scripts by default, so this launcher must work without
// `postinstall`: it runs the prebuilt binary directly instead of replacing a
// placeholder file.
const targets = {
    "win32-x64": { packageName: "@neoj/cli-win32-x64", binaryName: "neoj.exe" },
    "linux-x64": { packageName: "@neoj/cli-linux-x64", binaryName: "neoj" },
    "linux-arm64": { packageName: "@neoj/cli-linux-arm64", binaryName: "neoj" },
    "darwin-x64": { packageName: "@neoj/cli-darwin-x64", binaryName: "neoj" },
    "darwin-arm64": { packageName: "@neoj/cli-darwin-arm64", binaryName: "neoj" },
};

const platform = `${process.platform}-${process.arch}`;
const target = targets[platform];

if (target === undefined) {
    console.error(
        `neoj: no prebuilt binary is available for ${platform}. ` +
            `Supported platforms: ${Object.keys(targets).join(", ")}. ` +
            "Linux binaries need glibc; Alpine and other musl distributions are not supported yet.",
    );
    process.exit(1);
}

const require = createRequire(import.meta.url);

let binary;
try {
    const packageJsonPath = require.resolve(`${target.packageName}/package.json`);
    binary = join(dirname(packageJsonPath), target.binaryName);
} catch {
    console.error(
        `neoj: ${target.packageName} was not installed. ` +
            'Reinstall with "npm install -g @neoj/cli".',
    );
    process.exit(1);
}

if (!existsSync(binary)) {
    console.error(
        `neoj: ${target.packageName} does not contain ${target.binaryName}. ` +
            'Reinstall with "npm install -g @neoj/cli".',
    );
    process.exit(1);
}

const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });

child.on("error", (error) => {
    const hint =
        error.code === "EACCES" ? ` Make sure the file is executable (chmod +x "${binary}").` : "";
    console.error(`neoj: failed to run ${binary}: ${error.message}${hint}`);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (signal === null) {
        process.exit(code ?? 1);
    }

    const number = constants.signals[signal];
    process.exit(number === undefined ? 1 : 128 + number);
});
