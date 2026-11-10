/** Format a byte count for humans, e.g. `512 B`, `128.0 KiB`, `1.5 MiB`. */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
