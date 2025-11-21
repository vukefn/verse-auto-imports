import * as vscode from "vscode";
import { ImportPathConverter } from "../handlers/importPathConverter";
import { log } from "../utils/logging";

export class ImportCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    private importPathConverter: ImportPathConverter;
    private hoverState = new Map<string, { lineNumber: number; timeout: NodeJS.Timeout | null }>();
    private isHoveringImport = new Map<string, boolean>();
    private refreshTimeout: NodeJS.Timeout | null = null;

    constructor(private outputChannel: vscode.OutputChannel) {
        this.importPathConverter = new ImportPathConverter(outputChannel);

        // Watch for configuration changes
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("verseAutoImports.pathConversion.enableCodeLens")) {
                this._onDidChangeCodeLenses.fire();
            }
        });

        // Watch for document changes to refresh CodeLens immediately
        vscode.workspace.onDidChangeTextDocument((e) => {
            // Only refresh for Verse files that are currently showing CodeLens
            if (e.document.languageId === "verse" && this.isHoveringImport.get(e.document.uri.toString())) {
                // Clear any pending refresh
                if (this.refreshTimeout) {
                    clearTimeout(this.refreshTimeout);
                    this.refreshTimeout = null;
                }

                // Refresh immediately for better responsiveness
                this._onDidChangeCodeLenses.fire();

                // Schedule another refresh shortly after to catch any delayed updates
                this.refreshTimeout = setTimeout(() => {
                    this._onDidChangeCodeLenses.fire();
                    this.refreshTimeout = null;
                }, 100);
            }
        });
    }

    /**
     * Sets the hover state for a document
     */
    setHoverState(documentUri: string, hovering: boolean, lineNumber?: number): void {
        const currentState = this.hoverState.get(documentUri);

        if (hovering && lineNumber !== undefined) {
            // Clear existing timeout if any
            if (currentState?.timeout) {
                clearTimeout(currentState.timeout);
            }

            this.hoverState.set(documentUri, {
                lineNumber,
                timeout: null,
            });
            this.isHoveringImport.set(documentUri, true);
            this._onDidChangeCodeLenses.fire();
        } else if (!hovering) {
            // Set timeout to hide CodeLens after 2 seconds
            if (currentState?.timeout) {
                clearTimeout(currentState.timeout);
            }

            const timeout = setTimeout(() => {
                this.isHoveringImport.set(documentUri, false);
                this.hoverState.delete(documentUri);
                this._onDidChangeCodeLenses.fire();
            }, 2000);

            if (currentState) {
                this.hoverState.set(documentUri, {
                    ...currentState,
                    timeout,
                });
            }
        }
    }

    /**
     * Keeps the hover state active (used during conversions)
     */
    keepHoverStateActive(documentUri: string): void {
        const currentState = this.hoverState.get(documentUri);

        // Clear any pending timeout
        if (currentState?.timeout) {
            clearTimeout(currentState.timeout);
        }

        // Keep the hover state active
        this.isHoveringImport.set(documentUri, true);

        // Fire immediately for responsive updates
        this._onDidChangeCodeLenses.fire();

        // Schedule additional refreshes to ensure UI updates
        setTimeout(() => this._onDidChangeCodeLenses.fire(), 50);
        setTimeout(() => this._onDidChangeCodeLenses.fire(), 150);
    }

    async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];

        // Check if CodeLens is enabled in configuration
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const showCodeLens = config.get<boolean>("pathConversion.enableCodeLens", true);

        if (!showCodeLens) {
            return codeLenses;
        }

        // Check if we should show CodeLens based on hover state
        const documentUri = document.uri.toString();
        const isHovering = this.isHoveringImport.get(documentUri);

        // Only show CodeLens if hovering over imports
        if (!isHovering) {
            return codeLenses;
        }

        const text = document.getText();
        const lines = text.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Check if this is an import line
            if (trimmedLine.startsWith("using")) {
                const range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length));

                // Check if it's a full path import that can be converted to relative
                if (this.importPathConverter.isFullPathImport(trimmedLine)) {
                    // Only show relative conversion for non-built-in modules
                    if (!this.importPathConverter.isBuiltinModule(trimmedLine)) {
                        const moduleName = this.importPathConverter.extractModuleName(trimmedLine);

                        if (moduleName) {
                            // Create CodeLens for converting to relative path
                            const convertToRelativeLens = new vscode.CodeLens(range, {
                                title: `$(arrow-left)  Use relative path`,
                                tooltip: `Use relative path for '${moduleName}'`,
                                command: "verseAutoImports.convertToRelativePath",
                                arguments: [document, trimmedLine, i],
                            });
                            codeLenses.push(convertToRelativeLens);

                            // Check if there are multiple full path imports (non-builtin) in the file
                            const hasMultipleFullPathImports =
                                lines.filter((l) => {
                                    const trimmed = l.trim();
                                    return trimmed.startsWith("using") && this.importPathConverter.isFullPathImport(trimmed) && !this.importPathConverter.isBuiltinModule(trimmed);
                                }).length > 1;

                            // Add "Use relative paths for all" option if there are multiple full path imports
                            if (hasMultipleFullPathImports) {
                                const convertAllRelativeLens = new vscode.CodeLens(range, {
                                    title: `$(arrow-circle-left)  Use relative paths for all`,
                                    tooltip: "Use relative paths for all imports in this file",
                                    command: "verseAutoImports.convertAllToRelativePath",
                                    arguments: [document],
                                });
                                codeLenses.push(convertAllRelativeLens);
                            }
                        }
                    }
                } else {
                    // It's a relative import - show option to convert to absolute path
                    const moduleName = this.importPathConverter.extractModuleName(trimmedLine);

                    if (moduleName) {
                        // Create CodeLens for converting to absolute path
                        const convertSingleLens = new vscode.CodeLens(range, {
                            title: `$(arrow-right)  Use absolute path`,
                            tooltip: `Use absolute path for '${moduleName}'`,
                            command: "verseAutoImports.convertToFullPath",
                            arguments: [document, trimmedLine, i],
                        });
                        codeLenses.push(convertSingleLens);

                        // Check if there are multiple relative imports in the file
                        const hasMultipleRelativeImports = lines.filter((l) => l.trim().startsWith("using") && !this.importPathConverter.isFullPathImport(l.trim())).length > 1;

                        // Add "Use absolute paths for all" option if there are multiple relative imports
                        if (hasMultipleRelativeImports) {
                            const convertAllLens = new vscode.CodeLens(range, {
                                title: `$(arrow-circle-right)  Use absolute paths for all`,
                                tooltip: "Use absolute paths for all imports in this file",
                                command: "verseAutoImports.convertAllToFullPath",
                                arguments: [document],
                            });
                            codeLenses.push(convertAllLens);
                        }
                    }
                }
            }
        }

        log(this.outputChannel, `Provided ${codeLenses.length} CodeLens items for ${document.fileName}`);
        return codeLenses;
    }

    resolveCodeLens(codeLens: vscode.CodeLens, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens> {
        // We already set the command in provideCodeLenses, so just return the same CodeLens
        return codeLens;
    }

    /**
     * Refresh CodeLens display
     */
    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    /**
     * Force immediate refresh after conversion (called after document edit)
     */
    forceRefreshAfterConversion(documentUri: string): void {
        // Ensure hover state remains active
        this.isHoveringImport.set(documentUri, true);

        // Multiple rapid refreshes to ensure UI catches the change
        this._onDidChangeCodeLenses.fire();

        // Use requestAnimationFrame equivalent timing for browser-like immediate update
        setImmediate(() => this._onDidChangeCodeLenses.fire());
        setTimeout(() => this._onDidChangeCodeLenses.fire(), 0);
        setTimeout(() => this._onDidChangeCodeLenses.fire(), 50);
        setTimeout(() => this._onDidChangeCodeLenses.fire(), 100);
    }
}
