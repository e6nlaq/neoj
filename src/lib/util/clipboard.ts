import { writeText } from "tinyclip";

/**
 * Copy text to the system clipboard.
 *
 * Returns `false` when the clipboard is unavailable, so callers can report the
 * text instead of failing silently.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await writeText(text);
        return true;
    } catch {
        return false;
    }
}
