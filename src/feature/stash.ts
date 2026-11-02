import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { deriveProblemKey } from "@/feature/problem-sources";
import type { Config } from "@/lib/util/config";
import { loadConfig } from "@/lib/util/config";
import { readProblemMetadata } from "@/lib/util/problem-metadata";
import { requireInitializedProject } from "@/lib/util/project";
import {
    applyStash,
    clearStashes,
    dropStash,
    formatStashTimestamp,
    listStashes,
    saveStash,
    type ApplyStashResult,
    type ProblemKey,
    type SaveStashResult,
    type StashEntry,
} from "@/lib/util/stash";

interface CurrentProblem {
    projectRoot: string;
    config: Config;
    key: ProblemKey;
    url: string;
}

export interface StashListResult {
    entries: StashEntry[];
    current?: ProblemKey;
}

export interface PopStashResult {
    applied: ApplyStashResult;
    dropped: boolean;
}

function formatKey(key: ProblemKey): string {
    return `${key.platform}/${key.slug}`;
}

export async function loadCurrentProblem(): Promise<CurrentProblem> {
    const projectRoot = await requireInitializedProject(process.cwd());
    const config = await loadConfig();
    const metadata = await readProblemMetadata(projectRoot);
    if (metadata === undefined) {
        throw new Error('No problem is recorded. Run "neoj download <url>" first.');
    }

    return {
        projectRoot,
        config,
        key: deriveProblemKey(metadata.url),
        url: metadata.url,
    };
}

export async function saveCurrentProblemStash(force: boolean): Promise<SaveStashResult> {
    const current = await loadCurrentProblem();
    return saveStash(
        current.projectRoot,
        current.config,
        { url: current.url, key: current.key },
        { force: force || current.config.stash.force },
    );
}

export async function applyCurrentProblemStash(): Promise<ApplyStashResult> {
    const current = await loadCurrentProblem();
    return applyStash(current.projectRoot, current.config, current.key);
}

export async function popCurrentProblemStash(): Promise<PopStashResult> {
    const current = await loadCurrentProblem();
    const applied = await applyStash(current.projectRoot, current.config, current.key);
    const dropped = await dropStash(current.projectRoot, applied.key);
    return { applied, dropped };
}

export async function dropCurrentProblemStash(): Promise<ProblemKey> {
    const current = await loadCurrentProblem();
    const dropped = await dropStash(current.projectRoot, current.key);
    if (!dropped) {
        throw new Error(`No stash found for "${formatKey(current.key)}".`);
    }

    return current.key;
}

export async function clearProblemStashes(force: boolean): Promise<number> {
    if (!force) {
        throw new Error('Refusing to delete every stash. Re-run "neoj stash clear --force".');
    }

    const projectRoot = await requireInitializedProject(process.cwd());
    return clearStashes(projectRoot);
}

export async function listProblemStashes(): Promise<StashListResult> {
    const projectRoot = await requireInitializedProject(process.cwd());
    const metadata = await readProblemMetadata(projectRoot);

    let current: ProblemKey | undefined;
    if (metadata !== undefined) {
        try {
            current = deriveProblemKey(metadata.url);
        } catch {
            current = undefined;
        }
    }

    return { entries: await listStashes(projectRoot), current };
}

function reportSave(result: SaveStashResult): void {
    if (result.replacedAt === undefined) {
        consola.success(
            `Saved the stash for "${formatKey(result.key)}" (${result.fileCount} file(s)).`,
        );
        return;
    }

    consola.success(
        `Replaced the stash for "${formatKey(result.key)}" (${result.fileCount} file(s), previous: ${formatStashTimestamp(result.replacedAt)}).`,
    );
}

function reportApply(result: ApplyStashResult): void {
    for (const warning of result.warnings) {
        consola.warn(warning);
    }
    consola.success(
        `Applied the stash for "${formatKey(result.key)}" (${result.written} file(s) written, ${result.removed} removed).`,
    );
}

async function run(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        consola.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

export function createStashCommand(): Command {
    const command = new Command("stash").description(
        "Save and restore the working files of the current problem",
    );

    command.addCommand(
        new Command("save")
            .description("Save src and the test-case directory of the current problem")
            .option("-f, --force", "Replace an existing stash")
            .action(({ force }) =>
                run(async () => {
                    reportSave(await saveCurrentProblemStash(force === true));
                }),
            ),
    );

    command.addCommand(
        new Command("list").description("List saved stashes").action(() =>
            run(async () => {
                const { entries, current } = await listProblemStashes();
                if (entries.length === 0) {
                    consola.info("No stashes.");
                    return;
                }

                for (const entry of entries) {
                    const isCurrent =
                        current !== undefined &&
                        current.platform === entry.key.platform &&
                        current.slug === entry.key.slug;
                    const marker = isCurrent ? "* " : "  ";
                    consola.info(
                        `${marker}${formatKey(entry.key)}  saved ${formatStashTimestamp(entry.meta.saved_at)}  (${entry.meta.file_count} file(s))`,
                    );
                }
            }),
        ),
    );

    command.addCommand(
        new Command("apply").description("Restore the stash of the current problem").action(() =>
            run(async () => {
                reportApply(await applyCurrentProblemStash());
            }),
        ),
    );

    command.addCommand(
        new Command("pop")
            .description("Restore the stash of the current problem and remove it")
            .action(() =>
                run(async () => {
                    const { applied, dropped } = await popCurrentProblemStash();
                    reportApply(applied);
                    if (dropped) {
                        consola.success(`Dropped the stash for "${formatKey(applied.key)}".`);
                    }
                }),
            ),
    );

    command.addCommand(
        new Command("drop").description("Remove the stash of the current problem").action(() =>
            run(async () => {
                const key = await dropCurrentProblemStash();
                consola.success(`Dropped the stash for "${formatKey(key)}".`);
            }),
        ),
    );

    command.addCommand(
        new Command("clear")
            .description("Remove every stash")
            .option("-f, --force", "Delete every stash without confirmation")
            .action(({ force }) =>
                run(async () => {
                    const count = await clearProblemStashes(force === true);
                    if (count === 0) {
                        consola.info("No stashes to clear.");
                        return;
                    }
                    consola.success(`Cleared ${count} stash(es).`);
                }),
            ),
    );

    command.action(() =>
        run(async () => {
            reportSave(await saveCurrentProblemStash(false));
        }),
    );

    return command;
}
