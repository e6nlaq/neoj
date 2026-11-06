import type { Stats } from "node:fs";
import {
    copyFile,
    lstat,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    rmdir,
    writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import * as v from "valibot";

import type { Config } from "@/lib/util/config";
import { commitStagedDirectory } from "@/lib/util/directory-replace";
import { hasErrorCode } from "@/lib/util/errors";
import { assertDirectoriesDoNotOverlap, resolveProjectDirectory } from "@/lib/util/project-path";

export interface ProblemKey {
    platform: string;
    slug: string;
}

export const stashSlots = ["src", "testcase"] as const;

export type StashSlot = (typeof stashSlots)[number];

export interface StashMeta {
    url: string;
    platform: string;
    slug: string;
    saved_at: string;
    slots: Partial<Record<StashSlot, string>>;
    file_count: number;
}

export interface StashEntry {
    key: ProblemKey;
    directory: string;
    meta: StashMeta;
}

export interface StashTarget {
    url: string;
    key: ProblemKey;
}

export interface SaveStashOptions {
    force: boolean;
    now?: Date;
}

export interface SaveStashResult {
    key: ProblemKey;
    directory: string;
    fileCount: number;
    replacedAt?: string;
}

export interface ApplyStashResult {
    key: ProblemKey;
    savedAt: string;
    written: number;
    removed: number;
    warnings: string[];
}

export class EmptyStashError extends Error {
    constructor() {
        super('There is nothing to stash: "src" and "testcase.folder" contain no files.');
        this.name = "EmptyStashError";
    }
}

const stashMetaSchema = v.strictObject({
    url: v.pipe(v.string(), v.minLength(1)),
    platform: v.pipe(v.string(), v.minLength(1)),
    slug: v.pipe(v.string(), v.minLength(1)),
    saved_at: v.pipe(v.string(), v.minLength(1)),
    slots: v.strictObject({
        src: v.optional(v.pipe(v.string(), v.minLength(1))),
        testcase: v.optional(v.pipe(v.string(), v.minLength(1))),
    }),
    file_count: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const STAGING_PREFIX = ".";

export function getStashRoot(projectRoot: string): string {
    return join(resolve(projectRoot), ".neoj", "stash");
}

function formatKey(key: ProblemKey): string {
    return `${key.platform}/${key.slug}`;
}

function normalizeSegment(value: string, description: string): string {
    if (!SLUG_PATTERN.test(value)) {
        throw new Error(`Invalid stash ${description} "${value}".`);
    }

    return value;
}

function getStashDirectory(projectRoot: string, key: ProblemKey): string {
    return join(
        getStashRoot(projectRoot),
        normalizeSegment(key.platform, "platform"),
        normalizeSegment(key.slug, "name"),
    );
}

export function formatStashTimestamp(savedAt: string): string {
    const date = new Date(savedAt);
    if (Number.isNaN(date.getTime())) {
        return savedAt;
    }

    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function lstatOptional(path: string): Promise<Stats | undefined> {
    try {
        return await lstat(path);
    } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
            return undefined;
        }
        if (hasErrorCode(error, "ENOTDIR")) {
            throw new Error(`"${dirname(path)}" is not a directory.`, { cause: error });
        }
        throw error;
    }
}

async function ensureDirectory(directory: string): Promise<void> {
    try {
        await mkdir(directory);
    } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) {
            throw error;
        }
    }

    const stats = await lstat(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Stash path "${directory}" is not a directory.`);
    }
}

async function assertRealDirectory(directory: string, description: string): Promise<void> {
    const stats = await lstatOptional(directory);
    if (stats !== undefined && (stats.isSymbolicLink() || !stats.isDirectory())) {
        throw new Error(`${description} "${directory}" is not a directory.`);
    }
}

async function collectFiles(directory: string, name: string): Promise<string[][]> {
    const files: string[][] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        const stats = await lstat(path);
        if (stats.isSymbolicLink()) {
            throw new Error(`${name} cannot contain symbolic links ("${path}").`);
        }
        if (stats.isDirectory()) {
            for (const child of await collectFiles(path, name)) {
                files.push([entry.name, ...child]);
            }
        } else if (stats.isFile()) {
            files.push([entry.name]);
        } else {
            throw new Error(`${name} contains an unsupported file type ("${path}").`);
        }
    }

    return files;
}

function fileKey(segments: readonly string[]): string {
    return segments.join("/");
}

async function readStashMeta(directory: string): Promise<StashMeta | undefined> {
    const metaPath = join(directory, "meta.json");
    const stats = await lstatOptional(metaPath);
    if (stats === undefined) {
        return undefined;
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(`Stash metadata "${metaPath}" is not a regular file.`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(await readFile(metaPath, "utf8"));
    } catch (error) {
        throw new Error(`Stash metadata "${metaPath}" is not valid JSON.`, { cause: error });
    }

    const result = v.safeParse(stashMetaSchema, parsed);
    if (!result.success) {
        throw new Error(`Stash metadata "${metaPath}" is invalid.`, { cause: result.issues });
    }
    if (result.output.slots.src === undefined && result.output.slots.testcase === undefined) {
        throw new Error(`Stash metadata "${metaPath}" does not record any saved directory.`);
    }

    return result.output;
}

export async function findStash(
    projectRoot: string,
    key: ProblemKey,
): Promise<StashEntry | undefined> {
    const stashRoot = getStashRoot(projectRoot);
    const directory = getStashDirectory(projectRoot, key);
    await assertRealDirectory(stashRoot, "Stash directory");
    await assertRealDirectory(dirname(directory), "Stash directory");

    const stats = await lstatOptional(directory);
    if (stats === undefined) {
        return undefined;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Stash "${directory}" is not a directory.`);
    }

    const meta = await readStashMeta(directory);
    if (meta === undefined) {
        throw new Error(`Stash "${directory}" is missing meta.json.`);
    }
    if (meta.platform !== key.platform || meta.slug !== key.slug) {
        throw new Error(`Stash metadata in "${directory}" does not describe "${formatKey(key)}".`);
    }

    return { key, directory, meta };
}

export async function listStashes(projectRoot: string): Promise<StashEntry[]> {
    const stashRoot = getStashRoot(projectRoot);
    const rootStats = await lstatOptional(stashRoot);
    if (rootStats === undefined) {
        return [];
    }
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        throw new Error(`Stash directory "${stashRoot}" is not a directory.`);
    }

    const entries: StashEntry[] = [];
    for (const platformEntry of await readdir(stashRoot, { withFileTypes: true })) {
        if (!platformEntry.isDirectory() || platformEntry.name.startsWith(STAGING_PREFIX)) {
            continue;
        }

        const platformDirectory = join(stashRoot, platformEntry.name);
        const platformStats = await lstat(platformDirectory);
        if (platformStats.isSymbolicLink()) {
            throw new Error(`Stash path "${platformDirectory}" cannot be a symbolic link.`);
        }

        for (const slugEntry of await readdir(platformDirectory, { withFileTypes: true })) {
            if (!slugEntry.isDirectory() || slugEntry.name.startsWith(STAGING_PREFIX)) {
                continue;
            }

            const directory = join(platformDirectory, slugEntry.name);
            const slugStats = await lstat(directory);
            if (slugStats.isSymbolicLink()) {
                throw new Error(`Stash path "${directory}" cannot be a symbolic link.`);
            }

            const meta = await readStashMeta(directory);
            if (meta === undefined) {
                continue;
            }

            entries.push({
                key: { platform: platformEntry.name, slug: slugEntry.name },
                directory,
                meta,
            });
        }
    }

    entries.sort((a, b) => {
        const left = formatKey(a.key);
        const right = formatKey(b.key);
        if (left === right) {
            return 0;
        }
        return left < right ? -1 : 1;
    });

    return entries;
}

interface SlotSource {
    slot: StashSlot;
    name: string;
    folder: string;
}

function getSlotSources(config: Config): SlotSource[] {
    const sources: SlotSource[] = [];
    if (config.src !== undefined) {
        sources.push({ slot: "src", name: "src", folder: config.src });
    }
    sources.push({ slot: "testcase", name: "testcase.folder", folder: config.testcase.folder });
    return sources;
}

export async function saveStash(
    projectRoot: string,
    config: Config,
    target: StashTarget,
    options: SaveStashOptions,
): Promise<SaveStashResult> {
    const { key } = target;
    const slotSources = getSlotSources(config);
    const resolvedDirectories: Array<{ path: string; name: string }> = [];
    const slotFiles = new Map<
        StashSlot,
        { folder: string; directory: string; files: string[][] }
    >();
    let fileCount = 0;

    for (const source of slotSources) {
        const directory = await resolveProjectDirectory(projectRoot, source.folder, source.name);
        for (const resolved of resolvedDirectories) {
            assertDirectoriesDoNotOverlap(resolved, { path: directory, name: source.name });
        }
        resolvedDirectories.push({ path: directory, name: source.name });

        const stats = await lstatOptional(directory);
        if (stats === undefined) {
            continue;
        }
        if (!stats.isDirectory()) {
            throw new Error(`${source.name} "${directory}" is not a directory.`);
        }

        const files = await collectFiles(directory, source.name);
        if (files.length === 0) {
            continue;
        }

        slotFiles.set(source.slot, { folder: source.folder, directory, files });
        fileCount += files.length;
    }

    if (fileCount === 0) {
        throw new EmptyStashError();
    }

    const metadataDirectory = join(resolve(projectRoot), ".neoj");
    await ensureDirectory(metadataDirectory);
    const stashRoot = getStashRoot(projectRoot);
    await ensureDirectory(stashRoot);
    const platformDirectory = join(stashRoot, normalizeSegment(key.platform, "platform"));
    await ensureDirectory(platformDirectory);

    const directory = getStashDirectory(projectRoot, key);
    const existingStats = await lstatOptional(directory);
    let replacedAt: string | undefined;
    if (existingStats !== undefined) {
        if (existingStats.isSymbolicLink() || !existingStats.isDirectory()) {
            throw new Error(`Stash "${directory}" is not a directory.`);
        }

        let previousMeta: StashMeta | undefined;
        try {
            previousMeta = await readStashMeta(directory);
        } catch {
            previousMeta = undefined;
        }
        replacedAt = previousMeta?.saved_at;

        if (!options.force) {
            const previous =
                replacedAt === undefined ? "" : ` (saved ${formatStashTimestamp(replacedAt)})`;
            throw new Error(
                `A stash for "${formatKey(key)}" already exists${previous}. Re-run with "--force" or set stash.force = true.`,
            );
        }
    }

    const stagingDirectory = await mkdtemp(join(platformDirectory, `.${key.slug}-stash-`));
    try {
        const slots: StashMeta["slots"] = {};
        for (const [slot, source] of slotFiles) {
            const slotDirectory = join(stagingDirectory, slot);
            await mkdir(slotDirectory, { recursive: true });
            for (const segments of source.files) {
                const destination = join(slotDirectory, ...segments);
                await mkdir(dirname(destination), { recursive: true });
                await copyFile(join(source.directory, ...segments), destination);
            }
            slots[slot] = source.folder;
        }

        const meta: StashMeta = {
            url: target.url,
            platform: key.platform,
            slug: key.slug,
            saved_at: (options.now ?? new Date()).toISOString(),
            slots,
            file_count: fileCount,
        };
        await writeFile(join(stagingDirectory, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, {
            encoding: "utf8",
            flag: "wx",
        });

        await commitStagedDirectory(stagingDirectory, directory, existingStats !== undefined);
    } finally {
        await rm(stagingDirectory, { recursive: true, force: true });
    }

    return { key, directory, fileCount, replacedAt };
}

export async function applyStash(
    projectRoot: string,
    config: Config,
    key: ProblemKey,
): Promise<ApplyStashResult> {
    const entry = await findStash(projectRoot, key);
    if (entry === undefined) {
        throw new Error(`No stash found for "${formatKey(key)}".`);
    }

    const warnings: string[] = [];
    let written = 0;
    let removed = 0;

    for (const slot of stashSlots) {
        const savedFolder = entry.meta.slots[slot];
        if (savedFolder === undefined) {
            continue;
        }

        const name = slot === "src" ? "src" : "testcase.folder";
        const configured = slot === "src" ? config.src : config.testcase.folder;
        if (configured === undefined) {
            warnings.push(`The stash contains "src", but src is not configured. Skipped it.`);
            continue;
        }
        if (configured !== savedFolder) {
            warnings.push(
                `The stash saved "${name}" from "${savedFolder}" and restores it to "${configured}".`,
            );
        }

        const sourceDirectory = join(entry.directory, slot);
        const sourceStats = await lstatOptional(sourceDirectory);
        if (
            sourceStats === undefined ||
            sourceStats.isSymbolicLink() ||
            !sourceStats.isDirectory()
        ) {
            throw new Error(`Stash "${entry.directory}" is missing the "${slot}" directory.`);
        }
        const files = await collectFiles(sourceDirectory, `Stash "${slot}"`);

        const targetDirectory = await resolveProjectDirectory(projectRoot, configured, name);
        const existingStats = await lstatOptional(targetDirectory);
        const existingFiles = new Set<string>();
        if (existingStats !== undefined) {
            if (existingStats.isSymbolicLink() || !existingStats.isDirectory()) {
                throw new Error(`${name} "${targetDirectory}" is not a directory.`);
            }
            for (const file of await collectFiles(targetDirectory, name)) {
                existingFiles.add(fileKey(file));
            }
        }

        const stashFiles = new Set(files.map((file) => fileKey(file)));
        const parentDirectory = dirname(targetDirectory);
        await mkdir(parentDirectory, { recursive: true });
        const stagingDirectory = await mkdtemp(
            join(parentDirectory, `.${basename(targetDirectory)}-stash-`),
        );
        try {
            for (const segments of files) {
                const destination = join(stagingDirectory, ...segments);
                await mkdir(dirname(destination), { recursive: true });
                await copyFile(join(sourceDirectory, ...segments), destination);
            }

            await commitStagedDirectory(
                stagingDirectory,
                targetDirectory,
                existingStats !== undefined,
            );
        } finally {
            await rm(stagingDirectory, { recursive: true, force: true });
        }

        written += files.length;
        removed += [...existingFiles].filter((path) => !stashFiles.has(path)).length;
    }

    return { key, savedAt: entry.meta.saved_at, written, removed, warnings };
}

export async function dropStash(projectRoot: string, key: ProblemKey): Promise<boolean> {
    const entry = await findStash(projectRoot, key);
    if (entry === undefined) {
        return false;
    }

    await rm(entry.directory, { recursive: true });
    try {
        await rmdir(dirname(entry.directory));
    } catch (error) {
        if (
            !hasErrorCode(error, "ENOTEMPTY") &&
            !hasErrorCode(error, "EEXIST") &&
            !hasErrorCode(error, "ENOENT") &&
            !hasErrorCode(error, "EPERM")
        ) {
            throw error;
        }
    }

    return true;
}

export async function clearStashes(projectRoot: string): Promise<number> {
    const stashRoot = getStashRoot(projectRoot);
    const entries = await listStashes(projectRoot);
    const stats = await lstatOptional(stashRoot);
    if (stats === undefined) {
        return 0;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Stash directory "${stashRoot}" is not a directory.`);
    }

    await rm(stashRoot, { recursive: true });
    return entries.length;
}
