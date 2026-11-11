import { repository, version } from "../package.json";

/** Package repository URL without the `git+` prefix or `.git` suffix. */
const REPOSITORY_URL = repository.url.replace(/^git\+/u, "").replace(/\.git$/u, "");

/** Sent on every outbound HTTP request so platforms can identify the client. */
export const USER_AGENT = `neoj/${version} (+${REPOSITORY_URL})`;
