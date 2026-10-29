import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { loginToAtCoder } from "./login/atcoder";

const providers = [{ name: "atcoder", description: "Log in to AtCoder", login: loginToAtCoder }];

export function createLoginCommand(): Command {
    const login = new Command("login").description("Log in to a competitive programming platform");

    for (const provider of providers) {
        login
            .command(provider.name)
            .description(provider.description)
            .action(async () => {
                try {
                    await provider.login();
                    consola.success(`Logged in to ${provider.name}.`);
                } catch (error) {
                    consola.error(error instanceof Error ? error.message : String(error));
                    process.exitCode = 1;
                }
            });
    }

    return login;
}
