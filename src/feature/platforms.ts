import { hasAtCoderCredentials, isAtCoderLoggedIn, loginToAtCoder } from "@/feature/login/atcoder";

export const platforms = [
    {
        name: "atcoder",
        displayName: "AtCoder",
        description: "Log in to AtCoder",
        login: loginToAtCoder,
        isLoggedIn: isAtCoderLoggedIn,
        hasCredentials: hasAtCoderCredentials,
    },
];
