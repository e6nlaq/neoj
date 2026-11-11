import { readdir } from "node:fs/promises";
import { join } from "node:path";

// Every published package moves in lockstep: the launcher resolves
// `@neoj/cli-<platform>` by exact version, and `USER_AGENT` embeds the API
// version. Keep this script and `test/package-versions.test.ts` in agreement.
const repositoryRoot = join(import.meta.dir, "..");
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies"] as const;

interface Manifest {
    name: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    [key: string]: unknown;
}

const requestedVersion = process.argv[2];
if (requestedVersion === undefined || !versionPattern.test(requestedVersion)) {
    console.error("usage: bun run set-version <version>");
    console.error("example: bun run set-version 0.1.0");
    process.exit(1);
}

const packageNames = (await readdir(join(repositoryRoot, "packages"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const manifestPaths = [
    join(repositoryRoot, "package.json"),
    ...packageNames.map((name) => join(repositoryRoot, "packages", name, "package.json")),
];

const manifests: Array<{ path: string; manifest: Manifest }> = [];
for (const path of manifestPaths) {
    manifests.push({ path, manifest: (await Bun.file(path).json()) as Manifest });
}

const packageNamePattern = /^@neoj\//;
let pinnedDependencies = 0;

for (const { path, manifest } of manifests) {
    manifest.version = requestedVersion;

    for (const field of dependencyFields) {
        const dependencies = manifest[field];
        if (dependencies === undefined) {
            continue;
        }

        for (const [name, specifier] of Object.entries(dependencies)) {
            if (!packageNamePattern.test(name)) {
                continue;
            }
            if (!versionPattern.test(specifier)) {
                throw new Error(
                    `${manifest.name} depends on ${name} with "${specifier}". ` +
                        "Cross-package dependencies must pin an exact version, " +
                        "because npm cannot install ranges or the workspace protocol here.",
                );
            }

            dependencies[name] = requestedVersion;
            pinnedDependencies += 1;
        }
    }

    await Bun.write(path, `${JSON.stringify(manifest, null, 4)}\n`);
}

// Bun stores the workspace versions and the exact `@neoj/*` pins in bun.lock,
// and `bun install --frozen-lockfile` (CI) fails when they disagree.
const lockfilePath = join(repositoryRoot, "bun.lock");
let lockfileUpdated = false;
if (await Bun.file(lockfilePath).exists()) {
    const lockfile = await Bun.file(lockfilePath).text();
    let workspaceVersions = 0;
    let lockfilePins = 0;

    const withVersions = lockfile.replace(/("version":\s*)"[^"]*"/g, (_match, prefix: string) => {
        workspaceVersions += 1;
        return `${prefix}"${requestedVersion}"`;
    });
    const updated = withVersions.replace(
        /("@neoj\/[a-z0-9-]+":\s*)"[^"]*"/g,
        (_match, prefix: string) => {
            lockfilePins += 1;
            return `${prefix}"${requestedVersion}"`;
        },
    );

    if (workspaceVersions !== packageNames.length) {
        throw new Error(
            `bun.lock has ${workspaceVersions} workspace versions, but ${packageNames.length} packages were found. ` +
                'Run "bun install" to regenerate the lockfile.',
        );
    }
    if (lockfilePins !== pinnedDependencies) {
        throw new Error(
            `bun.lock has ${lockfilePins} @neoj pins, but the manifests declare ${pinnedDependencies}. ` +
                'Run "bun install" to regenerate the lockfile.',
        );
    }

    await Bun.write(lockfilePath, updated);
    lockfileUpdated = true;
}

console.log(`Set every @neoj package to ${requestedVersion}.`);
console.log(`Updated ${manifestPaths.length} manifests${lockfileUpdated ? " and bun.lock" : ""}.`);
console.log('Run "bun install" to refresh node_modules before running the checks.');
