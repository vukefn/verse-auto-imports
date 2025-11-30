import * as vscode from "vscode";
import { logger } from "./utils";
import { DiagnosticsHandler } from "./diagnostics";
import { ImportHandler, ImportPathConverter, ImportCodeActionProvider, ImportCodeLensProvider } from "./imports";
import { CommandsHandler } from "./commands";
import { StatusBarHandler } from "./ui";
import { ProjectPathHandler } from "./project";

export function activate(context: vscode.ExtensionContext) {
    // Initialize the logger
    logger.initialize(context);
    logger.info("Extension", "Verse Auto Imports is now active");

    // Get output channel for backward compatibility with handlers
    const outputChannel = logger.getUserChannel();

    const config = vscode.workspace.getConfiguration("verseAutoImports");
    const existingMappings = config.get<Record<string, string>>("ambiguousImports", {});

    if (Object.keys(existingMappings).length === 0) {
        logger.info("Extension", "Setting default ambiguous import mappings");
        config.update(
            "ambiguousImports",
            {
                vector3: "/UnrealEngine.com/Temporary/SpatialMath",
                vector2: "/UnrealEngine.com/Temporary/SpatialMath",
                rotation: "/UnrealEngine.com/Temporary/SpatialMath",
            },
            vscode.ConfigurationTarget.Global
        );
    }

    logger.debug("Extension", "Creating handlers");
    const importHandler = new ImportHandler(outputChannel);
    const diagnosticsHandler = new DiagnosticsHandler(outputChannel);
    const commandsHandler = new CommandsHandler(outputChannel, importHandler);
    const statusBarHandler = new StatusBarHandler(outputChannel, importHandler);
    const projectPathHandler = new ProjectPathHandler(outputChannel);
    const importPathConverter = new ImportPathConverter(outputChannel);
    const importCodeLensProvider = new ImportCodeLensProvider(outputChannel);

    // Handle backward compatibility: use legacy setting if configured, otherwise use new setting
    const legacyDelay = config.get<number | undefined>("general.diagnosticDelay", undefined);
    const newDelay = config.get<number>("general.autoImportDebounceDelay", 3000);
    const delayMs = legacyDelay !== undefined ? legacyDelay : newDelay;

    diagnosticsHandler.setDelay(delayMs);
    logger.info("Extension", `Initial debounce delay set to ${delayMs}ms`);

    context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ language: "verse" }, new ImportCodeActionProvider(outputChannel, importHandler)));

    // Register CodeLens provider for full path conversion
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: "verse" }, importCodeLensProvider));

    // Set up file watcher for project file changes
    context.subscriptions.push(projectPathHandler.setupFileWatcher());

    context.subscriptions.push(
        vscode.commands.registerCommand("verseAutoImports.addSingleImport", async (document: vscode.TextDocument, importStatement: string) => {
            await importHandler.addImportsToDocument(document, [importStatement]);
            vscode.window.setStatusBarMessage(`Added import: ${importStatement}`, 3000);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("verseAutoImports.general.diagnosticDelay") || event.affectsConfiguration("verseAutoImports.general.autoImportDebounceDelay")) {
                const newConfig = vscode.workspace.getConfiguration("verseAutoImports");
                // Handle backward compatibility
                const legacyDelay = newConfig.get<number | undefined>("general.diagnosticDelay", undefined);
                const autoImportDebounceDelay = newConfig.get<number>("general.autoImportDebounceDelay", 3000);
                const finalDelay = legacyDelay !== undefined ? legacyDelay : autoImportDebounceDelay;

                diagnosticsHandler.setDelay(finalDelay);
                logger.info("Extension", `Debounce delay updated to ${finalDelay}ms`);
            }
        })
    );

    context.subscriptions.push(
        statusBarHandler.getStatusBarItem(),
        vscode.commands.registerCommand("verseAutoImports.showStatusMenu", () => {
            statusBarHandler.showMenu();
        }),
        vscode.commands.registerCommand("verseAutoImports.optimizeImports", () => {
            commandsHandler.optimizeImports();
        }),
        vscode.commands.registerCommand("verseAutoImports.toggleAutoImport", async () => {
            const config = vscode.workspace.getConfiguration("verseAutoImports");
            const current = config.get<boolean>("general.autoImport", true);
            await config.update("general.autoImport", !current, vscode.ConfigurationTarget.Global);
            statusBarHandler.updateDisplay();
        }),
        vscode.commands.registerCommand("verseAutoImports.togglePreserveLocations", async () => {
            const config = vscode.workspace.getConfiguration("verseAutoImports");
            const current = config.get<boolean>("behavior.preserveImportLocations", false);
            await config.update("behavior.preserveImportLocations", !current, vscode.ConfigurationTarget.Global);
            statusBarHandler.updateDisplay();
        }),
        vscode.commands.registerCommand("verseAutoImports.toggleImportSyntax", async () => {
            const config = vscode.workspace.getConfiguration("verseAutoImports");
            const current = config.get<string>("behavior.importSyntax", "curly");
            const newSyntax = current === "curly" ? "dot" : "curly";
            await config.update("behavior.importSyntax", newSyntax, vscode.ConfigurationTarget.Global);
            statusBarHandler.updateDisplay();
        }),
        vscode.commands.registerCommand("verseAutoImports.toggleDigestFiles", async () => {
            const config = vscode.workspace.getConfiguration("verseAutoImports");
            const current = config.get<boolean>("experimental.useDigestFiles", false);
            await config.update("experimental.useDigestFiles", !current, vscode.ConfigurationTarget.Global);
            statusBarHandler.updateDisplay();
        }),
        vscode.commands.registerCommand("verseAutoImports.toggleFullPathCodeLens", async () => {
            const config = vscode.workspace.getConfiguration("verseAutoImports");
            const current = config.get<boolean>("pathConversion.enableCodeLens", true);
            await config.update("pathConversion.enableCodeLens", !current, vscode.ConfigurationTarget.Global);
            statusBarHandler.updateDisplay();
        }),
        vscode.commands.registerCommand("verseAutoImports.snoozeAutoImport", () => {
            statusBarHandler.startSnooze(5);
        }),
        vscode.commands.registerCommand("verseAutoImports.cancelSnooze", () => {
            statusBarHandler.cancelSnooze();
        }),
        vscode.commands.registerCommand("verseAutoImports.exportDebugLogs", async () => {
            try {
                const uri = await logger.exportDebugLogs();
                if (uri) {
                    const action = await vscode.window.showInformationMessage(`Debug logs exported to ${uri.fsPath}`, "Open File", "Open Folder");
                    if (action === "Open File") {
                        await vscode.commands.executeCommand("vscode.open", uri);
                    } else if (action === "Open Folder") {
                        await vscode.commands.executeCommand("revealFileInOS", uri);
                    }
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to export debug logs: ${error instanceof Error ? error.message : String(error)}`);
            }
        }),
        // Command to convert a single import to absolute path
        vscode.commands.registerCommand("verseAutoImports.convertToFullPath", async (document: vscode.TextDocument, importStatement: string, lineNumber: number) => {
            // Keep hover state active and refresh immediately for responsiveness
            const documentUri = document.uri.toString();
            importCodeLensProvider.keepHoverStateActive(documentUri);

            const result = await importPathConverter.convertToFullPath(importStatement, document.uri);

            if (!result) {
                vscode.window.showInformationMessage("Import is already in absolute path format or could not be converted.");
                return;
            }

            if (result.isAmbiguous && result.possiblePaths) {
                // Show quick pick for ambiguous imports
                const items = result.possiblePaths.map((path) => ({
                    label: path,
                    description: `Absolute path for ${result.moduleName}`,
                    path: path,
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `Select the absolute path for '${result.moduleName}'`,
                    title: "Multiple locations found",
                });

                if (selected) {
                    await importPathConverter.applyConversion(document, result, selected.path);
                    vscode.window.setStatusBarMessage(`Using absolute path: ${selected.path}`, 3000);
                    // Force immediate refresh after conversion
                    importCodeLensProvider.forceRefreshAfterConversion(documentUri);
                }
            } else {
                // Apply conversion directly for non-ambiguous imports
                await importPathConverter.applyConversion(document, result);
                vscode.window.setStatusBarMessage(`Using absolute path: ${result.fullPathImport}`, 3000);
                // Force immediate refresh after conversion
                importCodeLensProvider.forceRefreshAfterConversion(documentUri);
            }
        }),
        // Command to convert all imports to absolute paths
        vscode.commands.registerCommand("verseAutoImports.convertAllToFullPath", async (document: vscode.TextDocument) => {
            // Keep hover state active and refresh immediately for responsiveness
            const documentUri = document.uri.toString();
            importCodeLensProvider.keepHoverStateActive(documentUri);

            const results = await importPathConverter.convertAllImportsInDocument(document);

            if (results.length === 0) {
                vscode.window.showInformationMessage("No relative imports found to convert.");
                return;
            }

            let convertedCount = 0;
            const ambiguousImports: typeof results = [];

            // First, handle non-ambiguous imports
            for (const result of results) {
                if (!result.isAmbiguous) {
                    const success = await importPathConverter.applyConversion(document, result);
                    if (success) {
                        convertedCount++;
                    }
                } else {
                    ambiguousImports.push(result);
                }
            }

            // Then handle ambiguous imports one by one
            for (const result of ambiguousImports) {
                if (result.possiblePaths) {
                    const items = result.possiblePaths.map((path) => ({
                        label: path,
                        description: `Absolute path for ${result.moduleName}`,
                        path: path,
                    }));

                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: `Select the absolute path for '${result.moduleName}'`,
                        title: `Multiple locations found for ${result.moduleName}`,
                    });

                    if (selected) {
                        const success = await importPathConverter.applyConversion(document, result, selected.path);
                        if (success) {
                            convertedCount++;
                        }
                    }
                }
            }

            vscode.window.showInformationMessage(`Using absolute paths for ${convertedCount} import${convertedCount !== 1 ? "s" : ""}.`);

            // Force immediate refresh after all conversions
            importCodeLensProvider.forceRefreshAfterConversion(documentUri);
        }),
        // Command to convert a single import to relative path
        vscode.commands.registerCommand("verseAutoImports.convertToRelativePath", async (document: vscode.TextDocument, importStatement: string, lineNumber: number) => {
            // Keep hover state active and refresh immediately for responsiveness
            const documentUri = document.uri.toString();
            importCodeLensProvider.keepHoverStateActive(documentUri);

            const result = await importPathConverter.convertFromFullPath(importStatement);

            if (!result) {
                vscode.window.showInformationMessage("Import cannot be converted to relative path.");
                return;
            }

            // Apply conversion directly
            await importPathConverter.applyConversion(document, result);
            vscode.window.setStatusBarMessage(`Using relative path: ${result.fullPathImport}`, 3000);

            // Force immediate refresh after conversion
            importCodeLensProvider.forceRefreshAfterConversion(documentUri);
        }),
        // Command to convert all imports to relative paths
        vscode.commands.registerCommand("verseAutoImports.convertAllToRelativePath", async (document: vscode.TextDocument) => {
            // Keep hover state active and refresh immediately for responsiveness
            const documentUri = document.uri.toString();
            importCodeLensProvider.keepHoverStateActive(documentUri);

            const results = await importPathConverter.convertAllImportsFromFullPath(document);

            if (results.length === 0) {
                vscode.window.showInformationMessage("No absolute path imports found to convert.");
                return;
            }

            let convertedCount = 0;

            // Convert all absolute path imports to relative
            for (const result of results) {
                const success = await importPathConverter.applyConversion(document, result);
                if (success) {
                    convertedCount++;
                }
            }

            vscode.window.showInformationMessage(`Using relative paths for ${convertedCount} import${convertedCount !== 1 ? "s" : ""}.`);

            // Force immediate refresh after all conversions
            importCodeLensProvider.forceRefreshAfterConversion(documentUri);
        }),
        // Register hover provider to track when hovering over imports
        vscode.languages.registerHoverProvider(
            { language: "verse" },
            {
                provideHover(document, position, token) {
                    // Check if CodeLens is enabled
                    const config = vscode.workspace.getConfiguration("verseAutoImports");
                    const showCodeLens = config.get<boolean>("pathConversion.enableCodeLens", true);

                    if (!showCodeLens) {
                        return null;
                    }

                    const line = document.lineAt(position.line);
                    const text = line.text.trim();

                    // Check if hovering over an import line
                    if (text.startsWith("using")) {
                        // Set hover state to show CodeLens
                        importCodeLensProvider.setHoverState(document.uri.toString(), true, position.line);

                        // Return null - we don't need to show hover content
                        return null;
                    } else {
                        // Not hovering over import - start timeout to hide CodeLens
                        importCodeLensProvider.setHoverState(document.uri.toString(), false);
                    }

                    return null;
                },
            }
        ),
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.languageId === "verse") {
                const config = vscode.workspace.getConfiguration("verseAutoImports");
                const emptyLinesAfterImports = config.get<number>("behavior.emptyLinesAfterImports", 1);

                // Only apply spacing if configured to have at least 0 lines (feature is enabled)
                if (emptyLinesAfterImports >= 0) {
                    await importHandler.ensureEmptyLinesAfterImports(document);
                }
            }
        }),
        vscode.languages.onDidChangeDiagnostics(async (e) => {
            for (const uri of e.uris) {
                const diagnostics = vscode.languages.getDiagnostics(uri);

                try {
                    const document = await vscode.workspace.openTextDocument(uri);

                    if (document.languageId === "verse") {
                        const config = vscode.workspace.getConfiguration("verseAutoImports");
                        const autoImportEnabled = config.get<boolean>("general.autoImport", true);

                        if (autoImportEnabled) {
                            await diagnosticsHandler.handle(document);
                        }
                    }
                } catch (error) {
                    logger.error("Extension", `Error opening document ${uri.toString()}`, error);
                }
            }
        })
    );

    logger.info("Extension", "Verse Auto Imports extension activated successfully");
}

export function deactivate() {
    logger.info("Extension", "Verse Auto Imports extension deactivated");
}
