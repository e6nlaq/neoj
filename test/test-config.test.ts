import { describe, expect, it } from "bun:test";

import * as v from "valibot";

import { configSchema } from "@/lib/util/config";

function parse(input: unknown) {
    return v.parse(configSchema, input);
}

describe("test configuration", () => {
    it("fills in the test and language defaults", () => {
        const config = parse({});

        expect(config.test).toEqual({
            source: undefined,
            timeout: 10,
            memory: 1024,
            parallel: true,
            cache: false,
            error: 6,
            ignore_trailing_space: false,
            ignore_trailing_newline: false,
            show_stderr: "always",
            display_lines: 30,
            show_line_numbers: true,
        });
        expect(config.languages).toEqual({});
        expect(config.alias).toEqual({});
    });

    it("accepts aliases and rejects path-like names", () => {
        expect(parse({ alias: { main: "src/main.cpp", old: "archive/a.cpp" } }).alias).toEqual({
            main: "src/main.cpp",
            old: "archive/a.cpp",
        });

        for (const name of ["", ".", "..", "a/b", "a\\b"]) {
            expect(v.safeParse(configSchema, { alias: { [name]: "src/main.cpp" } }).success).toBe(
                false,
            );
        }
        expect(v.safeParse(configSchema, { alias: { main: "" } }).success).toBe(false);
        expect(v.safeParse(configSchema, { alias: { main: 1 } }).success).toBe(false);
    });

    it("accepts each show_stderr mode and rejects anything else", () => {
        const modes = ["always", "failure", "never"] as const;
        for (const mode of modes) {
            expect(parse({ test: { show_stderr: mode } }).test.show_stderr).toBe(mode);
        }

        expect(v.safeParse(configSchema, { test: { show_stderr: "sometimes" } }).success).toBe(
            false,
        );
    });

    it("defaults run.silent to false and accepts a boolean", () => {
        expect(parse({}).run).toEqual({ silent: false });
        expect(parse({ run: { silent: true } }).run.silent).toBe(true);
        expect(v.safeParse(configSchema, { run: { silent: "yes" } }).success).toBe(false);
        expect(v.safeParse(configSchema, { run: { quiet: true } }).success).toBe(false);
    });

    it("defaults display_lines and show_line_numbers, and validates them", () => {
        expect(parse({}).test.display_lines).toBe(30);
        expect(parse({}).test.show_line_numbers).toBe(true);
        expect(parse({ test: { display_lines: 5, show_line_numbers: false } }).test).toMatchObject({
            display_lines: 5,
            show_line_numbers: false,
        });

        expect(v.safeParse(configSchema, { test: { display_lines: 0 } }).success).toBe(false);
        expect(v.safeParse(configSchema, { test: { display_lines: 1.5 } }).success).toBe(false);
        expect(v.safeParse(configSchema, { test: { show_line_numbers: "yes" } }).success).toBe(
            false,
        );
    });

    it("defaults the error exponent to 6 and accepts only 0 through 15", () => {
        expect(parse({}).test.error).toBe(6);
        expect(parse({ test: { error: 9 } }).test.error).toBe(9);
        expect(parse({ test: { error: 0 } }).test.error).toBe(0);

        expect(v.safeParse(configSchema, { test: { error: 16 } }).success).toBe(false);
        expect(v.safeParse(configSchema, { test: { error: -1 } }).success).toBe(false);
        expect(v.safeParse(configSchema, { test: { error: 1.5 } }).success).toBe(false);
        expect(v.safeParse(configSchema, { test: { error: "6" } }).success).toBe(false);
    });

    it("accepts a language with compile, run, limits, and extra cache inputs", () => {
        const config = parse({
            test: { source: "src/main.cpp", cache: true, ignore_trailing_space: true },
            languages: {
                cpp: {
                    source: ["src/*.cpp", "src/lib/*.cpp"],
                    compile: ["g++", "-O2", "-o", "{outfile}", "{source}"],
                    run: ["{outfile}"],
                    timeout: 2.5,
                    memory: 512,
                    cache_files: "src/**/*.hpp",
                },
            },
        });

        expect(config.test.source).toBe("src/main.cpp");
        expect(config.test.cache).toBe(true);
        expect(config.test.ignore_trailing_space).toBe(true);
        expect(config.languages.cpp).toEqual({
            source: ["src/*.cpp", "src/lib/*.cpp"],
            compile: ["g++", "-O2", "-o", "{outfile}", "{source}"],
            run: ["{outfile}"],
            timeout: 2.5,
            memory: 512,
            cache_files: "src/**/*.hpp",
        });
    });

    it("leaves compile out for interpreted languages", () => {
        const config = parse({
            languages: { py: { source: "*.py", run: ["python", "{source}"] } },
        });

        expect(config.languages.py?.compile).toBeUndefined();
        expect(config.languages.py?.cache_files).toBeUndefined();
    });

    it("rejects empty runs, zero limits, and unknown keys", () => {
        expect(v.safeParse(configSchema, { test: { timeout: 0 } }).success).toBe(false);
        expect(v.safeParse(configSchema, { test: { memory: 0 } }).success).toBe(false);
        expect(v.safeParse(configSchema, { test: { parallel: "yes" } }).success).toBe(false);
        expect(v.safeParse(configSchema, { test: { unknown: true } }).success).toBe(false);
        expect(
            v.safeParse(configSchema, { languages: { cpp: { source: "*.cpp", run: [] } } }).success,
        ).toBe(false);
        expect(v.safeParse(configSchema, { languages: { cpp: { source: "*.cpp" } } }).success).toBe(
            false,
        );
        expect(
            v.safeParse(configSchema, {
                languages: { cpp: { source: "*.cpp", run: ["x"], extra: 1 } },
            }).success,
        ).toBe(false);
    });
});
