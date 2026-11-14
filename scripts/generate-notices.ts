import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

// Bundles the third-party license information into a single
// THIRD_PARTY_NOTICES.txt file for the npm tarballs and the GitHub Release
// archives:
//
//   1. a header that documents neoj's own MIT license and the LGPL terms of
//      the embedded Bun runtime,
//   2. Bun's official LICENSE.md, fetched for the toolchain version in use,
//   3. the license text of every npm dependency in the lockfile, read from
//      each package's installed LICENSE file (filename variants are
//      tolerated), with canonical SPDX template texts as the fallback.
//
// The file is generated in the release workflow and is never committed. The
// collection logic is exported so `test/notices.test.ts` can exercise it
// without the network.

const repositoryRoot = join(import.meta.dir, "..");
const repositoryUrl = "https://github.com/e6nlaq/neoj";
const userAgent = "neoj-release-notices (https://github.com/e6nlaq/neoj)";
const fetchTimeoutMs = 30_000;
const spdxLicenseUrl = "https://spdx.org/licenses";

export interface LicenseReportEntry {
    name: string;
    versions: string[];
    paths: string[];
    license: string;
    author?: string | null;
    description?: string | null;
    homepage?: string | null;
}

export type LicenseReport = Record<string, LicenseReportEntry[]>;

export interface NoticeEntry {
    name: string;
    version: string;
    license: string;
    homepage?: string;
    packageRoot: string;
}

export type NoticeWarningReason =
    | "license-file-missing"
    | "license-text-unavailable"
    | "license-text-fetch-failed";

export interface NoticeWarning {
    packageName: string;
    version: string;
    license: string;
    reason: NoticeWarningReason;
    detail?: string;
}

export interface GeneratedNotices {
    content: string;
    warnings: NoticeWarning[];
}

/** Canonical SPDX fallback texts for the license types most likely to appear. */
const licenseTemplates: Record<string, string> = {
    MIT: [
        "MIT License",
        "",
        "Copyright (c) <year> <copyright holders>",
        "",
        "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:",
        "",
        "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.",
        "",
        "THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.",
    ].join("\n"),
    ISC: [
        "ISC License",
        "",
        "Copyright (c) 2004-2010 by Internet Systems Consortium, Inc. (“ISC”)",
        "Copyright (c) 1995-2003 by Internet Software Consortium",
        "",
        "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.",
        "",
        "THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.",
    ].join("\n"),
    "BSD-2-Clause": [
        "Copyright (c) <year> <owner> .",
        "",
        "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:",
        "",
        "1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.",
        "",
        "2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.",
        "",
        'THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',
    ].join("\n"),
    "BSD-3-Clause": [
        "Copyright <YEAR> <COPYRIGHT HOLDER>",
        "",
        "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:",
        "",
        "1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.",
        "",
        "2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.",
        "",
        "3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.",
        "",
        'THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',
    ].join("\n"),
    "0BSD": [
        "Copyright (C) YEAR by COPYRIGHT HOLDER",
        "",
        "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.",
        "",
        "THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.",
    ].join("\n"),
    Unlicense: [
        "This is free and unencumbered software released into the public domain.",
        "",
        "Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means.",
        "",
        "In jurisdictions that recognize copyright laws, the author or authors of this software dedicate any and all copyright interest in the software to the public domain. We make this dedication for the benefit of the public at large and to the detriment of our heirs and successors. We intend this dedication to be an overt act of relinquishment in perpetuity of all present and future rights to this software under copyright law.",
        "",
        "THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.",
        "",
        "For more information, please refer to <https://unlicense.org>",
    ].join("\n"),
};

/** A license text fetcher for SPDX identifiers the templates do not cover. */
export type LicenseTextFetcher = (licenseId: string) => Promise<string>;

export async function fetchLicenseTextFromSpdx(licenseId: string): Promise<string> {
    const url = `${spdxLicenseUrl}/${encodeURIComponent(licenseId)}.json`;
    const response = await fetch(url, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(fetchTimeoutMs),
    });
    if (!response.ok) {
        throw new Error(`SPDX returned HTTP ${response.status} for ${licenseId}.`);
    }
    const body = (await response.json()) as { licenseText?: string };
    if (typeof body.licenseText !== "string" || body.licenseText.length === 0) {
        throw new Error(`SPDX has no license text for ${licenseId}.`);
    }
    return body.licenseText;
}

/** Flattens `bun pm licenses --json` output, excluding neoj's own packages. */
export function collectLicenseEntries(report: LicenseReport): NoticeEntry[] {
    const entries: NoticeEntry[] = [];

    for (const group of Object.values(report)) {
        for (const item of group) {
            if (item.name.startsWith("@neoj/")) {
                continue;
            }
            const packageRoot = item.paths[0];
            if (packageRoot === undefined) {
                continue;
            }
            entries.push({
                name: item.name,
                version: item.versions[0] ?? "unknown",
                license: item.license,
                homepage: item.homepage ?? undefined,
                packageRoot,
            });
        }
    }

    return entries.sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
}

/**
 * Finds a package's license file despite the usual filename variations
 * (`LICENSE`, `license.txt`, `LICENSE.md`, `MIT-LICENSE`, `LICENCE.rst`, ...).
 * Returns the matching file name, or null when the package root has none.
 */
export async function findLicenseFile(packageRoot: string): Promise<string | null> {
    let fileNames: string[];
    try {
        fileNames = (await readdir(packageRoot, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && isLicenseFile(entry.name))
            .map((entry) => entry.name);
    } catch {
        return null;
    }

    const priorities = new Map(fileNames.map((name) => [name, licenseFilePriority(name)]));
    return (
        fileNames.sort((left, right) => {
            const priority = priorities.get(left)! - priorities.get(right)!;
            if (priority !== 0) {
                return priority;
            }
            return left.length - right.length || (left < right ? -1 : 1);
        })[0] ?? null
    );
}

function isLicenseFile(fileName: string): boolean {
    return licenseFilePriority(fileName) < Number.MAX_SAFE_INTEGER;
}

function licenseFilePriority(fileName: string): number {
    const lower = fileName.toLowerCase();
    // `licen[cs]e` covers both spellings; files like `MIT-LICENSE.txt` end with
    // the word while `LICENSE-MIT`, `LICENSE.md` and `license.txt` start with it.
    if (!lower.startsWith("licen") && !lower.endsWith("license") && !lower.endsWith("licence")) {
        return Number.MAX_SAFE_INTEGER;
    }
    if (/^licen[cs]e$/.test(lower)) {
        return 0;
    }
    if (/^licen[cs]e[._-]/.test(lower)) {
        return 1;
    }
    return 2;
}

interface ResolvedLicenseText {
    text: string | null;
    source: "package-file" | "template" | "spdx";
}

async function resolveLicenseText(
    entry: NoticeEntry,
    fetchLicenseText: LicenseTextFetcher | null,
): Promise<ResolvedLicenseText> {
    const licenseFile = await findLicenseFile(entry.packageRoot);
    if (licenseFile !== null) {
        try {
            return {
                text: await Bun.file(join(entry.packageRoot, licenseFile)).text(),
                source: "package-file",
            };
        } catch {
            // Unreadable license file; fall through to the SPDX fallbacks.
        }
    }

    const template = licenseTemplates[entry.license];
    if (template !== undefined) {
        return { text: template, source: "template" };
    }

    if (fetchLicenseText !== null) {
        try {
            return { text: await fetchLicenseText(entry.license), source: "spdx" };
        } catch {
            return { text: null, source: "spdx" };
        }
    }

    return { text: null, source: "template" };
}

async function entryLicenseSection(
    entry: NoticeEntry,
    fetchLicenseText: LicenseTextFetcher | null,
    warnings: NoticeWarning[],
): Promise<string> {
    const lines = [`### ${entry.name}@${entry.version}`, "", `License: ${entry.license}`];
    if (entry.homepage !== undefined) {
        lines.push(`Homepage: ${entry.homepage}`);
    }

    const resolved = await resolveLicenseText(entry, fetchLicenseText);
    if (resolved.text !== null) {
        if (resolved.source !== "package-file") {
            warnings.push({
                packageName: entry.name,
                version: entry.version,
                license: entry.license,
                reason: "license-file-missing",
                detail: `used the ${resolved.source} fallback`,
            });
        }
        lines.push("", resolved.text.trim(), "");
        return lines.join("\n");
    }

    if (resolved.source === "spdx") {
        warnings.push({
            packageName: entry.name,
            version: entry.version,
            license: entry.license,
            reason: "license-text-fetch-failed",
            detail: "the SPDX fallback fetch failed",
        });
    } else {
        warnings.push({
            packageName: entry.name,
            version: entry.version,
            license: entry.license,
            reason: "license-text-unavailable",
            detail: "no license file, template, or SPDX entry was available",
        });
    }

    lines.push(
        "",
        `The license text could not be collected automatically. ` +
            `Consult ${entry.homepage ?? repositoryUrl} for the terms of ${entry.license}.`,
        "",
    );
    return lines.join("\n");
}

export function renderNoticesHeader(bunVersion: string): string {
    return [
        "Third-party notices for neoj",
        "============================",
        "",
        "This file collects the license information of the software distributed",
        "with neoj. It is generated by scripts/generate-notices.ts; do not edit it",
        "by hand.",
        "",
        "neoj itself is licensed under the MIT License. The full license text is in",
        "the LICENSE file distributed alongside this notice, and the complete",
        `source code is published at ${repositoryUrl}.`,
        "",
        "The standalone binaries (and the @neoj/cli-<platform> packages, which ship",
        "the same binaries) embed the Bun runtime. Bun is MIT-licensed, but it",
        "statically links JavaScriptCore and WebKit (LGPL-2), tinycc (LGPL-2.1) and",
        "other libraries under their own terms. LGPL-2 requires a statically linked",
        "application to stay relinkable against a modified library; neoj publishes",
        "its complete source code at the URL above, and the repository documents",
        "how to rebuild the binaries with a chosen Bun toolchain.",
        "",
        `## Bun runtime (v${bunVersion})`,
        "",
        "The following is Bun's LICENSE.md:",
        "https://github.com/oven-sh/bun/blob/bun-v" + bunVersion + "/LICENSE.md",
        "",
        "---",
        "",
    ].join("\n");
}

export async function generateNotices(
    report: LicenseReport,
    bunVersion: string,
    bunLicense: string,
    fetchLicenseText: LicenseTextFetcher | null = fetchLicenseTextFromSpdx,
): Promise<GeneratedNotices> {
    const entries = collectLicenseEntries(report);
    const warnings: NoticeWarning[] = [];

    const sections: string[] = [
        renderNoticesHeader(bunVersion),
        bunLicense.trim(),
        "",
        "## npm dependencies",
        "",
        "The entries below cover every package in neoj's lockfile, including",
        "development-time tools; the standalone binaries bundle a subset of them.",
        "",
    ];

    for (const entry of entries) {
        sections.push(await entryLicenseSection(entry, fetchLicenseText, warnings));
        sections.push("---");
    }

    return { content: `${sections.join("\n").trimEnd()}\n`, warnings };
}

export async function fetchBunLicense(bunVersion: string): Promise<string> {
    const url = `https://raw.githubusercontent.com/oven-sh/bun/bun-v${bunVersion}/LICENSE.md`;
    let response: Response;
    try {
        response = await fetch(url, {
            headers: { "User-Agent": userAgent },
            signal: AbortSignal.timeout(fetchTimeoutMs),
        });
    } catch (error) {
        throw new Error(
            `Could not download Bun's LICENSE.md from ${url}: ` +
                `${error instanceof Error ? error.message : String(error)}. ` +
                "The release notices need network access; retry the workflow or check github.com's availability.",
        );
    }
    if (!response.ok) {
        throw new Error(
            `Downloading Bun's LICENSE.md failed with HTTP ${response.status} (${url}). ` +
                `Verify that the tag bun-v${bunVersion} exists in oven-sh/bun.`,
        );
    }
    return await response.text();
}

async function runBun(args: string[]): Promise<string> {
    const result = Bun.spawnSync(args, { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) {
        const stderr = result.stderr.toString().trim();
        throw new Error(`\`${args.join(" ")}\` failed${stderr ? `: ${stderr}` : ""}.`);
    }
    return result.stdout.toString();
}

async function main(outputPath: string): Promise<void> {
    const bunVersion = (await runBun(["bun", "--version"])).trim();
    const bunLicense = await fetchBunLicense(bunVersion);

    const report = JSON.parse(await runBun(["bun", "pm", "licenses", "--json"])) as LicenseReport;
    const notices = await generateNotices(report, bunVersion, bunLicense);

    // `mkdir('.', ...)` throws EEXIST on Windows, so only create the output
    // directory when the path actually has one.
    const outputDirectory = dirname(outputPath);
    if (outputDirectory !== "." && outputDirectory !== "") {
        await mkdir(outputDirectory, { recursive: true });
    }
    await Bun.write(outputPath, notices.content);

    for (const warning of notices.warnings) {
        console.warn(
            `notices: ${warning.reason.replace(/-/g, " ")}: ${warning.packageName}@${warning.version} ` +
                `(license ${warning.license})${warning.detail ? `, ${warning.detail}` : ""}`,
        );
    }

    const packageCount = collectLicenseEntries(report).length;
    console.log(`Wrote THIRD_PARTY_NOTICES.txt for ${packageCount} packages to ${outputPath}.`);
}

if (import.meta.main) {
    const outputPath = process.argv[2] ?? "THIRD_PARTY_NOTICES.txt";
    await main(outputPath);
}
