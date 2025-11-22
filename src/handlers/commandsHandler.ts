import * as vscode from "vscode";
import { log } from "../utils/logging";
import { ImportHandler } from "./importHandler";

export class CommandsHandler {
    constructor(private outputChannel: vscode.OutputChannel, private importHandler: ImportHandler) {}

    async optimizeImports() {
        log(this.outputChannel, "Optimizing imports command triggered");

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            log(this.outputChannel, "No active editor found");
            vscode.window.showWarningMessage("Please open a file to optimize imports");
            return;
        }

        if (editor.document.languageId !== "verse") {
            log(this.outputChannel, "Active file is not a Verse file");
            vscode.window.showWarningMessage("Optimize imports only works with Verse files");
            return;
        }

        try {
            const document = editor.document;
            const config = vscode.workspace.getConfiguration("verseAutoImports");
            const autoImportEnabled = config.get<boolean>("general.autoImport", true);
            const preferDotSyntax = config.get<string>("behavior.importSyntax", "curly") === "dot";

            log(this.outputChannel, `Auto-import: ${autoImportEnabled}, Preferred syntax: ${preferDotSyntax ? "dot" : "curly"}`);

            // Step 1: Remove all imports from the document
            log(this.outputChannel, "Step 1: Removing all imports");
            await this.importHandler.removeAllImports(document);

            // Step 2: Save the document to trigger diagnostics refresh
            log(this.outputChannel, "Step 2: Saving document to trigger diagnostics");
            await document.save();

            // Step 3: Wait a moment for diagnostics to update
            log(this.outputChannel, "Step 3: Waiting for diagnostics to update");
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Step 4: Get diagnostics for the document
            const diagnostics = vscode.languages.getDiagnostics(document.uri);
            log(this.outputChannel, `Found ${diagnostics.length} diagnostics`);

            if (autoImportEnabled) {
                // Step 5a: Auto-import is ON - wait for it to handle missing imports
                log(this.outputChannel, "Step 5a: Auto-import is enabled, waiting for automatic imports");

                // Give auto-import time to work
                await new Promise((resolve) => setTimeout(resolve, 500));

                // Convert any scattered imports to preferred syntax
                log(this.outputChannel, "Step 6: Converting scattered imports to preferred syntax");
                await this.importHandler.convertScatteredImportsToPreferredSyntax(document);

                // Step 7: Ensure proper spacing after imports
                log(this.outputChannel, "Step 7: Ensuring proper spacing after imports");
                await this.importHandler.ensureEmptyLinesAfterImports(document);
            } else {
                // Step 5b: Auto-import is OFF - manually add missing imports
                log(this.outputChannel, "Step 5b: Auto-import is disabled, manually processing diagnostics");

                // Extract import paths from diagnostics
                const missingImportPaths = this.importHandler.extractImportsFromDiagnostics(diagnostics);

                if (missingImportPaths.length > 0) {
                    log(this.outputChannel, `Found ${missingImportPaths.length} missing imports to add`);

                    // Format import statements with preferred syntax
                    const importStatements = missingImportPaths.map((path) => {
                        const statement = preferDotSyntax ? `using. ${path}` : `using { ${path} }`;
                        log(this.outputChannel, `Formatting import: ${statement}`);
                        return statement;
                    });

                    // Add imports to document
                    await this.importHandler.addImportsToDocument(document, importStatements);
                }

                // Convert any scattered imports to preferred syntax
                log(this.outputChannel, "Step 6: Converting scattered imports to preferred syntax");
                await this.importHandler.convertScatteredImportsToPreferredSyntax(document);

                // Step 7: Ensure proper spacing after imports
                log(this.outputChannel, "Step 7: Ensuring proper spacing after imports");
                await this.importHandler.ensureEmptyLinesAfterImports(document);
            }

            // Save the document again to ensure all changes are persisted
            await document.save();

            log(this.outputChannel, "Successfully optimized imports");
            vscode.window.showInformationMessage("Imports optimized successfully");
        } catch (error) {
            log(this.outputChannel, `Error optimizing imports: ${error}`);
            vscode.window.showErrorMessage(`Failed to optimize imports: ${error}`);
        }
    }
}
