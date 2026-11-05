import open from "tiny-open";

/**
 * Open a URL in the user's default browser.
 *
 * Returns `false` when the platform could not launch a browser, so callers can
 * print the URL and let the user open it by hand.
 */
export async function openInBrowser(url: string): Promise<boolean> {
    try {
        return await open(url);
    } catch {
        return false;
    }
}
