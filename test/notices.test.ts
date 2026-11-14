import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    collectLicenseEntries,
    findLicenseFile,
    generateNotices,
    type LicenseReport,
} from "../scripts/generate-notices";

let testRoot: string | undefined;

afterEach(async () => {
    if (testRoot !== undefined) {
        await rm(testRoot, { recursive: true, force: true });
        testRoot = undefined;
    }
});

async function createTestRoot(): Promise<string> {
    testRoot = await mkdtemp(join(tmpdir(), "neoj-notices-"));
    return testRoot;
}

async function writePackage(
    root: string,
    name: string,
    files: Record<string, string>,
): Promise<string> {
    const packageRoot = join(root, name);
    await mkdir(packageRoot, { recursive: true });
    for (const [fileName, contents] of Object.entries(files)) {
        await writeFile(join(packageRoot, fileName), contents);
    }
    return packageRoot;
}

describe("collectLicenseEntries", () => {
    it("flattens the report, excludes @neoj/*, and sorts by name", () => {
        const report: LicenseReport = {
            MIT: [
                {
                    name: "zlib-pkg",
                    versions: ["2.0.0"],
                    paths: ["/tmp/zlib"],
                    license: "MIT",
                    homepage: null,
                },
                {
                    name: "alpha",
                    versions: ["1.0.0"],
                    paths: ["/tmp/alpha"],
                    license: "MIT",
                    homepage: "https://example.com",
                },
            ],
            ISC: [
                {
                    name: "@neoj/cli",
                    versions: ["0.1.0"],
                    paths: ["/tmp/neoj"],
                    license: "ISC",
                    homepage: null,
                },
                {
                    name: "beta",
                    versions: ["3.1.4", "3.0.0"],
                    paths: ["/tmp/beta"],
                    license: "ISC",
                    homepage: null,
                },
            ],
        };

        expect(collectLicenseEntries(report)).toEqual([
            {
                name: "alpha",
                version: "1.0.0",
                license: "MIT",
                homepage: "https://example.com",
                packageRoot: "/tmp/alpha",
            },
            {
                name: "beta",
                version: "3.1.4",
                license: "ISC",
                homepage: undefined,
                packageRoot: "/tmp/beta",
            },
            {
                name: "zlib-pkg",
                version: "2.0.0",
                license: "MIT",
                homepage: undefined,
                packageRoot: "/tmp/zlib",
            },
        ]);
    });

    it("skips entries without a package path", () => {
        const report: LicenseReport = {
            MIT: [
                { name: "broken", versions: ["1.0.0"], paths: [], license: "MIT", homepage: null },
            ],
        };
        expect(collectLicenseEntries(report)).toEqual([]);
    });
});

describe("findLicenseFile", () => {
    it("prefers a plain LICENSE over LICENSE.md over LICENSE.txt over suffix forms", async () => {
        const root = await createTestRoot();
        const packageRoot = await writePackage(root, "a", {
            "MIT-LICENSE.txt": "suffix form",
            "LICENSE.txt": "txt form",
            "LICENSE.md": "md form",
            LICENSE: "plain form",
            "package.json": "{}",
        });

        expect(await findLicenseFile(packageRoot)).toBe("LICENSE");
    });

    it("recognizes spelling and case variants such as licence.txt and LICENCE.md", async () => {
        const root = await createTestRoot();
        const packageRoot = await writePackage(root, "b", {
            "licenSE.txt": "spelling variant",
            "LICENCE.md": "md form",
        });

        expect(await findLicenseFile(packageRoot)).toBe("LICENCE.md");
    });

    it("returns null when the package has no license file", async () => {
        const root = await createTestRoot();
        const packageRoot = await writePackage(root, "c", {
            "package.json": "{}",
            "readme.md": "hi",
        });

        expect(await findLicenseFile(packageRoot)).toBeNull();
    });

    it("returns null when the package root does not exist", async () => {
        const root = await createTestRoot();
        expect(await findLicenseFile(join(root, "missing"))).toBeNull();
    });
});

describe("generateNotices", () => {
    const bunLicense = "Bun itself is MIT-licensed.\n\n## JavaScriptCore\nLGPL-2 text.";

    it("embeds the Bun license and every package's collected license text", async () => {
        const root = await createTestRoot();
        const withFile = await writePackage(root, "with-file", {
            "license.txt": "Custom MIT text.",
        });
        const report: LicenseReport = {
            MIT: [
                {
                    name: "with-file",
                    versions: ["1.0.0"],
                    paths: [withFile],
                    license: "MIT",
                    homepage: "https://example.com/with-file",
                },
            ],
        };

        const notices = await generateNotices(report, "1.4.4", bunLicense, () =>
            Promise.reject(new Error("network must not be needed")),
        );

        expect(notices.warnings).toEqual([]);
        expect(notices.content).toContain("## Bun runtime (v1.4.4)");
        expect(notices.content).toContain(bunLicense);
        expect(notices.content).toContain("### with-file@1.0.0");
        expect(notices.content).toContain("Custom MIT text.");
        expect(notices.content).toContain("https://example.com/with-file");
        expect(notices.content).toContain(
            "source code is published at https://github.com/e6nlaq/neoj",
        );
    });

    it("falls back to the SPDX template and logs a warning when the license file is missing", async () => {
        const root = await createTestRoot();
        const empty = await writePackage(root, "empty", {});
        const report: LicenseReport = {
            MIT: [
                {
                    name: "empty",
                    versions: ["0.2.0"],
                    paths: [empty],
                    license: "MIT",
                    homepage: null,
                },
            ],
        };

        const notices = await generateNotices(report, "1.4.4", bunLicense, () =>
            Promise.reject(new Error("network must not be needed")),
        );

        expect(notices.warnings).toEqual([
            {
                packageName: "empty",
                version: "0.2.0",
                license: "MIT",
                reason: "license-file-missing",
                detail: "used the template fallback",
            },
        ]);
        expect(notices.content).toContain("Permission is hereby granted, free of charge");
    });

    it("reports a failed SPDX fetch instead of fabricating text", async () => {
        const root = await createTestRoot();
        const unknown = await writePackage(root, "unknown", {});
        const report: LicenseReport = {
            "LicenseRef-Proprietary": [
                {
                    name: "unknown",
                    versions: ["9.9.9"],
                    paths: [unknown],
                    license: "LicenseRef-Proprietary",
                    homepage: "https://example.com/unknown",
                },
            ],
        };

        const notices = await generateNotices(report, "1.4.4", bunLicense, () =>
            Promise.reject(new Error("offline")),
        );

        expect(notices.warnings).toEqual([
            {
                packageName: "unknown",
                version: "9.9.9",
                license: "LicenseRef-Proprietary",
                reason: "license-text-fetch-failed",
                detail: "the SPDX fallback fetch failed",
            },
        ]);
        expect(notices.content).toContain("The license text could not be collected automatically.");
        expect(notices.content).toContain("https://example.com/unknown");
    });

    it("uses the SPDX fetch when no template matches", async () => {
        const root = await createTestRoot();
        const custom = await writePackage(root, "custom", {});
        const report: LicenseReport = {
            "X-Test": [
                {
                    name: "custom",
                    versions: ["1.1.1"],
                    paths: [custom],
                    license: "X-Test",
                    homepage: null,
                },
            ],
        };

        const notices = await generateNotices(report, "1.4.4", bunLicense, () =>
            Promise.resolve("Fetched SPDX text."),
        );

        expect(notices.warnings).toEqual([
            {
                packageName: "custom",
                version: "1.1.1",
                license: "X-Test",
                reason: "license-file-missing",
                detail: "used the spdx fallback",
            },
        ]);
        expect(notices.content).toContain("Fetched SPDX text.");
    });
});
