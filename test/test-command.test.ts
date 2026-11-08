import { describe, expect, it } from "bun:test";

import {
    maybeSubmitAfterTests,
    parseErrorExponent,
    warnIfErrorIgnored,
    type SubmitAfterTestInvocation,
} from "@/feature/test";
import type { Config } from "@/lib/util/config";

describe("maybeSubmitAfterTests", () => {
    const invocation = {
        projectRoot: "/project",
        config: {} as Config,
        cwd: "/project",
        source: "src/main.cpp",
    };
    const submit = async (options: SubmitAfterTestInvocation) => {
        calls.push(options);
        return { status: "submitted" as const };
    };
    let calls: SubmitAfterTestInvocation[] = [];
    let infos: string[] = [];
    const info = (message: string) => infos.push(message);

    it("does nothing without --submit", async () => {
        calls = [];
        infos = [];

        await maybeSubmitAfterTests({ exitCode: 0 }, undefined, invocation, submit, info);
        await maybeSubmitAfterTests({ exitCode: 2 }, false, invocation, submit, info);

        expect(calls).toEqual([]);
        expect(infos).toEqual([]);
    });

    it("reports and skips the submission when tests failed", async () => {
        calls = [];
        infos = [];

        await maybeSubmitAfterTests({ exitCode: 2 }, true, invocation, submit, info);

        expect(calls).toEqual([]);
        expect(infos).toEqual(["Tests failed; not submitting."]);
    });

    it("submits the same source when every test passed", async () => {
        calls = [];
        infos = [];

        const result = await maybeSubmitAfterTests({ exitCode: 0 }, true, invocation, submit, info);

        expect(calls).toEqual([invocation]);
        expect(infos).toEqual([]);
        expect(result).toEqual({ status: "submitted" });
    });
});

describe("parseErrorExponent", () => {
    it("accepts the supported range", () => {
        expect(parseErrorExponent("0")).toBe(0);
        expect(parseErrorExponent("6")).toBe(6);
        expect(parseErrorExponent("15")).toBe(15);
    });

    it("rejects values outside the range and non-decimal input", () => {
        expect(() => parseErrorExponent("16")).toThrow("Expected an exponent from 0 to 15");
        expect(() => parseErrorExponent("-1")).toThrow("Expected an exponent from 0 to 15");
        expect(() => parseErrorExponent("1.5")).toThrow("Expected an exponent from 0 to 15");
        expect(() => parseErrorExponent("0x2")).toThrow("Expected an exponent from 0 to 15");
        expect(() => parseErrorExponent("")).toThrow("Expected an exponent from 0 to 15");
    });

    it("points at the source order when a path is read as the exponent", () => {
        expect(() => parseErrorExponent("main.cpp")).toThrow("put it before the option");
    });
});

describe("warnIfErrorIgnored", () => {
    it("warns once when --error is combined with --interactive", () => {
        const messages: string[] = [];

        const warned = warnIfErrorIgnored({ interactive: true, error: 9 }, (message) =>
            messages.push(message),
        );

        expect(warned).toBe(true);
        expect(messages).toEqual([
            "The --error option is ignored in interactive mode; the interactor decides the verdict.",
        ]);
    });

    it("warns once when --error is combined with --judge", () => {
        const messages: string[] = [];

        const warned = warnIfErrorIgnored({ judge: true, error: 9 }, (message) =>
            messages.push(message),
        );

        expect(warned).toBe(true);
        expect(messages).toEqual([
            "The --error option is ignored in judge mode; the judge decides the verdict.",
        ]);
    });

    it("stays quiet without --interactive, --judge, or without --error", () => {
        const messages: string[] = [];
        const collect = (message: string) => messages.push(message);

        expect(warnIfErrorIgnored({ error: 9 }, collect)).toBe(false);
        expect(warnIfErrorIgnored({ interactive: true }, collect)).toBe(false);
        expect(warnIfErrorIgnored({ judge: true }, collect)).toBe(false);
        expect(messages).toEqual([]);
    });
});
