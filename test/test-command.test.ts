import { describe, expect, it } from "bun:test";

import { parseErrorExponent, warnIfErrorIgnored } from "@/feature/test";

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

    it("stays quiet without --interactive or without --error", () => {
        const messages: string[] = [];
        const collect = (message: string) => messages.push(message);

        expect(warnIfErrorIgnored({ error: 9 }, collect)).toBe(false);
        expect(warnIfErrorIgnored({ interactive: true }, collect)).toBe(false);
        expect(messages).toEqual([]);
    });
});
