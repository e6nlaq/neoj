import { Command, Option } from "@commander-js/extra-typings";
import { consola } from "consola";

import { platforms, type PlatformLoginOptions } from "@/feature/platforms";

export function createLoginCommand(): Command {
    const login = new Command("login").description("Log in to a competitive programming platform");

    for (const provider of platforms) {
        const command = login.command(provider.name).description(provider.description);
        for (const loginOption of provider.loginOptions) {
            const option = new Option(loginOption.flags, loginOption.description);
            if (loginOption.defaultValue !== undefined) {
                option.default(loginOption.defaultValue);
            }
            command.addOption(option);
        }

        command.action(async (options) => {
            try {
                const loggedIn = await provider.login(options as PlatformLoginOptions);
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
