import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { hasErrorCode } from "@/lib/util/errors";

/** Directory segments whose contents neoj must never replace or download into. */
const reservedSegments = new Map([
    [".git", "the Git metadata directory"],
    [".neoj", "the neoj metadata directory"],
]);

/** Whether `candidate` is `parent` itself or lives below it. */
export function isWithin(parent: string, candidate: string): boolean {
    const path = relative(parent, candidate);
    return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/**
 * Resolve a configured directory to an absolute path inside the project.
 *
 * The path must be relative, must stay inside the project, must not contain a
 * reserved metadata segment, and must not pass through a symbolic link.
 */
export async function resolveProjectDirectory(
    projectRoot: string,
    folder: string,
    name: string,
): Promise<string> {
    if (!folder || isAbsolute(folder)) {
        throw new Error(`${name} must be a non-empty relative path.`);
    }

    const root = await realpath(projectRoot);
    const target = resolve(root, folder);
    const targetRelative = relative(root, target);
    if (
        targetRelative === "" ||
        targetRelative === ".." ||
        targetRelative.startsWith(`..${sep}`) ||
        isAbsolute(targetRelative)
    ) {
        throw new Error(`${name} must resolve to a directory inside the project.`);
    }

    const segments = targetRelative.split(sep);
    for (const segment of segments) {
        const description = reservedSegments.get(segment.toLowerCase());
        if (description !== undefined) {
            throw new Error(`${name} cannot target ${description}.`);
        }
    }

    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
        current = join(current, segments[index] ?? "");
        let entry;
        try {
            entry = await lstat(current);
        } catch (error) {
            if (hasErrorCode(error, "ENOENT")) {
                break;
            }
            throw error;
        }

        if (entry.isSymbolicLink()) {
            throw new Error(`${name} cannot pass through a symbolic link.`);
        }
        if (index < segments.length - 1 && !entry.isDirectory()) {
            throw new Error(`${name} parent path "${current}" is not a directory.`);
        }
        if (index === segments.length - 1 && !entry.isDirectory()) {
            throw new Error(`${name} "${current}" exists but is not a directory.`);
        }
    }

    return target;
}

/** Reject nested or identical directories that would be replaced together. */
export function assertDirectoriesDoNotOverlap(
    left: { path: string; name: string },
    right: { path: string; name: string },
): void {
    if (isWithin(left.path, right.path) || isWithin(right.path, left.path)) {
        throw new Error(`${left.name} and ${right.name} must not overlap.`);
    }
}
