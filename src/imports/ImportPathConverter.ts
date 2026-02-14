import * as vscode from "vscode";
import * as path from "path";
import { logger } from "../utils";
import { ProjectPathHandler } from "../project";
import { ProjectPathCache } from "../services";
import { ImportFormatter } from "./ImportFormatter";

interface ImportConversionResult {
    originalImport: string;
    fullPathImport: string;
    moduleName: string;
    isAmbiguous: boolean;
    possiblePaths?: string[];
}

export class ImportPathConverter {
    private projectPathHandler: ProjectPathHandler;
    private projectPathCache: ProjectPathCache | null = null;

    constructor(
        private outputChannel: vscode.OutputChannel,
        projectPathCache?: ProjectPathCache
    ) {
        this.projectPathHandler = new ProjectPathHandler(outputChannel);
        this.projectPathCache = projectPathCache || null;
    }

    /**
     * Set the project path cache for faster lookups.
     */
    setProjectPathCache(cache: ProjectPathCache): void {
        this.projectPathCache = cache;
    }

    /**
     * Helper function to check if a folder exists in the workspace
     */
    private async folderExists(workspaceFolder: vscode.WorkspaceFolder, relativePath: string): Promise<boolean> {
        const folderUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
        try {
            const stat = await vscode.workspace.fs.stat(folderUri);
            const isDirectory = stat.type === vscode.FileType.Directory;
            logger.debug("ImportPathConverter", `Checking folder: ${folderUri.fsPath} - Exists: ${isDirectory}, Type: ${stat.type}`);
            return isDirectory;
        } catch (error) {
            logger.debug("ImportPathConverter", `Folder check failed for: ${folderUri.fsPath} - Error: ${error}`);
            return false;
        }
    }

    /** Extracts the path string from an import statement */
    private extractPathFromImport(importStatement: string): string {
        const curlyMatch = importStatement.match(/using\s*\{\s*([^}]+)\s*\}/);
        const dotMatch = importStatement.match(/using\.\s*(.+)/);
        return curlyMatch ? curlyMatch[1].trim() : dotMatch ? dotMatch[1].trim() : "";
    }

    /** Checks if an import is already in full path format */
    isFullPathImport(importStatement: string): boolean {
        const path = this.extractPathFromImport(importStatement);
        return path.startsWith("/") || path.includes("@fortnite.com");
    }

    /** Checks if an import is a built-in module from Fortnite.com, UnrealEngine.com, or Verse.org */
    isBuiltinModule(importStatement: string): boolean {
        const path = this.extractPathFromImport(importStatement);
        return path.startsWith("/Fortnite.com/") || path.startsWith("/UnrealEngine.com/") || path.startsWith("/Verse.org/");
    }

    /** Extracts the module path and name from an import statement */
    extractModuleFromImport(importStatement: string): { fullPath: string; moduleName: string } | null {
        const pathStr = this.extractPathFromImport(importStatement);
        if (!pathStr) return null;

        // Full path format - extract last segment
        if (pathStr.startsWith("/")) {
            const segments = pathStr.split("/").filter((s) => s);
            const lastSegment = segments[segments.length - 1];
            const moduleName = lastSegment.includes("@") ? lastSegment.split("@")[0] : lastSegment;
            return { fullPath: pathStr, moduleName };
        }

        // Dot notation (e.g., HUD.Textures -> HUD/Textures)
        const identPattern = /[A-Za-z_][A-Za-z0-9_]*(?:'[^']*')?/g;
        const dotSegments: string[] = [];
        let match;
        const tempPath = pathStr.replace(/\s+/g, "");
        while ((match = identPattern.exec(tempPath)) !== null) {
            dotSegments.push(match[0]);
        }

        if (dotSegments.length === 0) {
            const simpleSplit = pathStr
                .split(".")
                .map((s) => s.trim())
                .filter((s) => s);
            if (simpleSplit.length === 0) return null;
            return { fullPath: simpleSplit.join("/"), moduleName: simpleSplit[simpleSplit.length - 1] };
        }

        return { fullPath: dotSegments.join("/"), moduleName: dotSegments[dotSegments.length - 1] };
    }

    /** Returns module name for display (shows full dot notation for relative imports) */
    extractModuleName(importStatement: string): string | null {
        const result = this.extractModuleFromImport(importStatement);
        if (!result) return null;

        const pathStr = this.extractPathFromImport(importStatement);
        // For relative imports, show full path as-is for display
        if (pathStr && !pathStr.startsWith("/")) return pathStr;
        return result.moduleName;
    }

    /** Parses explicit module definitions from Verse file content */
    parseExplicitModuleDefinition(content: string): string[] {
        const modules: string[] = [];
        const moduleDefPattern = /\b([A-Za-z_][A-Za-z0-9_]*(?:'[^']*')?)\s*(?:<\s*(?:public|private|internal|protected)\s*>)?\s*:=\s*module\s*[:>]/gm;
        let match;
        while ((match = moduleDefPattern.exec(content)) !== null) {
            modules.push(match[1]);
        }
        return modules;
    }

    /** Scans the workspace for possible locations of a module */
    async findModuleLocations(modulePath: string, currentFileUri?: vscode.Uri, maxDepth: number = 5): Promise<string[]> {
        const locations: string[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return locations;

        const pathSegments = modulePath.split("/").filter((s) => s);
        const moduleName = pathSegments[pathSegments.length - 1];

        // Try cache lookup first for faster results
        if (this.projectPathCache) {
            const cachedLocations = this.projectPathCache.lookupModulePath(modulePath);
            if (cachedLocations.length > 0) {
                logger.debug("ImportPathConverter", `Found ${cachedLocations.length} locations from cache for '${modulePath}'`);
                return cachedLocations;
            }
            logger.debug("ImportPathConverter", `No cache hit for '${modulePath}', falling back to filesystem scan`);
        }

        // Phase 1: Search for folders (implicit modules) in Content folder
        try {
            logger.debug("ImportPathConverter", `Searching for module '${modulePath}'`);

            if (currentFileUri) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentFileUri);
                if (workspaceFolder) {
                    const currentFilePath = path.relative(workspaceFolder.uri.fsPath, currentFileUri.fsPath).replace(/\\/g, "/");
                    let currentFileDir = path.dirname(currentFilePath).replace(/\\/g, "/");

                    // Check if workspace IS the Content folder
                    const workspaceFolderName = path.basename(workspaceFolder.uri.fsPath);
                    const workspaceFolderIsContent = workspaceFolderName === "Content";

                    // Normalize paths when workspace IS Content
                    if (workspaceFolderIsContent) {
                        currentFileDir = currentFileDir === "" || currentFileDir === "." ? "Content" : "Content/" + currentFileDir;
                    }

                    if (currentFileDir.startsWith("Content/") || currentFileDir === "Content") {
                        const dirSegments = currentFileDir.split("/");

                        // Helper to adjust path for filesystem checks
                        const getFsCheckPath = (logicalPath: string): string => {
                            if (workspaceFolderIsContent && logicalPath.startsWith("Content/")) {
                                return logicalPath.substring("Content/".length);
                            }
                            return logicalPath;
                        };

                        // Check sibling modules
                        if (dirSegments.length > 1) {
                            const parentPath = dirSegments.slice(0, dirSegments.length - 1).join("/");
                            const siblingTestPath = `${parentPath}/${modulePath}`;

                            if (siblingTestPath.startsWith("Content/")) {
                                if (await this.folderExists(workspaceFolder, getFsCheckPath(siblingTestPath))) {
                                    const relativePath = parentPath === "Content" ? "" : "/" + parentPath.substring("Content/".length);
                                    if (!locations.includes(relativePath)) locations.push(relativePath);
                                }
                            }
                        }

                        // Ascending directory traversal
                        for (let i = dirSegments.length - 2; i >= 0; i--) {
                            const checkPath = dirSegments.slice(0, i + 1).join("/");
                            const testPath = `${checkPath}/${modulePath}`;

                            if (testPath.startsWith("Content/")) {
                                if (await this.folderExists(workspaceFolder, getFsCheckPath(testPath))) {
                                    const relativePath = checkPath === "Content" ? "" : "/" + checkPath.substring("Content/".length);
                                    if (!locations.includes(relativePath)) locations.push(relativePath);
                                }
                            }
                        }

                        // Check direct Content children
                        const contentDirectChild = `Content/${modulePath}`;
                        if (await this.folderExists(workspaceFolder, getFsCheckPath(contentDirectChild))) {
                            if (!locations.includes("")) locations.push("");
                        }
                    }
                }
            }
        } catch (error) {
            logger.debug("ImportPathConverter", `Error in Phase 1: ${error}`);
        }

        // Phase 2: Search for explicit module definitions in .verse files
        if (locations.length === 0) {
            logger.debug("ImportPathConverter", `Phase 2: Searching explicit module definitions`);
            try {
                let searchPattern = "Content/**/*.verse";
                let phase2WorkspaceIsContent = false;

                if (workspaceFolders && workspaceFolders.length > 0) {
                    const workspaceFolderName = path.basename(workspaceFolders[0].uri.fsPath);
                    phase2WorkspaceIsContent = workspaceFolderName === "Content";
                    if (phase2WorkspaceIsContent) searchPattern = "**/*.verse";
                }

                const verseFiles = await vscode.workspace.findFiles(searchPattern, null, 100);
                const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const modulePattern = new RegExp(`\\b${escapedModuleName}(?:'[^']*')?\\s*(?:<\\s*(?:public|private|internal|protected)\\s*>)?\\s*:=\\s*module\\s*[:>]`, "gm");

                for (const file of verseFiles) {
                    const content = await vscode.workspace.fs.readFile(file).then(
                        (buffer) => Buffer.from(buffer).toString("utf8"),
                        () => null
                    );

                    if (content && modulePattern.test(content)) {
                        logger.debug("ImportPathConverter", `Found module definition in: ${file.fsPath}`);
                        const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
                        if (workspaceFolder) {
                            let relativePath = path.relative(workspaceFolder.uri.fsPath, file.fsPath).replace(/\\/g, "/");
                            relativePath = path.dirname(relativePath).replace(/\\/g, "/");

                            // Normalize path when workspace IS Content
                            if (phase2WorkspaceIsContent) {
                                relativePath = relativePath === "" || relativePath === "." ? "Content" : "Content/" + relativePath;
                            }

                            if (!relativePath.startsWith("Content")) continue;

                            // Remove Content prefix
                            relativePath = relativePath.startsWith("Content/") ? relativePath.substring("Content/".length) : relativePath === "Content" ? "" : relativePath;

                            // For nested paths, verify parent path matches
                            if (pathSegments.length > 1) {
                                const parentPath = pathSegments.slice(0, -1).join("/");
                                if (!relativePath.endsWith(parentPath)) continue;

                                relativePath = relativePath.substring(0, relativePath.length - parentPath.length);
                                if (relativePath.endsWith("/")) relativePath = relativePath.substring(0, relativePath.length - 1);
                            }

                            // Format path
                            if (!relativePath.startsWith("/") && relativePath !== "") relativePath = "/" + relativePath;

                            if (!locations.includes(relativePath)) {
                                locations.push(relativePath);
                            }
                        }
                    }
                }
            } catch (error) {
                logger.debug("ImportPathConverter", `Error searching for explicit module definitions: ${error}`);
            }
        }

        logger.debug("ImportPathConverter", `Module search complete for '${modulePath}'`);
        logger.debug("ImportPathConverter", `Found ${locations.length} possible locations:`);
        if (locations.length > 0) {
            locations.forEach((loc) => logger.debug("ImportPathConverter", `  - Location: '${loc}' (${loc === "" ? "root/Content" : loc})`));
        } else {
            logger.debug("ImportPathConverter", `  - No locations found!`);
        }

        return locations;
    }

    /**
     * Converts a full path import to a relative import
     */
    async convertFromFullPath(importStatement: string): Promise<ImportConversionResult | null> {
        if (this.isBuiltinModule(importStatement)) {
            logger.debug("ImportPathConverter", "Cannot convert built-in module to relative path");
            return null;
        }

        if (!this.isFullPathImport(importStatement)) {
            logger.debug("ImportPathConverter", "Import is not in full path format");
            return null;
        }

        const curlyMatch = importStatement.match(/using\s*\{\s*([^}]+)\s*\}/);
        const dotMatch = importStatement.match(/using\.\s*(.+)/);
        const fullPath = curlyMatch ? curlyMatch[1].trim() : dotMatch ? dotMatch[1].trim() : null;

        if (!fullPath || !fullPath.startsWith("/")) {
            return null;
        }

        const projectVersePath = await this.projectPathHandler.getProjectVersePath();
        if (!projectVersePath) {
            return null;
        }

        let relativePath = fullPath;

        if (fullPath.startsWith(projectVersePath + "/")) {
            relativePath = fullPath.substring(projectVersePath.length + 1);
        } else if (fullPath === projectVersePath) {
            relativePath = "";
        }

        const modulePathSegments = relativePath.split("/").filter((s) => s);
        const relativeImportPath = modulePathSegments.join(".");

        if (!relativeImportPath) {
            logger.debug("ImportPathConverter", "Could not extract relative path from full path");
            return null;
        }

        const usesCurlyBraces = importStatement.includes("{");
        const relativeImport = usesCurlyBraces ? `using { ${relativeImportPath} }` : `using. ${relativeImportPath}`;

        return {
            originalImport: importStatement,
            fullPathImport: relativeImport, // In this case, it's actually the relative import
            moduleName: modulePathSegments[modulePathSegments.length - 1] || relativeImportPath,
            isAmbiguous: false,
        };
    }

    /**
     * Converts all full path imports in a document to relative imports
     */
    async convertAllImportsFromFullPath(document: vscode.TextDocument): Promise<ImportConversionResult[]> {
        const results: ImportConversionResult[] = [];
        const text = document.getText();
        const lines = text.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            const nextLine = i + 1 < lines.length ? lines[i + 1] : undefined;
            if (ImportFormatter.isModuleImport(trimmedLine, nextLine)) {
                if (this.isFullPathImport(trimmedLine) && !this.isBuiltinModule(trimmedLine)) {
                    const result = await this.convertFromFullPath(trimmedLine);
                    if (result) {
                        results.push(result);
                    }
                }
            }
        }

        return results;
    }

    /**
     * Converts a relative import to a full path import
     */
    async convertToFullPath(importStatement: string, documentUri: vscode.Uri): Promise<ImportConversionResult | null> {
        if (this.isFullPathImport(importStatement)) {
            if (this.isBuiltinModule(importStatement)) {
                logger.debug("ImportPathConverter", "Import is a built-in module and should not be converted");
            } else {
                logger.debug("ImportPathConverter", "Import is already in full path format");
            }
            return null;
        }

        const moduleInfo = this.extractModuleFromImport(importStatement);
        if (!moduleInfo) {
            logger.debug("ImportPathConverter", "Could not extract module info from import");
            return null;
        }

        const { fullPath: modulePath, moduleName } = moduleInfo;

        const projectVersePath = await this.projectPathHandler.getProjectVersePath();
        if (!projectVersePath) {
            vscode.window.showWarningMessage("Could not find .uefnproject file in workspace. Please ensure you have a valid UEFN project.");
            return null;
        }

        logger.debug("ImportPathConverter", `Project verse path: ${projectVersePath}`);

        const possibleLocations = await this.findModuleLocations(modulePath, documentUri);
        logger.debug("ImportPathConverter", `findModuleLocations returned ${possibleLocations.length} location(s)`);
        possibleLocations.forEach((loc, idx) => logger.debug("ImportPathConverter", `  Location ${idx}: '${loc}'`));

        const usesCurlyBraces = importStatement.includes("{");

        if (possibleLocations.length === 0) {
            logger.debug("ImportPathConverter", `No locations found for ${modulePath}`);
            vscode.window.showErrorMessage(`Could not find module '${moduleName}'. Please verify the module exists and is properly defined.`);
            return null;
        } else if (possibleLocations.length === 1) {
            const location = possibleLocations[0];
            logger.debug("ImportPathConverter", `Single location found: '${location}'`);

            const fullPath = location === "/" || location === "" ? `${projectVersePath}/${modulePath}` : `${projectVersePath}${location}/${modulePath}`;
            logger.debug("ImportPathConverter", `Constructed full path: ${fullPath}`);

            const fullPathImport = usesCurlyBraces ? `using { ${fullPath} }` : `using. ${fullPath}`;

            return {
                originalImport: importStatement,
                fullPathImport,
                moduleName,
                isAmbiguous: false,
            };
        } else {
            const possiblePaths = possibleLocations.map((location) => {
                return location === "/" || location === "" ? `${projectVersePath}/${modulePath}` : `${projectVersePath}${location}/${modulePath}`;
            });

            return {
                originalImport: importStatement,
                fullPathImport: "", // Will be determined by user selection
                moduleName,
                isAmbiguous: true,
                possiblePaths,
            };
        }
    }

    /**
     * Converts all relative imports in a document to full path imports
     */
    async convertAllImportsInDocument(document: vscode.TextDocument): Promise<ImportConversionResult[]> {
        const results: ImportConversionResult[] = [];
        const text = document.getText();
        const lines = text.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const nextLine = i + 1 < lines.length ? lines[i + 1] : undefined;
            if (ImportFormatter.isModuleImport(line.trim(), nextLine)) {
                const result = await this.convertToFullPath(line.trim(), document.uri);
                if (result) {
                    results.push(result);
                }
            }
        }

        return results;
    }

    /**
     * Applies a conversion result to the document
     */
    async applyConversion(document: vscode.TextDocument, conversion: ImportConversionResult, selectedPath?: string): Promise<boolean> {
        const text = document.getText();
        const lines = text.split("\n");
        let lineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === conversion.originalImport.trim()) {
                lineIndex = i;
                break;
            }
        }

        if (lineIndex === -1) {
            logger.debug("ImportPathConverter", `Could not find import line: ${conversion.originalImport}`);
            return false;
        }

        let finalImport = conversion.fullPathImport;
        if (conversion.isAmbiguous && selectedPath) {
            const usesCurlyBraces = conversion.originalImport.includes("{");
            finalImport = usesCurlyBraces ? `using { ${selectedPath} }` : `using. ${selectedPath}`;
        }

        const edit = new vscode.WorkspaceEdit();
        const range = new vscode.Range(new vscode.Position(lineIndex, 0), new vscode.Position(lineIndex, lines[lineIndex].length));

        const originalIndent = lines[lineIndex].match(/^\s*/)?.[0] || "";
        edit.replace(document.uri, range, originalIndent + finalImport);

        try {
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                logger.debug("ImportPathConverter", `Converted: ${conversion.originalImport} -> ${finalImport}`);
            } else {
                logger.debug("ImportPathConverter", `Failed to apply conversion for: ${conversion.originalImport}`);
            }
            return success;
        } catch (error) {
            logger.debug("ImportPathConverter", `Error applying conversion: ${error}`);
            return false;
        }
    }
}
