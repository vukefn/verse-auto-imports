import * as vscode from "vscode";
import * as path from "path";
import { ProjectPathHandler } from "./projectPathHandler";
import { log } from "../utils/logging";

interface ImportConversionResult {
    originalImport: string;
    fullPathImport: string;
    moduleName: string;
    isAmbiguous: boolean;
    possiblePaths?: string[];
}

export class ImportPathConverter {
    private projectPathHandler: ProjectPathHandler;

    constructor(private outputChannel: vscode.OutputChannel) {
        this.projectPathHandler = new ProjectPathHandler(outputChannel);
    }

    /**
     * Validates a path according to official Verse syntax
     * Pattern: /[A-Za-z0-9_][A-Za-z0-9_\-.]*(@[A-Za-z0-9_][A-Za-z0-9_\-.]*)?
     */
    private isValidVersePath(path: string): boolean {
        // Official path pattern from Verse syntax
        const pathPattern = /^\/[A-Za-z0-9_][A-Za-z0-9_\-.]*(\/[A-Za-z0-9_][A-Za-z0-9_\-.]*)*(@[A-Za-z0-9_][A-Za-z0-9_\-.]*)?$/;
        return pathPattern.test(path);
    }

    /**
     * Validates an identifier according to official Verse syntax
     * Pattern: [A-Za-z_][A-Za-z0-9_]*('...')?
     */
    private isValidVerseIdentifier(identifier: string): boolean {
        const identPattern = /^[A-Za-z_][A-Za-z0-9_]*(?:'[^']*')?$/;
        return identPattern.test(identifier);
    }

    /**
     * Checks if an import is already in full path format or is a built-in module
     */
    isFullPathImport(importStatement: string): boolean {
        // Extract the path from the import statement
        const curlyMatch = importStatement.match(/using\s*\{\s*([^}]+)\s*\}/);
        const dotMatch = importStatement.match(/using\.\s*(.+)/);
        const path = curlyMatch ? curlyMatch[1].trim() : dotMatch ? dotMatch[1].trim() : "";

        // Check if it starts with / (full path)
        if (path.startsWith("/")) {
            return true;
        }

        // Check for user project full paths (contain @ symbol, e.g., /vuke@fortnite.com/...)
        if (path.includes("@fortnite.com")) {
            return true;
        }

        return false;
    }

    /**
     * Checks if an import is a built-in module from Fortnite.com, UnrealEngine.com, or Verse.org
     */
    isBuiltinModule(importStatement: string): boolean {
        // Extract the path from the import statement
        const curlyMatch = importStatement.match(/using\s*\{\s*([^}]+)\s*\}/);
        const dotMatch = importStatement.match(/using\.\s*(.+)/);

        const path = curlyMatch ? curlyMatch[1].trim() : dotMatch ? dotMatch[1].trim() : "";

        // Check if it's a built-in module path
        return path.startsWith("/Fortnite.com/") || path.startsWith("/UnrealEngine.com/") || path.startsWith("/Verse.org/");
    }

    /**
     * Extracts the module path and name from an import statement
     * Returns an object with the full module path and the module name
     * Supports apostrophe-escaped identifiers as per official Verse syntax
     */
    extractModuleFromImport(importStatement: string): { fullPath: string; moduleName: string } | null {
        // Handle both formats: using { ModuleName } and using. ModuleName
        const curlyMatch = importStatement.match(/using\s*\{\s*([^}]+)\s*\}/);
        const dotMatch = importStatement.match(/using\.\s*(.+)/);

        const pathStr = curlyMatch ? curlyMatch[1].trim() : dotMatch ? dotMatch[1].trim() : null;

        if (!pathStr) {
            return null;
        }

        // If it's already a full path (starts with /), extract the last segment
        if (pathStr.startsWith("/")) {
            // Official pattern: /[A-Za-z0-9_][A-Za-z0-9_\-.]*(@[A-Za-z0-9_][A-Za-z0-9_\-.]*)?
            const segments = pathStr.split("/").filter((s) => s);
            const lastSegment = segments[segments.length - 1];

            // Extract module name from potential creator@domain format
            const moduleName = lastSegment.includes("@") ? lastSegment.split("@")[0] : lastSegment;

            return {
                fullPath: pathStr,
                moduleName,
            };
        }

        // Handle dot notation (e.g., HUD.Textures becomes HUD/Textures)
        // Support apostrophe-escaped identifiers: [A-Za-z_][A-Za-z0-9_]*('...')?
        const identPattern = /[A-Za-z_][A-Za-z0-9_]*(?:'[^']*')?/g;
        const dotSegments: string[] = [];
        let match;

        // Parse identifiers that may include apostrophe-escaped parts
        const tempPath = pathStr.replace(/\s+/g, "");
        while ((match = identPattern.exec(tempPath)) !== null) {
            dotSegments.push(match[0]);
        }

        if (dotSegments.length === 0) {
            // Fallback to simple split if pattern doesn't match
            const simpleSplit = pathStr
                .split(".")
                .map((s) => s.trim())
                .filter((s) => s);
            if (simpleSplit.length === 0) {
                return null;
            }
            const moduleName = simpleSplit[simpleSplit.length - 1];
            const fullPath = simpleSplit.join("/");
            return { fullPath, moduleName };
        }

        const moduleName = dotSegments[dotSegments.length - 1];
        const fullPath = dotSegments.join("/");

        return {
            fullPath,
            moduleName,
        };
    }

    /**
     * Legacy method for backward compatibility - returns just the module name
     * Also used for display purposes in CodeLens
     */
    extractModuleName(importStatement: string): string | null {
        const result = this.extractModuleFromImport(importStatement);

        if (!result) {
            return null;
        }

        // For display, we want to show the full dot notation if present
        // e.g., "HUD.Textures" instead of just "Textures"
        const curlyMatch = importStatement.match(/using\s*\{\s*([^}]+)\s*\}/);
        const dotMatch = importStatement.match(/using\.\s*(.+)/);
        const pathStr = curlyMatch ? curlyMatch[1].trim() : dotMatch ? dotMatch[1].trim() : null;

        // If it's a relative import (not starting with /), return the full path as-is for display
        if (pathStr && !pathStr.startsWith("/")) {
            return pathStr;
        }

        return result.moduleName;
    }

    /**
     * Parses explicit module definitions from Verse file content
     * Returns array of module names found in the content
     */
    parseExplicitModuleDefinition(content: string): string[] {
        const modules: string[] = [];

        // Pattern to match explicit module definitions (aligned with official Verse syntax)
        // Matches: ModuleName<access> := module: or ModuleName := module:
        // Also supports apostrophe-escaped identifiers
        const moduleDefPattern = /\b([A-Za-z_][A-Za-z0-9_]*(?:'[^']*')?)\s*(?:<\s*(?:public|private|internal|protected)\s*>)?\s*:=\s*module\s*[:>]/gm;

        let match;
        while ((match = moduleDefPattern.exec(content)) !== null) {
            modules.push(match[1]);
        }

        return modules;
    }

    /**
     * Scans the workspace for possible locations of a module
     * Handles both simple module names and nested paths (e.g., HUD/Textures)
     * @param modulePath The module path to search for
     * @param currentFileUri Optional URI of the current file for location-aware searching
     * @param maxDepth Maximum directory depth to scan
     */
    async findModuleLocations(modulePath: string, currentFileUri?: vscode.Uri, maxDepth: number = 5): Promise<string[]> {
        const locations: string[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders || workspaceFolders.length === 0) {
            return locations;
        }

        // Split the module path to get individual segments
        const pathSegments = modulePath.split("/").filter((s) => s);
        const moduleName = pathSegments[pathSegments.length - 1];

        // Phase 1: Search for folders (implicit modules) - ONLY in Content folder
        try {
            // If we have current file location, try higher-level directories first
            if (currentFileUri) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentFileUri);
                if (workspaceFolder) {
                    const currentFilePath = path.relative(workspaceFolder.uri.fsPath, currentFileUri.fsPath);
                    const currentFileDir = path.dirname(currentFilePath).replace(/\\/g, "/");

                    // Only proceed if current file is in Content folder
                    if (currentFileDir.startsWith("Content/") || currentFileDir === "Content") {
                        // Try ascending directory traversal (parent directories)
                        const dirSegments = currentFileDir.split("/");

                        // Start from parent directory and go up
                        for (let i = dirSegments.length - 1; i >= 0; i--) {
                            const checkPath = dirSegments.slice(0, i + 1).join("/");
                            const testPattern = `${checkPath}/${modulePath}`;

                            // Only search if still within Content folder
                            if (testPattern.startsWith("Content/")) {
                                const testFolders = await vscode.workspace.findFiles(testPattern + "/*.verse", "**/node_modules/**", 1);

                                if (testFolders.length > 0) {
                                    // Found in a parent directory
                                    let relativePath = checkPath.replace("Content", "");
                                    if (relativePath.startsWith("/")) {
                                        relativePath = relativePath.substring(1);
                                    }
                                    if (!relativePath.startsWith("/") && relativePath !== "") {
                                        relativePath = "/" + relativePath;
                                    }
                                    if (relativePath === "/") {
                                        relativePath = "";
                                    }

                                    if (!locations.includes(relativePath)) {
                                        locations.push(relativePath);
                                        log(this.outputChannel, `Found module in parent directory: ${relativePath}`);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Search for the module as a folder (implicit module) - ONLY in Content folder
            const folderPattern = `Content/**/${modulePath}`;
            const folders = await vscode.workspace.findFiles(folderPattern + "/*.verse", "**/node_modules/**", 10);

            // Process all found folders
            for (const folder of folders) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(folder);
                if (workspaceFolder) {
                    let relativePath = path.relative(workspaceFolder.uri.fsPath, folder.fsPath);
                    relativePath = path.dirname(relativePath);

                    // Ensure we're within Content folder
                    if (!relativePath.startsWith("Content")) {
                        continue;
                    }

                    // Remove the module path itself from the end
                    // First convert relativePath to forward slashes for consistent comparison
                    relativePath = relativePath.replace(/\\/g, "/");
                    const modulePathNormalized = modulePath; // Keep forward slashes to match relativePath
                    if (relativePath.endsWith(modulePathNormalized)) {
                        relativePath = relativePath.substring(0, relativePath.length - modulePathNormalized.length);
                        // Remove any trailing slashes after stripping the module path
                        if (relativePath.endsWith("/")) {
                            relativePath = relativePath.substring(0, relativePath.length - 1);
                        }
                    }

                    // Remove 'Content' prefix
                    if (relativePath.startsWith("Content/")) {
                        relativePath = relativePath.substring("Content/".length);
                    } else if (relativePath === "Content") {
                        relativePath = "";
                    }

                    // Ensure proper formatting
                    if (!relativePath.startsWith("/") && relativePath !== "") {
                        relativePath = "/" + relativePath;
                    }

                    if (!locations.includes(relativePath)) {
                        locations.push(relativePath);
                    }
                }
            }
        } catch (error) {
            log(this.outputChannel, `Error searching for folder module: ${error}`);
        }

        // Phase 2: Search for explicit module definitions in .verse files (only if Phase 1 didn't find enough)
        // Only search in Content folder
        if (locations.length === 0) {
            try {
                // Look for pattern like "ModuleName := module" in .verse files - ONLY in Content folder
                const verseFiles = await vscode.workspace.findFiles("Content/**/*.verse", "**/node_modules/**", 100);

                for (const file of verseFiles) {
                    const content = await vscode.workspace.fs.readFile(file).then(
                        (buffer) => Buffer.from(buffer).toString("utf8"),
                        () => null
                    );

                    if (content) {
                        // Pattern to match explicit module definitions (aligned with official Verse syntax)
                        // Supports: ModuleName<access> := module: or ModuleName := module:
                        // Where access can be public, private, internal, etc.
                        // Also supports apostrophe-escaped identifiers
                        const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        const modulePattern = new RegExp(`\\b${escapedModuleName}(?:'[^']*')?\\s*(?:<\\s*(?:public|private|internal|protected)\\s*>)?\\s*:=\\s*module\\s*[:>]`, "gm");

                        if (modulePattern.test(content)) {
                            const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
                            if (workspaceFolder) {
                                let relativePath = path.relative(workspaceFolder.uri.fsPath, file.fsPath);
                                relativePath = path.dirname(relativePath);

                                // Convert to forward slashes
                                relativePath = relativePath.replace(/\\/g, "/");

                                // Ensure we're within Content folder
                                if (!relativePath.startsWith("Content")) {
                                    continue;
                                }

                                // Remove 'Content' prefix
                                if (relativePath.startsWith("Content/")) {
                                    relativePath = relativePath.substring("Content/".length);
                                } else if (relativePath === "Content") {
                                    relativePath = "";
                                }

                                // Build the full module path based on parent folders
                                // If we're looking for HUD/Textures and found Textures module in HUD folder, it's a match
                                if (pathSegments.length > 1) {
                                    // Check if the parent path matches
                                    const parentPath = pathSegments.slice(0, -1).join("/");
                                    if (!relativePath.endsWith(parentPath)) {
                                        continue; // Skip if parent path doesn't match
                                    }

                                    // Remove the parent path from the relative path
                                    if (relativePath.endsWith(parentPath)) {
                                        relativePath = relativePath.substring(0, relativePath.length - parentPath.length);
                                        if (relativePath.endsWith("/")) {
                                            relativePath = relativePath.substring(0, relativePath.length - 1);
                                        }
                                    }
                                }

                                // Ensure proper formatting
                                if (!relativePath.startsWith("/") && relativePath !== "") {
                                    relativePath = "/" + relativePath;
                                }

                                if (!locations.includes(relativePath)) {
                                    locations.push(relativePath);
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                log(this.outputChannel, `Error searching for explicit module definitions: ${error}`);
            }
        }

        log(this.outputChannel, `Found ${locations.length} possible locations for module '${modulePath}'`);
        locations.forEach((loc) => log(this.outputChannel, `  - ${loc}`));

        return locations;
    }

    /**
     * Converts a full path import to a relative import
     */
    async convertFromFullPath(importStatement: string, documentUri: vscode.Uri): Promise<ImportConversionResult | null> {
        // Check if it's a built-in module (should not be converted)
        if (this.isBuiltinModule(importStatement)) {
            log(this.outputChannel, "Cannot convert built-in module to relative path");
            return null;
        }

        // Check if it's actually a full path
        if (!this.isFullPathImport(importStatement)) {
            log(this.outputChannel, "Import is not in full path format");
            return null;
        }

        // Extract the full path from the import statement
        const curlyMatch = importStatement.match(/using\s*\{\s*([^}]+)\s*\}/);
        const dotMatch = importStatement.match(/using\.\s*(.+)/);
        const fullPath = curlyMatch ? curlyMatch[1].trim() : dotMatch ? dotMatch[1].trim() : null;

        if (!fullPath || !fullPath.startsWith("/")) {
            return null;
        }

        // Get project verse path to strip from the full path
        const projectVersePath = await this.projectPathHandler.getProjectVersePath();
        if (!projectVersePath) {
            return null;
        }

        // Extract relative module path by removing the project path prefix
        let relativePath = fullPath;

        // Remove project path prefix (e.g., /vuke@fortnite.com/Project/)
        if (fullPath.startsWith(projectVersePath + "/")) {
            relativePath = fullPath.substring(projectVersePath.length + 1);
        } else if (fullPath === projectVersePath) {
            // Root module
            relativePath = "";
        }

        // Convert path segments to dot notation if applicable
        // e.g., UI/Components/Button becomes UI.Components.Button
        const modulePathSegments = relativePath.split("/").filter((s) => s);
        const relativeImportPath = modulePathSegments.join(".");

        if (!relativeImportPath) {
            log(this.outputChannel, "Could not extract relative path from full path");
            return null;
        }

        // Determine if import was using curly braces or dot notation
        const usesCurlyBraces = importStatement.includes("{");

        // Create the relative import statement
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

            if (trimmedLine.startsWith("using")) {
                // Only convert non-builtin full path imports
                if (this.isFullPathImport(trimmedLine) && !this.isBuiltinModule(trimmedLine)) {
                    const result = await this.convertFromFullPath(trimmedLine, document.uri);
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
        // Check if already full path
        if (this.isFullPathImport(importStatement)) {
            if (this.isBuiltinModule(importStatement)) {
                log(this.outputChannel, "Import is a built-in module and should not be converted");
            } else {
                log(this.outputChannel, "Import is already in full path format");
            }
            return null;
        }

        // Extract module path and name
        const moduleInfo = this.extractModuleFromImport(importStatement);
        if (!moduleInfo) {
            log(this.outputChannel, "Could not extract module info from import");
            return null;
        }

        const { fullPath: modulePath, moduleName } = moduleInfo;

        // Get project verse path
        const projectVersePath = await this.projectPathHandler.getProjectVersePath();
        if (!projectVersePath) {
            vscode.window.showWarningMessage("Could not find .uefnproject file in workspace. Please ensure you have a valid UEFN project.");
            return null;
        }

        // Find possible module locations, using current file location for smarter inference
        const possibleLocations = await this.findModuleLocations(modulePath, documentUri);

        // Determine if import is using curly braces or dot notation
        const usesCurlyBraces = importStatement.includes("{");

        if (possibleLocations.length === 0) {
            // No specific location found, use the module path directly
            const fullPath = `${projectVersePath}/${modulePath}`;
            const fullPathImport = usesCurlyBraces ? `using { ${fullPath} }` : `using. ${fullPath}`;

            return {
                originalImport: importStatement,
                fullPathImport,
                moduleName,
                isAmbiguous: false,
            };
        } else if (possibleLocations.length === 1) {
            // Single location found
            const location = possibleLocations[0];
            const fullPath = location === "/" || location === "" ? `${projectVersePath}/${modulePath}` : `${projectVersePath}${location}/${modulePath}`;

            const fullPathImport = usesCurlyBraces ? `using { ${fullPath} }` : `using. ${fullPath}`;

            return {
                originalImport: importStatement,
                fullPathImport,
                moduleName,
                isAmbiguous: false,
            };
        } else {
            // Multiple locations found - ambiguous
            const possiblePaths = possibleLocations.map((location) => {
                return location === "/" || location === "" ? `${projectVersePath}/${modulePath}` : `${projectVersePath}${location}/${modulePath}`;
            });

            // Return with all possible paths
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
            if (line.trim().startsWith("using")) {
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

        // Find the line with the original import
        let lineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === conversion.originalImport.trim()) {
                lineIndex = i;
                break;
            }
        }

        if (lineIndex === -1) {
            log(this.outputChannel, `Could not find import line: ${conversion.originalImport}`);
            return false;
        }

        // Determine the final import statement
        let finalImport = conversion.fullPathImport;
        if (conversion.isAmbiguous && selectedPath) {
            const usesCurlyBraces = conversion.originalImport.includes("{");
            finalImport = usesCurlyBraces ? `using { ${selectedPath} }` : `using. ${selectedPath}`;
        }

        // Create the edit
        const edit = new vscode.WorkspaceEdit();
        const range = new vscode.Range(new vscode.Position(lineIndex, 0), new vscode.Position(lineIndex, lines[lineIndex].length));

        // Preserve original indentation
        const originalIndent = lines[lineIndex].match(/^\s*/)?.[0] || "";
        edit.replace(document.uri, range, originalIndent + finalImport);

        try {
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                log(this.outputChannel, `Converted: ${conversion.originalImport} -> ${finalImport}`);
            } else {
                log(this.outputChannel, `Failed to apply conversion for: ${conversion.originalImport}`);
            }
            return success;
        } catch (error) {
            log(this.outputChannel, `Error applying conversion: ${error}`);
            return false;
        }
    }
}
