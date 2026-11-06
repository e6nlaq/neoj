import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { hasErrorCode } from "@/lib/util/errors";

async function isGitRoot(directory: string): Promise<boolean> {
    try {
        // .git is a directory in a normal checkout and a file in a worktree.
        await lstat(join(directory, ".git"));
        return true;
    } catch (error) {
        if (!hasErrorCode(error, "ENOENT") && !hasErrorCode(error, "ENOTDIR")) {
            throw error;
        }
        return false;
    }
}

export async function requireInitializedProject(cwd: string): Promise<string> {
    const configPath = await findProjectConfig(cwd);
    if (configPath === undefined) {
        throw new Error(`Project is not initialized. Run "neoj init" in "${resolve(cwd)}".`);
    }

    return dirname(configPath);
}

export async function findProjectConfig(cwd: string): Promise<string | undefined> {
    let directory = resolve(cwd);
    while (true) {
        const configPath = join(directory, "neoj.toml");
        if (await Bun.file(configPath).exists()) {
            return configPath;
        }

        const parentDirectory = dirname(directory);
        // Projects never inherit configuration from outside their repository.
        if (parentDirectory === directory || (await isGitRoot(directory))) {
            return undefined;
        }
        directory = parentDirectory;
    }
}
