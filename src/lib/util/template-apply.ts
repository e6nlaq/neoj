import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { hasErrorCode } from "@/lib/util/errors";

export type TemplateMode = "overlay" | "replace";

function isWithin(parent: string, candidate: string): boolean {
    const path = relative(parent, candidate);
    return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function validateProjectDirectory(
    projectRoot: string,
    configuredPath: string,
    name: string,
): Promise<string> {
    if (!configuredPath || isAbsolute(configuredPath)) {
        throw new Error(`${name} must be a non-empty relative path.`);
    }

    const root = await realpath(projectRoot);
    const target = resolve(root, configuredPath);
    const targetRelative = relative(root, target);
    if (
        targetRelative === "" ||
        targetRelative === ".." ||
        targetRelative.startsWith(`..${sep}`) ||
        isAbsolute(targetRelative)
    ) {
        throw new Error(`${name} must resolve to a directory inside the project.`);
    }

    const segments = targetRelative.split(sep);
    if (segments.some((segment) => segment.toLowerCase() === ".git")) {
        throw new Error(`${name} cannot target the Git metadata directory.`);
    }

    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
        current = join(current, segments[index] ?? "");
        let entry;
        try {
            entry = await lstat(current);
        } catch (error) {
            if (hasErrorCode(error, "ENOENT")) {
                break;
            }
            throw error;
        }

        if (entry.isSymbolicLink()) {
            throw new Error(`${name} cannot pass through a symbolic link.`);
        }
        if (index < segments.length - 1 && !entry.isDirectory()) {
            throw new Error(`${name} parent path "${current}" is not a directory.`);
        }
        if (index === segments.length - 1 && !entry.isDirectory()) {
            throw new Error(`${name} "${current}" exists but is not a directory.`);
        }
    }

    return target;
}

async function assertSafeTree(directory: string, name: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        const stats = await lstat(path);
        if (stats.isSymbolicLink()) {
            throw new Error(`${name} cannot contain symbolic links ("${path}").`);
        }
        if (stats.isDirectory()) {
            await assertSafeTree(path, name);
        } else if (!stats.isFile()) {
            throw new Error(`${name} contains an unsupported file type ("${path}").`);
        }
    }
}

async function applyTemplateTree(source: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
        const sourcePath = join(source, entry.name);
        const destinationPath = join(destination, entry.name);
        let destinationStats;
        try {
            destinationStats = await lstat(destinationPath);
        } catch (error) {
            if (!hasErrorCode(error, "ENOENT")) {
                throw error;
            }
        }

        if (entry.isDirectory()) {
            if (
                destinationStats !== undefined &&
                (!destinationStats.isDirectory() || destinationStats.isSymbolicLink())
            ) {
                await rm(destinationPath, { recursive: true });
            }
            await applyTemplateTree(sourcePath, destinationPath);
        } else {
            if (destinationStats?.isDirectory() || destinationStats?.isSymbolicLink()) {
                await rm(destinationPath, { recursive: true });
            }
            await copyFile(sourcePath, destinationPath);
        }
    }
}

export async function applyProjectTemplate(
    projectRoot: string,
    templatePath: string,
    sourcePath: string,
    mode: TemplateMode,
): Promise<void> {
    const templateDirectory = await validateProjectDirectory(
        projectRoot,
        templatePath,
        "template.path",
    );
    const sourceDirectory = await validateProjectDirectory(projectRoot, sourcePath, "src");

    if (
        isWithin(templateDirectory, sourceDirectory) ||
        isWithin(sourceDirectory, templateDirectory)
    ) {
        throw new Error("template.path and src must not overlap.");
    }

    try {
        const templateStats = await lstat(templateDirectory);
        if (!templateStats.isDirectory()) {
            throw new Error(`template.path "${templateDirectory}" is not a directory.`);
        }
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
            throw new Error(`template.path "${templateDirectory}" does not exist.`, {
                cause: error,
            });
        }
        throw error;
    }

    await assertSafeTree(templateDirectory, "template.path");

    let sourceExists = false;
    try {
        const sourceStats = await lstat(sourceDirectory);
        if (!sourceStats.isDirectory()) {
            throw new Error(`src "${sourceDirectory}" is not a directory.`);
        }
        sourceExists = true;
    } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) {
            throw error;
        }
    }

    if (mode === "overlay") {
        await applyTemplateTree(templateDirectory, sourceDirectory);
        return;
    }

    const parentDirectory = dirname(sourceDirectory);
    await mkdir(parentDirectory, { recursive: true });
    const stagingDirectory = await mkdtemp(
        join(parentDirectory, `.${basename(sourceDirectory)}-template-`),
    );
    try {
        await applyTemplateTree(templateDirectory, stagingDirectory);

        if (sourceExists) {
            await rm(sourceDirectory, { recursive: true });
        }
        await rename(stagingDirectory, sourceDirectory);
    } finally {
        await rm(stagingDirectory, { recursive: true, force: true });
    }
}
