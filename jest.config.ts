import type { Config } from "jest";

const config: Config = {
    preset: "ts-jest",
    testEnvironment: "node",
    roots: ["<rootDir>/src"],
    testMatch: ["**/__tests__/**/*.test.ts"],
    // The extension-host integration suite (mocha, *.itest.ts) must never run
    // under Jest; it requires a real VS Code instance.
    testPathIgnorePatterns: ["<rootDir>/src/test-integration/"],
    moduleFileExtensions: ["ts", "js", "json"],
    moduleNameMapper: {
        "^vscode$": "<rootDir>/src/__mocks__/vscode.ts",
    },
};

export default config;
