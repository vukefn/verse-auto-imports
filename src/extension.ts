import * as vscode from "vscode";
import { logger } from "./utils";
import { DiagnosticsHandler } from "./diagnostics";
import { ImportHandler, ImportPathConverter, ImportCodeActionProvider, ImportCodeLensProvider } from "./imports";
import { CommandsHandler, CommandsDependencies } from "./commands";
import { StatusBarHandler } from "./ui";
import { ProjectPathHandler } from "./project";
import { AssetsDigestParser, ProjectPathCache } from "./services";

/**
 * Gets the configured debounce delay, handling backward compatibility
 * with the deprecated diagnosticDelay setting.
 */
function getConfiguredDebounceDelay(config: vscode.WorkspaceConfiguration): number {
    const legacyDelay = config.get<number | undefined>("general.diagnosticDelay", undefined);
    const newDelay = config.get<number>("general.autoImportDebounceDelay", 3000);
    return legacyDelay !== undefined ? legacyDelay : newDelay;
}

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

    // Create core services
    logger.debug("Extension", "Creating handlers");
    const projectPathHandler = new ProjectPathHandler(outputChannel);
    const assetsDigestParser = new AssetsDigestParser(outputChannel, projectPathHandler);
    const projectPathCache = new ProjectPathCache(context, outputChannel, projectPathHandler);

    // Create handlers and providers
    const importHandler = new ImportHandler(outputChannel, assetsDigestParser, context);
    const diagnosticsHandler = new DiagnosticsHandler(outputChannel);
    const statusBarHandler = new StatusBarHandler(outputChannel);
    const importPathConverter = new ImportPathConverter(outputChannel, projectPathCache);
    const importCodeLensProvider = new ImportCodeLensProvider(outputChannel);

    // Create CommandsHandler with all dependencies
    const commandsDeps: CommandsDependencies = {
        importHandler,
        statusBarHandler,
        importPathConverter,
        importCodeLensProvider,
        projectPathCache,
    };
    const commandsHandler = new CommandsHandler(commandsDeps);

    // Initialize assets digest cache asynchronously
    assetsDigestParser.ensureCachePopulated().catch((err) => {
        logger.warn("Extension", `Failed to initialize assets digest cache: ${err}`);
    });

    // Initialize project path cache asynchronously (if enabled)
    const cacheEnabled = config.get<boolean>("cache.enableProjectCache", true);
    if (cacheEnabled) {
        projectPathCache.initialize().catch((err) => {
            logger.warn("Extension", `Failed to initialize project path cache: ${err}`);
        });
    }

    // Set initial debounce delay (handles backward compat with deprecated setting)
    const delayMs = getConfiguredDebounceDelay(config);
    diagnosticsHandler.setDelay(delayMs);
    logger.info("Extension", `Initial debounce delay set to ${delayMs}ms`);

    // Register providers
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider({ language: "verse" }, new ImportCodeActionProvider(outputChannel, importHandler)),
        vscode.languages.registerCodeLensProvider({ language: "verse" }, importCodeLensProvider)
    );

    // Set up file watchers
    context.subscriptions.push(projectPathHandler.setupFileWatcher());
    context.subscriptions.push(assetsDigestParser.setupFileWatcher());
    if (cacheEnabled) {
        context.subscriptions.push(projectPathCache.setupFileWatchers());
    }

    // Register all commands via CommandsHandler
    commandsHandler.registerAll(context);

    // Register hover provider for CodeLens visibility
    context.subscriptions.push(
        vscode.languages.registerHoverProvider({ language: "verse" }, {
            provideHover(document, position) {
                const config = vscode.workspace.getConfiguration("verseAutoImports");
                if (!config.get<boolean>("pathConversion.enableCodeLens", true)) {
                    return null;
                }

                const line = document.lineAt(position.line);
                if (line.text.trim().startsWith("using")) {
                    importCodeLensProvider.setHoverState(document.uri.toString(), true, position.line);
                } else {
                    importCodeLensProvider.setHoverState(document.uri.toString(), false);
                }
                return null;
            },
        })
    );

    // Register status bar item
    context.subscriptions.push(statusBarHandler.getStatusBarItem());

    // Configuration change listener for debounce delay
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration("verseAutoImports.general.diagnosticDelay") ||
                event.affectsConfiguration("verseAutoImports.general.autoImportDebounceDelay")
            ) {
                const newConfig = vscode.workspace.getConfiguration("verseAutoImports");
                const finalDelay = getConfiguredDebounceDelay(newConfig);
                diagnosticsHandler.setDelay(finalDelay);
                logger.info("Extension", `Debounce delay updated to ${finalDelay}ms`);
            }
        })
    );

    // Document save listener for import spacing
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.languageId === "verse") {
                const config = vscode.workspace.getConfiguration("verseAutoImports");
                const emptyLinesAfterImports = config.get<number>("behavior.emptyLinesAfterImports", 1);
                if (emptyLinesAfterImports >= 0) {
                    await importHandler.ensureEmptyLinesAfterImports(document);
                }
            }
        })
    );

    // Diagnostics change listener for auto-import
    context.subscriptions.push(
        vscode.languages.onDidChangeDiagnostics(async (e) => {
            for (const uri of e.uris) {
                try {
                    const document = await vscode.workspace.openTextDocument(uri);
                    if (document.languageId === "verse") {
                        const config = vscode.workspace.getConfiguration("verseAutoImports");
                        if (config.get<boolean>("general.autoImport", true)) {
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
