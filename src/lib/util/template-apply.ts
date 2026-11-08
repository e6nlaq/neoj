import { copyFile, lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { commitStagedDirectory } from "@/lib/util/directory-replace";
import { hasErrorCode } from "@/lib/util/errors";
import { assertDirectoriesDoNotOverlap, resolveProjectDirectory } from "@/lib/util/project-path";

export type TemplateMode = "overlay" | "replace";

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

async function applyTemplateTree(
    source: string,
    destination: string,
    isExcluded: (relativePath: string, name: string) => boolean,
    relativeDirectory = "",
): Promise<void> {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
        const relativePath =
            relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
        if (isExcluded(relativePath, entry.name)) {
            continue;
        }

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
            await applyTemplateTree(sourcePath, destinationPath, isExcluded, relativePath);
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
    exclude: readonly string[] = [],
): Promise<void> {
    const excludeGlobs = exclude.map((pattern) => new Bun.Glob(pattern));
    const isExcluded = (relativePath: string, name: string): boolean =>
        excludeGlobs.some((glob) => glob.match(relativePath) || glob.match(name));

    const templateDirectory = await resolveProjectDirectory(
        projectRoot,
        templatePath,
        "template.folder",
    );
    const sourceDirectory = await resolveProjectDirectory(projectRoot, sourcePath, "src");

    assertDirectoriesDoNotOverlap(
        { path: templateDirectory, name: "template.folder" },
        { path: sourceDirectory, name: "src" },
    );

    try {
        const templateStats = await lstat(templateDirectory);
        if (!templateStats.isDirectory()) {
            throw new Error(`template.folder "${templateDirectory}" is not a directory.`);
        }
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
            throw new Error(`template.folder "${templateDirectory}" does not exist.`, {
                cause: error,
            });
        }
        throw error;
    }

    await assertSafeTree(templateDirectory, "template.folder");

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
        await applyTemplateTree(templateDirectory, sourceDirectory, isExcluded);
        return;
    }

    const parentDirectory = dirname(sourceDirectory);
    await mkdir(parentDirectory, { recursive: true });
    const stagingDirectory = await mkdtemp(
        join(parentDirectory, `.${basename(sourceDirectory)}-template-`),
    );
    try {
        await applyTemplateTree(templateDirectory, stagingDirectory, isExcluded);

        await commitStagedDirectory(stagingDirectory, sourceDirectory, sourceExists);
    } finally {
        await rm(stagingDirectory, { recursive: true, force: true });
    }
}
