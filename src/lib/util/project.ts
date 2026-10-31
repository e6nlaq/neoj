import { dirname, join, resolve } from "node:path";

export async function findProjectConfig(cwd: string): Promise<string | undefined> {
    let directory = resolve(cwd);
    while (true) {
        const configPath = join(directory, "neoj.toml");
        if (await Bun.file(configPath).exists()) {
            return configPath;
        }

        const parentDirectory = dirname(directory);
        if (parentDirectory === directory) {
            return undefined;
        }
        directory = parentDirectory;
    }
}
