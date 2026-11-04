import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { buildConfigJsonSchema } from "../scripts/config-schema";

const projectRoot = join(import.meta.dir, "..");
const schemaPath = join(projectRoot, "schema", "neoj.schema.json");
const templatePath = join(projectRoot, "src", "assets", "template", "neoj.toml");

describe("config JSON Schema", () => {
    it("matches the committed schema", async () => {
        const committed = await Bun.file(schemaPath).json();
        expect(committed).toEqual(buildConfigJsonSchema());
    });

    it("rejects unknown keys and declares its published id", () => {
        const schema = buildConfigJsonSchema();

        expect(schema.additionalProperties).toBe(false);
        expect(schema.$id).toBe(
            "https://raw.githubusercontent.com/e6nlaq/neoj/main/schema/neoj.schema.json",
        );
    });

    it("carries the filename pattern and the template requirement", () => {
        const schema = buildConfigJsonSchema() as {
            properties: {
                testcase: { properties: { filename: { pattern: string } } };
                handmade: { properties: { filename: { pattern: string } } };
                template: { properties: { mode: { enum: string[] } } };
            };
            allOf: unknown[];
        };

        expect(schema.properties.testcase.properties.filename.pattern).toBe(
            '^[^<>:"/\\\\|?*{}]*\\{\\}[^<>:"/\\\\|?*{}]*$',
        );
        expect(schema.properties.handmade.properties.filename.pattern).toBe(
            '^[^<>:"/\\\\|?*{}]*\\{\\}[^<>:"/\\\\|?*{}]*$',
        );
        expect(schema.properties.template.properties.mode.enum).toEqual(["overlay", "replace"]);
        expect(schema.allOf).toBeArrayOfSize(1);
    });

    it("points the bundled project template at the published schema", async () => {
        const template = await Bun.file(templatePath).text();
        const directive = template.split(/\r?\n/)[0];

        expect(directive).toBe(`#:schema ${buildConfigJsonSchema().$id}`);
    });
});
