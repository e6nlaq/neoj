import { Command } from "@commander-js/extra-typings";
import { confirm } from "@inquirer/prompts";
import { consola } from "consola";

import { platforms } from "@/feature/platforms";
import { clearAuth, readAuth, removeAuth } from "@/lib/util/auth";

function getDisplayName(name: string): string {
    return platforms.find((platform) => platform.name === name)?.displayName ?? name;
}

export async function logoutServices(serviceNames?: readonly string[]): Promise<void> {
    const auth = await readAuth();
    if (serviceNames === undefined) {
        const savedServices = Object.keys(auth);
        if (savedServices.length === 0) {
            consola.info("No saved login information.");
            return;
        }

        const displayNames = savedServices.map(getDisplayName);
        const shouldLogout = await confirm({
            message: `Log out of all services (${displayNames.join(", ")})?`,
            default: false,
        });
        if (!shouldLogout) {
            consola.info("Logout cancelled.");
            return;
        }

        await clearAuth();
        consola.success("Logged out of all services.");
        return;
    }

    const uniqueServiceNames = [...new Set(serviceNames)];
    const unknownServices = uniqueServiceNames.filter(
        (name) => !platforms.some((platform) => platform.name === name),
    );
    if (unknownServices.length > 0) {
        const supportedServices = platforms.map((platform) => platform.name).join(", ");
        throw new Error(
            `Unsupported service: ${unknownServices.join(", ")}. Supported services: ${supportedServices}.`,
        );
    }

    const savedServices = uniqueServiceNames.filter((name) => auth[name] !== undefined);
    const missingServices = uniqueServiceNames.filter((name) => auth[name] === undefined);
    for (const name of missingServices) {
        consola.info(`${getDisplayName(name)}: Not logged in.`);
    }

    if (savedServices.length === 0) {
        return;
    }

    const shouldLogout = await confirm({
        message: `Log out of ${savedServices.map(getDisplayName).join(", ")}?`,
        default: false,
    });
    if (!shouldLogout) {
        consola.info("Logout cancelled.");
        return;
    }

    await removeAuth(savedServices);
    for (const name of savedServices) {
        consola.success(`Logged out of ${getDisplayName(name)}.`);
    }
}

export function createLogoutCommand(): Command {
    return new Command("logout")
        .description("Log out of all services")
        .option("--service <services...>", "Log out of the specified service(s)")
        .action(async ({ service }) => {
            try {
                await logoutServices(service);
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
