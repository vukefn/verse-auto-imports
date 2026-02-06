import * as vscode from "vscode";
import { logger } from "../utils";
import { ImportHandler } from "../imports";
import { ProjectPathCache, DigestParser } from "../services";

export class CommandsHandler {
    private digestParser: DigestParser | null = null;

    constructor(
        private outputChannel: vscode.OutputChannel,
        private importHandler: ImportHandler,
        private projectPathCache?: ProjectPathCache
    ) {}

    async optimizeImports() {
        logger.info("CommandsHandler", "Optimizing imports command triggered");

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            logger.debug("CommandsHandler", "No active editor found");
            vscode.window.showWarningMessage("Please open a file to optimize imports");
            return;
        }

        if (editor.document.languageId !== "verse") {
            logger.debug("CommandsHandler", "Active file is not a Verse file");
            vscode.window.showWarningMessage("Optimize imports only works with Verse files");
            return;
        }

        try {
            const document = editor.document;
            const config = vscode.workspace.getConfiguration("verseAutoImports");
            const autoImportEnabled = config.get<boolean>("general.autoImport", true);
            const preferDotSyntax = config.get<string>("behavior.importSyntax", "curly") === "dot";

            logger.debug("CommandsHandler", `Auto-import: ${autoImportEnabled}, Preferred syntax: ${preferDotSyntax ? "dot" : "curly"}`);

            // Step 1: Remove all imports from the document
            logger.debug("CommandsHandler", "Step 1: Removing all imports");
            await this.importHandler.removeAllImports(document);

            // Step 2: Save the document to trigger diagnostics refresh
            logger.debug("CommandsHandler", "Step 2: Saving document to trigger diagnostics");
            await document.save();

            // Step 3: Wait a moment for diagnostics to update
            logger.debug("CommandsHandler", "Step 3: Waiting for diagnostics to update");
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Step 4: Get diagnostics for the document
            const diagnostics = vscode.languages.getDiagnostics(document.uri);
            logger.debug("CommandsHandler", `Found ${diagnostics.length} diagnostics`);

            if (autoImportEnabled) {
                // Step 5a: Auto-import is ON - wait for it to handle missing imports
                logger.debug("CommandsHandler", "Step 5a: Auto-import is enabled, waiting for automatic imports");

                // Give auto-import time to work
                await new Promise((resolve) => setTimeout(resolve, 500));

                // Convert any scattered imports to preferred syntax
                logger.debug("CommandsHandler", "Step 6: Converting scattered imports to preferred syntax");
                await this.importHandler.convertScatteredImportsToPreferredSyntax(document);

                // Step 7: Ensure proper spacing after imports
                logger.debug("CommandsHandler", "Step 7: Ensuring proper spacing after imports");
                await this.importHandler.ensureEmptyLinesAfterImports(document);
            } else {
                // Step 5b: Auto-import is OFF - manually add missing imports
                logger.debug("CommandsHandler", "Step 5b: Auto-import is disabled, manually processing diagnostics");

                // Extract import paths from diagnostics
                const missingImportPaths = this.importHandler.extractImportsFromDiagnostics(diagnostics);

                if (missingImportPaths.length > 0) {
                    logger.debug("CommandsHandler", `Found ${missingImportPaths.length} missing imports to add`);

                    // Format import statements with preferred syntax
                    const importStatements = missingImportPaths.map((path) => {
                        const statement = preferDotSyntax ? `using. ${path}` : `using { ${path} }`;
                        logger.trace("CommandsHandler", `Formatting import: ${statement}`);
                        return statement;
                    });

                    // Add imports to document
                    await this.importHandler.addImportsToDocument(document, importStatements);
                }

                // Convert any scattered imports to preferred syntax
                logger.debug("CommandsHandler", "Step 6: Converting scattered imports to preferred syntax");
                await this.importHandler.convertScatteredImportsToPreferredSyntax(document);

                // Step 7: Ensure proper spacing after imports
                logger.debug("CommandsHandler", "Step 7: Ensuring proper spacing after imports");
                await this.importHandler.ensureEmptyLinesAfterImports(document);
            }

            // Save the document again to ensure all changes are persisted
            await document.save();

            logger.info("CommandsHandler", "Successfully optimized imports");
            vscode.window.showInformationMessage("Imports optimized successfully");
        } catch (error) {
            logger.error("CommandsHandler", "Error optimizing imports", error);
            vscode.window.showErrorMessage(`Failed to optimize imports: ${error}`);
        }
    }

    /**
     * Rebuilds the project path cache.
     */
    async rebuildPathCache(): Promise<void> {
        if (!this.projectPathCache) {
            vscode.window.showWarningMessage("Project path cache is not enabled");
            return;
        }

        logger.info("CommandsHandler", "Rebuilding project path cache");

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Rebuilding project path cache...",
                cancellable: false,
            },
            async () => {
                await this.projectPathCache!.rebuildCache();
            }
        );

        const stats = this.projectPathCache.getStats();
        vscode.window.showInformationMessage(
            `Project path cache rebuilt: ${stats.identifiers} identifiers from ${stats.files} files`
        );
    }

    /**
     * Shows the current cache status.
     */
    async showCacheStatus(): Promise<void> {
        const cacheStats = this.projectPathCache?.getStats();

        const lines: string[] = [];

        if (cacheStats) {
            lines.push(`Project Cache: ${cacheStats.loaded ? "Loaded" : "Not loaded"}`);
            if (cacheStats.loaded) {
                lines.push(`  Identifiers: ${cacheStats.identifiers}`);
                lines.push(`  Files: ${cacheStats.files}`);
                if (cacheStats.generatedAt) {
                    const age = Date.now() - cacheStats.generatedAt;
                    const ageMinutes = Math.floor(age / 60000);
                    lines.push(`  Age: ${ageMinutes} minutes`);
                }
            }
        } else {
            lines.push("Project Cache: Disabled");
        }

        lines.push("");
        lines.push("Cache Location: VS Code Workspace Storage");

        vscode.window.showInformationMessage(lines.join("\n"), { modal: true });
    }
}
