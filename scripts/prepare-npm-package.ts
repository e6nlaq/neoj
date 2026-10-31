import { join } from "node:path";

const templateDirectory = join(import.meta.dir, "..", "dist", "assets", "template");

await Bun.write(join(templateDirectory, ".npmignore"), "!.gitignore\n");
