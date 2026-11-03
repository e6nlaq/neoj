import gitignoreSource from "@/assets/template/.gitignore" with { type: "file" };
import configSource from "@/assets/template/neoj.toml" with { type: "file" };
import sourceTemplateSource from "@/assets/template/src/main.cpp" with { type: "file" };
import solutionTemplateSource from "@/assets/template/template/main.cpp" with { type: "file" };

import type { TemplateFile } from "./template";

/**
 * Project templates bundled with the CLI. Importing them with `type: "file"`
 * makes Bun embed the contents in `--compile` binaries and emit them next to
 * the bundle, so `neoj init` works whether neoj is installed from npm or run
 * from a standalone executable.
 */
export const templateFiles: readonly TemplateFile[] = [
    { path: ".gitignore", source: gitignoreSource },
    { path: "neoj.toml", source: configSource },
    { path: "src/main.cpp", source: sourceTemplateSource },
    { path: "template/main.cpp", source: solutionTemplateSource },
];
