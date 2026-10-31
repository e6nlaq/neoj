import { styleText } from "node:util";

import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { platforms } from "@/feature/platforms";
import { readAuth } from "@/lib/util/auth";

export interface PlatformLoginStatus {
    platform: string;
    displayName: string;
    status: "logged-in" | "logged-out" | "error";
    error?: string;
}

export async function getLoginStatuses(
    auth: Record<string, unknown>,
    offline = false,
): Promise<PlatformLoginStatus[]> {
    const statuses: PlatformLoginStatus[] = [];
    for (const platform of platforms) {
        try {
            const savedAuth = auth[platform.name];
            const loggedIn = offline
                ? platform.hasCredentials(savedAuth)
                : await platform.isLoggedIn(savedAuth);
            statuses.push({
                platform: platform.name,
                displayName: platform.displayName,
                status: loggedIn ? "logged-in" : "logged-out",
            });
        } catch (error) {
            statuses.push({
                platform: platform.name,
                displayName: platform.displayName,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return statuses;
}

export function createStatusCommand(): Command {
    return new Command("status")
        .description("Check login status for all supported services")
        .option("--offline", "Use saved credentials without contacting the services")
        .action(async ({ offline }) => {
            try {
                const auth = await readAuth();
                const statuses = await getLoginStatuses(auth, offline);
                for (const result of statuses) {
                    if (result.status === "error") {
                        consola.error(
                            `${result.displayName}: Unable to check login status: ${result.error}`,
                        );
                        process.exitCode = 1;
                        continue;
                    }

                    const status =
                        result.status === "logged-in"
                            ? styleText("green", "Logged in")
                            : styleText("red", "Not logged in");
                    const note =
                        offline && result.status === "logged-in" ? " (offline, not verified)" : "";
                    consola.info(`${result.displayName}: ${status}${note}`);
                }
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
