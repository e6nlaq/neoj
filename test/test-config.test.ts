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
            ignore_trailing_space: false,
            ignore_trailing_newline: false,
        });
        expect(config.languages).toEqual({});
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
