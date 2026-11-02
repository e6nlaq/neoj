import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { buildConfigJsonSchema } from "./config-schema";

const outputDirectory = join(import.meta.dir, "..", "schema");
const outputPath = join(outputDirectory, "neoj.schema.json");

await mkdir(outputDirectory, { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(buildConfigJsonSchema(), null, 4)}\n`);

// Run the project formatter so the committed file matches what `bun fmt` produces.
const formatter = Bun.spawn([process.execPath, "fmt", outputPath], {
    stdout: "ignore",
    stderr: "inherit",
});
if ((await formatter.exited) !== 0) {
    throw new Error(`Failed to format "${outputPath}".`);
}
