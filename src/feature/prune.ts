import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import {
    pruneBuildCache,
    type PruneBuildCacheOptions,
    type PruneBuildCacheResult,
} from "@/lib/util/build-cache";
import { requireInitializedProject } from "@/lib/util/project";

const byteUnits = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

export function formatByteSize(bytes: number): string {
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < byteUnits.length - 1) {
        value /= 1024;
        unit += 1;
    }

    return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${byteUnits[unit]}`;
}

export async function pruneProjectCache(
    options: PruneBuildCacheOptions = {},
): Promise<PruneBuildCacheResult> {
    const projectRoot = await requireInitializedProject(process.cwd());
    return pruneBuildCache(projectRoot, options);
}

function reportResult(result: PruneBuildCacheResult): void {
    if (result.entryCount === 0) {
        consola.info("No cached builds.");
        return;
    }

    const summary = `${result.entryCount} cached build(s) (${formatByteSize(result.bytes)})`;
    if (result.removed) {
        consola.success(`Removed ${summary}.`);
    } else {
        consola.info(`Would remove ${summary}.`);
    }
}

export function createPruneCommand(): Command {
    return new Command("prune")
        .description("Remove every cached build")
        .option("--dry-run", "Show what would be removed without deleting it")
        .action(async ({ dryRun }) => {
            try {
                reportResult(await pruneProjectCache({ dryRun }));
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
