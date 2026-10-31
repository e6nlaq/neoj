import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { platforms } from "./platforms";

export function createLoginCommand(): Command {
    const login = new Command("login").description("Log in to a competitive programming platform");

    for (const provider of platforms) {
        login
            .command(provider.name)
            .description(provider.description)
            .action(async () => {
                try {
                    const loggedIn = await provider.login();
                    if (loggedIn) {
                        consola.success(`Logged in to ${provider.displayName}.`);
                    } else {
                        consola.info("Login cancelled.");
                    }
                } catch (error) {
                    consola.error(error instanceof Error ? error.message : String(error));
                    process.exitCode = 1;
                }
            });
    }

    return login;
}
