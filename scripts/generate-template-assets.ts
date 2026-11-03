import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export async function collectTemplateAssetPaths(templateDirectory: string): Promise<string[]> {
    const paths: string[] = [];

    async function visit(directory: string): Promise<void> {
        const entries = await readdir(directory, { withFileTypes: true });
        entries.sort((left, right) =>
            left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
        );

        for (const entry of entries) {
            const entryPath = join(directory, entry.name);
            const assetPath = relative(templateDirectory, entryPath).split(sep).join("/");

            if (entry.isSymbolicLink()) {
                throw new Error(
                    `Symbolic links are not supported in template assets: ${assetPath}`,
                );
            }
            if (entry.isDirectory()) {
                await visit(entryPath);
            } else if (entry.isFile()) {
                paths.push(assetPath);
            } else {
                throw new Error(`Unsupported filesystem entry in template assets: ${assetPath}`);
            }
        }
    }

    await visit(templateDirectory);
    return paths;
}

export async function generateTemplateAssets(
    templateDirectory: string,
    outputFile: string,
): Promise<string[]> {
    const assetPaths = await collectTemplateAssetPaths(resolve(templateDirectory));
    const imports = assetPaths.map(
        (_, index) =>
            `import asset${index} from "@/assets/template/${assetPaths[index]}" with { type: "file" };`,
    );
    const entries = assetPaths.map(
        (assetPath, index) =>
            `    { path: ${JSON.stringify(assetPath)}, source: resolve(import.meta.dir, asset${index}) },`,
    );
    const contents = [
        'import { resolve } from "node:path";',
        "",
        ...imports,
        "",
        'import type { TemplateFile } from "./template";',
        "",
        "/** Static imports let Bun bundle these files for npm and standalone CLI builds. */",
        "export const templateFiles: readonly TemplateFile[] = [",
        ...entries,
        "];",
        "",
    ].join("\n");

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, contents);

    const formatResult = Bun.spawnSync(["bun", "fmt", outputFile], {
        stdout: "inherit",
        stderr: "inherit",
    });
    if (formatResult.exitCode !== 0) {
        throw new Error(`Failed to format generated template asset list: ${outputFile}`);
    }

    return assetPaths;
}

if (import.meta.main) {
    const repositoryRoot = resolve(import.meta.dir, "..");
    const templateDirectory = join(repositoryRoot, "src", "assets", "template");
    const outputFile = join(repositoryRoot, "src", "lib", "util", "template-assets.ts");

    await generateTemplateAssets(templateDirectory, outputFile);
}
