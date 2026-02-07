import * as vscode from "vscode";
import { logger } from "../utils";
import { ImportHandler, ImportPathConverter, ImportCodeLensProvider } from "../imports";
import { StatusBarHandler } from "../ui";
import { ProjectPathCache } from "../services";

/**
 * Dependencies required by CommandsHandler.
 */
export interface CommandsDependencies {
    importHandler: ImportHandler;
    statusBarHandler: StatusBarHandler;
    importPathConverter: ImportPathConverter;
    importCodeLensProvider: ImportCodeLensProvider;
    projectPathCache?: ProjectPathCache;
}

/**
 * Result from path conversion operations.
 * Matches the shape returned by ImportPathConverter.
 */
interface PathConversionResult {
    originalImport: string;
    fullPathImport: string;
    moduleName: string;
    isAmbiguous: boolean;
    possiblePaths?: string[];
}

/**
 * Centralized handler for all extension commands.
 * Consolidates command logic that was previously scattered across extension.ts.
 */
export class CommandsHandler {
    // Named constants for timing delays
    private static readonly STATUS_MESSAGE_DURATION_MS = 3000;
    private static readonly SNOOZE_DURATION_MINUTES = 5;
    private static readonly DIAGNOSTICS_REFRESH_DELAY_MS = 200;
    private static readonly AUTO_IMPORT_WAIT_DELAY_MS = 500;

    constructor(private readonly deps: CommandsDependencies) {}

    //==========================================================================
    // Public Registration
    //==========================================================================

    /**
     * Registers all extension commands with VS Code.
     */
    registerAll(context: vscode.ExtensionContext): void {
        const commands: Array<[string, (...args: any[]) => any]> = [
            // Import operations
            ["verseAutoImports.addSingleImport", this.addSingleImport.bind(this)],
            ["verseAutoImports.optimizeImports", this.optimizeImports.bind(this)],

            // UI/Menu
            ["verseAutoImports.showStatusMenu", this.showStatusMenu.bind(this)],

            // Toggle commands
            ["verseAutoImports.toggleAutoImport", this.toggleAutoImport.bind(this)],
            ["verseAutoImports.togglePreserveLocations", this.togglePreserveLocations.bind(this)],
            ["verseAutoImports.toggleImportSyntax", this.toggleImportSyntax.bind(this)],
            ["verseAutoImports.toggleDigestFiles", this.toggleDigestFiles.bind(this)],
            ["verseAutoImports.toggleFullPathCodeLens", this.toggleFullPathCodeLens.bind(this)],

            // Snooze
            ["verseAutoImports.snoozeAutoImport", this.snoozeAutoImport.bind(this)],
            ["verseAutoImports.cancelSnooze", this.cancelSnooze.bind(this)],

            // Debug/Logs
            ["verseAutoImports.exportDebugLogs", this.exportDebugLogs.bind(this)],

            // Cache
            ["verseAutoImports.rebuildPathCache", this.rebuildPathCache.bind(this)],
            ["verseAutoImports.showCacheStatus", this.showCacheStatus.bind(this)],

            // Path conversion
            ["verseAutoImports.convertToFullPath", this.convertToFullPath.bind(this)],
            ["verseAutoImports.convertAllToFullPath", this.convertAllToFullPath.bind(this)],
            ["verseAutoImports.convertToRelativePath", this.convertToRelativePath.bind(this)],
            ["verseAutoImports.convertAllToRelativePath", this.convertAllToRelativePath.bind(this)],
        ];

        for (const [commandId, handler] of commands) {
            context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
        }
    }

    //==========================================================================
    // Import Operations
    //==========================================================================

    /**
     * Adds a single import statement to a document.
     */
    async addSingleImport(document: vscode.TextDocument, importStatement: string): Promise<void> {
        await this.deps.importHandler.addImportsToDocument(document, [importStatement]);
        vscode.window.setStatusBarMessage(
            `Added import: ${importStatement}`,
            CommandsHandler.STATUS_MESSAGE_DURATION_MS
        );
    }

    /**
     * Optimizes imports in the active document by removing, re-adding, and organizing them.
     */
    async optimizeImports(): Promise<void> {
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
            await this.deps.importHandler.removeAllImports(document);

            // Step 2: Save the document to trigger diagnostics refresh
            logger.debug("CommandsHandler", "Step 2: Saving document to trigger diagnostics");
            await document.save();

            // Step 3: Wait for diagnostics to update
            logger.debug("CommandsHandler", "Step 3: Waiting for diagnostics to update");
            await this.delay(CommandsHandler.DIAGNOSTICS_REFRESH_DELAY_MS);

            // Step 4: Get diagnostics for the document
            const diagnostics = vscode.languages.getDiagnostics(document.uri);
            logger.debug("CommandsHandler", `Found ${diagnostics.length} diagnostics`);

            if (autoImportEnabled) {
                // Step 5a: Auto-import is ON - wait for it to handle missing imports
                logger.debug("CommandsHandler", "Step 5a: Auto-import is enabled, waiting for automatic imports");
                await this.delay(CommandsHandler.AUTO_IMPORT_WAIT_DELAY_MS);
            } else {
                // Step 5b: Auto-import is OFF - manually add missing imports
                logger.debug("CommandsHandler", "Step 5b: Auto-import is disabled, manually processing diagnostics");

                const missingImportPaths = this.deps.importHandler.extractImportsFromDiagnostics(diagnostics);

                if (missingImportPaths.length > 0) {
                    logger.debug("CommandsHandler", `Found ${missingImportPaths.length} missing imports to add`);

                    const importStatements = missingImportPaths.map((path) => {
                        const statement = preferDotSyntax ? `using. ${path}` : `using { ${path} }`;
                        logger.trace("CommandsHandler", `Formatting import: ${statement}`);
                        return statement;
                    });

                    await this.deps.importHandler.addImportsToDocument(document, importStatements);
                }
            }

            // Step 6: Convert scattered imports to preferred syntax (common to both paths)
            logger.debug("CommandsHandler", "Step 6: Converting scattered imports to preferred syntax");
            await this.deps.importHandler.convertScatteredImportsToPreferredSyntax(document);

            // Step 7: Ensure proper spacing after imports (common to both paths)
            logger.debug("CommandsHandler", "Step 7: Ensuring proper spacing after imports");
            await this.deps.importHandler.ensureEmptyLinesAfterImports(document);

            // Save the document again to ensure all changes are persisted
            await document.save();

            logger.info("CommandsHandler", "Successfully optimized imports");
            vscode.window.showInformationMessage("Imports optimized successfully");
        } catch (error) {
            logger.error("CommandsHandler", "Error optimizing imports", error);
            vscode.window.showErrorMessage(`Failed to optimize imports: ${error}`);
        }
    }

    //==========================================================================
    // UI Commands
    //==========================================================================

    /**
     * Shows the status bar menu.
     */
    async showStatusMenu(): Promise<void> {
        await this.deps.statusBarHandler.showMenu();
    }

    //==========================================================================
    // Toggle Commands
    //==========================================================================

    /**
     * Generic helper for toggling configuration values.
     */
    private async toggleConfig<T>(configKey: string, toggleFn?: (current: T) => T): Promise<void> {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const current = config.get<T>(configKey);
        const newValue = toggleFn ? toggleFn(current as T) : !current;
        await config.update(configKey, newValue, vscode.ConfigurationTarget.Global);
        this.deps.statusBarHandler.updateDisplay();
    }

    async toggleAutoImport(): Promise<void> {
        await this.toggleConfig<boolean>("general.autoImport");
    }

    async togglePreserveLocations(): Promise<void> {
        await this.toggleConfig<boolean>("behavior.preserveImportLocations");
    }

    async toggleImportSyntax(): Promise<void> {
        await this.toggleConfig<string>("behavior.importSyntax", (current) => (current === "curly" ? "dot" : "curly"));
    }

    async toggleDigestFiles(): Promise<void> {
        await this.toggleConfig<boolean>("experimental.useDigestFiles");
    }

    async toggleFullPathCodeLens(): Promise<void> {
        await this.toggleConfig<boolean>("pathConversion.enableCodeLens");
    }

    //==========================================================================
    // Snooze Commands
    //==========================================================================

    async snoozeAutoImport(): Promise<void> {
        this.deps.statusBarHandler.startSnooze(CommandsHandler.SNOOZE_DURATION_MINUTES);
    }

    async cancelSnooze(): Promise<void> {
        this.deps.statusBarHandler.cancelSnooze();
    }

    //==========================================================================
    // Debug/Logs
    //==========================================================================

    /**
     * Exports debug logs to a file.
     */
    async exportDebugLogs(): Promise<void> {
        try {
            const uri = await logger.exportDebugLogs();
            if (uri) {
                const action = await vscode.window.showInformationMessage(
                    `Debug logs exported to ${uri.fsPath}`,
                    "Open File",
                    "Open Folder"
                );
                if (action === "Open File") {
                    await vscode.commands.executeCommand("vscode.open", uri);
                } else if (action === "Open Folder") {
                    await vscode.commands.executeCommand("revealFileInOS", uri);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to export debug logs: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    //==========================================================================
    // Cache Commands
    //==========================================================================

    /**
     * Rebuilds the project path cache.
     */
    async rebuildPathCache(): Promise<void> {
        if (!this.deps.projectPathCache) {
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
                await this.deps.projectPathCache!.rebuildCache();
            }
        );

        const stats = this.deps.projectPathCache.getStats();
        vscode.window.showInformationMessage(`Project path cache rebuilt: ${stats.identifiers} identifiers from ${stats.files} files`);
    }

    /**
     * Shows the current cache status.
     */
    async showCacheStatus(): Promise<void> {
        try {
            const cacheStats = this.deps.projectPathCache?.getStats();

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
        } catch (error) {
            logger.error("CommandsHandler", "Error showing cache status", error);
            vscode.window.showErrorMessage(`Failed to show cache status: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    //==========================================================================
    // Path Conversion Commands
    //==========================================================================

    /**
     * Prepares for a path conversion by keeping hover state active.
     */
    private prepareForConversion(documentUri: string): void {
        this.deps.importCodeLensProvider.keepHoverStateActive(documentUri);
    }

    /**
     * Finalizes a path conversion by forcing a CodeLens refresh.
     */
    private finalizeConversion(documentUri: string): void {
        this.deps.importCodeLensProvider.forceRefreshAfterConversion(documentUri);
    }

    /**
     * Shows a quick pick for selecting an ambiguous path.
     */
    private async selectAmbiguousPath(result: PathConversionResult): Promise<string | undefined> {
        if (!result.possiblePaths) return undefined;

        const items = result.possiblePaths.map((path) => ({
            label: path,
            description: `Absolute path for ${result.moduleName}`,
            path,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Select the absolute path for '${result.moduleName}'`,
            title: "Multiple locations found",
        });

        return selected?.path;
    }

    /**
     * Converts a single import to absolute path format.
     */
    async convertToFullPath(document: vscode.TextDocument, importStatement: string, _lineNumber: number): Promise<void> {
        const documentUri = document.uri.toString();
        this.prepareForConversion(documentUri);

        const result = (await this.deps.importPathConverter.convertToFullPath(importStatement, document.uri)) as PathConversionResult | null;

        if (!result) {
            vscode.window.showInformationMessage("Import is already in absolute path format or could not be converted.");
            return;
        }

        if (result.isAmbiguous && result.possiblePaths) {
            const selectedPath = await this.selectAmbiguousPath(result);
            if (selectedPath) {
                await this.deps.importPathConverter.applyConversion(document, result, selectedPath);
                vscode.window.setStatusBarMessage(`Using absolute path: ${selectedPath}`, CommandsHandler.STATUS_MESSAGE_DURATION_MS);
                this.finalizeConversion(documentUri);
            }
        } else {
            await this.deps.importPathConverter.applyConversion(document, result);
            vscode.window.setStatusBarMessage(`Using absolute path: ${result.fullPathImport}`, CommandsHandler.STATUS_MESSAGE_DURATION_MS);
            this.finalizeConversion(documentUri);
        }
    }

    /**
     * Converts all imports in a document to absolute path format.
     */
    async convertAllToFullPath(document: vscode.TextDocument): Promise<void> {
        const documentUri = document.uri.toString();
        this.prepareForConversion(documentUri);

        const results = (await this.deps.importPathConverter.convertAllImportsInDocument(document)) as PathConversionResult[];

        if (results.length === 0) {
            vscode.window.showInformationMessage("No relative imports found to convert.");
            return;
        }

        let convertedCount = 0;
        const ambiguousImports: PathConversionResult[] = [];

        // First pass: handle non-ambiguous imports
        for (const result of results) {
            if (!result.isAmbiguous) {
                const success = await this.deps.importPathConverter.applyConversion(document, result);
                if (success) convertedCount++;
            } else {
                ambiguousImports.push(result);
            }
        }

        // Second pass: handle ambiguous imports interactively
        for (const result of ambiguousImports) {
            const selectedPath = await this.selectAmbiguousPath(result);
            if (selectedPath) {
                const success = await this.deps.importPathConverter.applyConversion(document, result, selectedPath);
                if (success) convertedCount++;
            }
        }

        vscode.window.showInformationMessage(`Using absolute paths for ${convertedCount} import${convertedCount !== 1 ? "s" : ""}.`);
        this.finalizeConversion(documentUri);
    }

    /**
     * Converts a single import to relative path format.
     */
    async convertToRelativePath(document: vscode.TextDocument, importStatement: string, _lineNumber: number): Promise<void> {
        const documentUri = document.uri.toString();
        this.prepareForConversion(documentUri);

        const result = (await this.deps.importPathConverter.convertFromFullPath(importStatement)) as PathConversionResult | null;

        if (!result) {
            vscode.window.showInformationMessage("Import cannot be converted to relative path.");
            return;
        }

        await this.deps.importPathConverter.applyConversion(document, result);
        vscode.window.setStatusBarMessage(`Using relative path: ${result.fullPathImport}`, CommandsHandler.STATUS_MESSAGE_DURATION_MS);
        this.finalizeConversion(documentUri);
    }

    /**
     * Converts all imports in a document to relative path format.
     */
    async convertAllToRelativePath(document: vscode.TextDocument): Promise<void> {
        const documentUri = document.uri.toString();
        this.prepareForConversion(documentUri);

        const results = (await this.deps.importPathConverter.convertAllImportsFromFullPath(document)) as PathConversionResult[];

        if (results.length === 0) {
            vscode.window.showInformationMessage("No absolute path imports found to convert.");
            return;
        }

        let convertedCount = 0;
        for (const result of results) {
            const success = await this.deps.importPathConverter.applyConversion(document, result);
            if (success) convertedCount++;
        }

        vscode.window.showInformationMessage(`Using relative paths for ${convertedCount} import${convertedCount !== 1 ? "s" : ""}.`);
        this.finalizeConversion(documentUri);
    }

    //==========================================================================
    // Private Utilities
    //==========================================================================

    /**
     * Promise-based delay helper.
     */
    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
