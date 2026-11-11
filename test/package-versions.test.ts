import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import cliPackage from "../package.json";

// Every workspace package is published in lockstep with the CLI. `USER_AGENT`
// is built from the API package version, and the launcher resolves the platform
// package by its import path, so a mismatch ships a broken release.
const rootDirectory = join(import.meta.dir, "..");
const packagesDirectory = join(rootDirectory, "packages");
const workspaceNames = readdirSync(packagesDirectory)
    .filter((name) => existsSync(join(packagesDirectory, name, "package.json")))
    .sort();
const platformNames = workspaceNames.filter((name) => name.startsWith("cli-"));

interface Manifest {
    name?: string;
    version?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
}

async function readManifest(directory: string): Promise<Manifest> {
    return Bun.file(join(packagesDirectory, directory, "package.json")).json();
}

for (const workspaceName of workspaceNames) {
    test(`${workspaceName} shares the CLI version`, async () => {
        const manifest = await readManifest(workspaceName);

        expect(manifest.name).toBe(`@neoj/${workspaceName}`);
        expect(manifest.version).toBe(cliPackage.version);
    });
}

test("the wrapper installs every platform package", () => {
    expect(Object.keys(cliPackage.optionalDependencies).sort()).toEqual(
        platformNames.map((name) => `@neoj/${name}`).sort(),
    );
});

test("the wrapper runs the Node launcher without install scripts", () => {
    // npm 12 blocks dependency install scripts by default, so the shipped
    // entry point must be a launcher that resolves the platform package.
    expect(cliPackage.bin).toEqual({ neoj: "./bin/neoj.js" });
    expect(Object.keys(cliPackage.scripts ?? {})).not.toContain("postinstall");

    for (const file of cliPackage.files ?? []) {
        expect(existsSync(join(rootDirectory, file))).toBe(true);
    }
});

test("the launcher knows every platform package", async () => {
    const launcher = await Bun.file(join(rootDirectory, "bin", "neoj.js")).text();

    for (const platformName of platformNames) {
        expect(launcher).toContain(`@neoj/${platformName}`);
    }
});

test("every @neoj dependency pins the released version", async () => {
    const manifests: Manifest[] = [cliPackage];

    for (const workspaceName of workspaceNames) {
        manifests.push(await readManifest(workspaceName));
    }

    for (const manifest of manifests) {
        for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
            for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
                if (name.startsWith("@neoj/")) {
                    // `workspace:*` and ranges break `npm install`, which does
                    // not understand the workspace protocol.
                    expect({ manifest: manifest.name, name, specifier }).toEqual({
                        manifest: manifest.name,
                        name,
                        specifier: cliPackage.version,
                    });
                }
            }
        }
    }
});
