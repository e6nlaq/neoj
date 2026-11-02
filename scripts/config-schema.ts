import { toJsonSchema } from "@valibot/to-json-schema";

import { configSchema } from "@/lib/util/config";

const schemaId = "https://raw.githubusercontent.com/e6nlaq/neoj/main/schema/neoj.schema.json";

const templateRequirement = {
    if: {
        properties: {
            template: {
                properties: { enable: { const: true } },
                required: ["enable"],
            },
        },
        required: ["template"],
    },
    // "then" is a JSON Schema keyword here; this object is never awaited.
    // oxlint-disable-next-line unicorn/no-thenable
    then: {
        properties: { template: { required: ["folder"] } },
        required: ["src"],
    },
};

export function buildConfigJsonSchema(): Record<string, unknown> {
    const generated = toJsonSchema(configSchema, {
        target: "draft-07",
        errorMode: "ignore",
    }) as Record<string, unknown>;
    const existingConstraints = Array.isArray(generated.allOf) ? generated.allOf : [];

    return {
        $schema: "http://json-schema.org/draft-07/schema#",
        $id: schemaId,
        title: "neoj configuration",
        ...generated,
        allOf: [...existingConstraints, templateRequirement],
    };
}
