import { join } from "node:path";

import { copyTemplateFiles } from "@/lib/util/template";

const sourceDirectory = join(import.meta.dir, "..", "src", "assets", "template");
const destinationDirectory = join(import.meta.dir, "..", "dist", "assets", "template");
const result = await copyTemplateFiles(sourceDirectory, destinationDirectory, true);

if (result.errors.length > 0) {
    const details = result.errors.map(({ path, error }) => `${path}: ${error.message}`).join("\n");
    throw new Error(`Failed to copy template assets:\n${details}`);
}
