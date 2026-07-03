import * as fs from "fs";
import * as path from "path";
import Mocha from "mocha";

/**
 * Mocha entry point called by the extension host (via
 * `--extensionTestsPath`). Collects every compiled `*.itest.js` file in this
 * directory tree. The `.itest` suffix keeps the files out of the Jest unit
 * run, which matches `*.test.ts`.
 */
export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: "bdd",
        color: true,
        timeout: 30000,
    });

    const entries = fs.readdirSync(__dirname, { recursive: true, encoding: "utf8" });
    for (const entry of entries.sort()) {
        if (entry.endsWith(".itest.js")) {
            mocha.addFile(path.join(__dirname, entry));
        }
    }

    await new Promise<void>((resolve, reject) => {
        mocha.run((failures) => {
            if (failures > 0) {
                reject(new Error(`${failures} integration test(s) failed`));
            } else {
                resolve();
            }
        });
    });
}
