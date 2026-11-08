// Modules imported with `with { type: "file" }` expose the path to the file
// contents instead of the parsed file. Bun types only cover a few extensions,
// so declare the ones bundled under `src/assets/`.
declare module "*.cpp" {
    const path: string;
    export = path;
}

declare module "*.gitignore" {
    const path: string;
    export = path;
}

declare module "*.py" {
    const path: string;
    export = path;
}
