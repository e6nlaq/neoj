import { hasAtCoderCredentials, isAtCoderLoggedIn, loginToAtCoder } from "@/feature/login/atcoder";
import { hasShareOjCredentials, isShareOjLoggedIn, loginToShareOj } from "@/feature/login/shareoj";
import {
    hasYukicoderCredentials,
    isYukicoderLoggedIn,
    loginToYukicoder,
} from "@/feature/login/yukicoder";

export interface PlatformLoginOptions {
    method?: string;
}

export interface PlatformLoginOption {
    flags: string;
    description: string;
    defaultValue?: string;
}

export interface Platform {
    name: string;
    displayName: string;
    description: string;
    login: (options: PlatformLoginOptions) => Promise<boolean>;
    loginOptions: readonly PlatformLoginOption[];
    isLoggedIn: (auth: unknown) => Promise<boolean>;
    hasCredentials: (auth: unknown) => boolean;
}

export const platforms: Platform[] = [
    {
        name: "atcoder",
        displayName: "AtCoder",
        description: "Log in to AtCoder",
        login: loginToAtCoder,
        loginOptions: [],
        isLoggedIn: isAtCoderLoggedIn,
        hasCredentials: hasAtCoderCredentials,
    },
    {
        name: "yukicoder",
        displayName: "yukicoder",
        description: "Log in to yukicoder",
        login: loginToYukicoder,
        loginOptions: [
            {
                flags: "--method <method>",
                description: 'Authentication method: "token" (CLI token) or "api-key"',
                defaultValue: "token",
            },
        ],
        isLoggedIn: isYukicoderLoggedIn,
        hasCredentials: hasYukicoderCredentials,
    },
    {
        name: "shareoj",
        displayName: "ShareOJ",
        description: "Log in to ShareOJ",
        login: loginToShareOj,
        loginOptions: [
            {
                flags: "--method <method>",
                description: 'Authentication method: "password" (email and password)',
                defaultValue: "password",
            },
        ],
        isLoggedIn: isShareOjLoggedIn,
        hasCredentials: hasShareOjCredentials,
    },
];
