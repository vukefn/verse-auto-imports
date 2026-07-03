import * as path from "path";
import Mocha from "mocha";

/**
 * Minimal suite for the packaged-vsix run: only the activation tests. The
 * injection-driven suites stay in the development-path run (runTests.ts);
 * this run exists to catch packaging regressions, and activation is the
 * signal for those.
 */
export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: "bdd",
        color: true,
        timeout: 30000,
    });

    mocha.addFile(path.join(__dirname, "..", "suite", "activation.itest.js"));

    await new Promise<void>((resolve, reject) => {
        mocha.run((failures) => {
            if (failures > 0) {
                reject(new Error(`${failures} vsix activation test(s) failed`));
            } else {
                resolve();
            }
        });
    });
}
