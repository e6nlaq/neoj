import { resolve } from "node:path";

import asset0 from "@/assets/template/.gitignore" with { type: "file" };
import asset1 from "@/assets/template/judge/interactor.cpp" with { type: "file" };
import asset2 from "@/assets/template/neoj.toml" with { type: "file" };
import asset3 from "@/assets/template/src/main.cpp" with { type: "file" };
import asset4 from "@/assets/template/template/main.cpp" with { type: "file" };
import type { TemplateFile } from "@/lib/util/template";

/** Static imports let Bun bundle these files for npm and standalone CLI builds. */
export const templateFiles: readonly TemplateFile[] = [
    { path: ".gitignore", source: resolve(import.meta.dir, asset0) },
    { path: "judge/interactor.cpp", source: resolve(import.meta.dir, asset1) },
    { path: "neoj.toml", source: resolve(import.meta.dir, asset2) },
    { path: "src/main.cpp", source: resolve(import.meta.dir, asset3) },
    { path: "template/main.cpp", source: resolve(import.meta.dir, asset4) },
];
