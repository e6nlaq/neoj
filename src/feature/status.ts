import { styleText } from "node:util";

import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { readAuth } from "../lib/util/auth";
import { platforms } from "./platforms";

export interface PlatformLoginStatus {
    platform: string;
    displayName: string;
    status: "logged-in" | "logged-out" | "error";
    error?: string;
}

export async function getLoginStatuses(
    auth: Record<string, unknown>,
): Promise<PlatformLoginStatus[]> {
    const statuses: PlatformLoginStatus[] = [];
    for (const platform of platforms) {
        try {
            const loggedIn = await platform.isLoggedIn(auth[platform.name]);
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
        .action(async () => {
            try {
                const auth = await readAuth();
                const statuses = await getLoginStatuses(auth);
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
                    consola.info(`${result.displayName}: ${status}`);
                }
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
