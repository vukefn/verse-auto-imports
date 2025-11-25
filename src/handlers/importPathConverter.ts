import * as vscode from "vscode";
import * as path from "path";
import { ProjectPathHandler } from "./projectPathHandler";
import { logger } from "../utils/logger";

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
            logger.debug("ImportPathConverter", `Starting module search for '${modulePath}'`);

            // If we have current file location, try higher-level directories first
            if (currentFileUri) {
                logger.debug("ImportPathConverter", `Current file URI: ${currentFileUri.fsPath}`);
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentFileUri);
                if (workspaceFolder) {
                    logger.debug("ImportPathConverter", `Workspace folder: ${workspaceFolder.uri.fsPath}`);
                    const currentFilePath = path.relative(workspaceFolder.uri.fsPath, currentFileUri.fsPath).replace(/\\/g, "/");
                    let currentFileDir = path.dirname(currentFilePath).replace(/\\/g, "/");

                    logger.debug("ImportPathConverter", `Current file path: ${currentFilePath}`);
                    logger.debug("ImportPathConverter", `Current file dir (raw): ${currentFileDir}`);

                    // Check if the workspace folder itself IS the Content folder
                    const workspaceFolderName = path.basename(workspaceFolder.uri.fsPath);
                    const workspaceFolderIsContent = workspaceFolderName === "Content";
                    logger.debug("ImportPathConverter", `Workspace folder name: ${workspaceFolderName}, isContent: ${workspaceFolderIsContent}`);

                    // If workspace IS the Content folder, prepend "Content/" to normalize paths
                    // This makes all internal path checks consistent
                    if (workspaceFolderIsContent) {
                        if (currentFileDir === "" || currentFileDir === ".") {
                            currentFileDir = "Content";
                        } else {
                            currentFileDir = "Content/" + currentFileDir;
                        }
                        logger.debug("ImportPathConverter", `Adjusted current file dir (workspace is Content): ${currentFileDir}`);
                    }

                    logger.debug("ImportPathConverter", `Current file dir: ${currentFileDir}`);

                    // Only proceed if current file is in Content folder
                    if (currentFileDir.startsWith("Content/") || currentFileDir === "Content") {
                        logger.debug("ImportPathConverter", `File is in Content folder, proceeding with search`);

                        // Try ascending directory traversal (parent directories)
                        const dirSegments = currentFileDir.split("/");
                        logger.debug("ImportPathConverter", `Directory segments: [${dirSegments.join(", ")}]`);

                        // Helper to get the filesystem path for folder existence check
                        // When workspace IS Content, we need to strip "Content/" from the path
                        const getFsCheckPath = (logicalPath: string): string => {
                            if (workspaceFolderIsContent && logicalPath.startsWith("Content/")) {
                                return logicalPath.substring("Content/".length);
                            }
                            return logicalPath;
                        };

                        // FIRST: Check for sibling modules (same parent directory)
                        if (dirSegments.length > 1) {
                            // Get parent directory (e.g., Content/Components for Content/Components/VotingComponent)
                            const parentPath = dirSegments.slice(0, dirSegments.length - 1).join("/");
                            const siblingTestPath = `${parentPath}/${modulePath}`;

                            logger.debug("ImportPathConverter", `Parent path: ${parentPath}`);
                            logger.debug("ImportPathConverter", `Checking for sibling module at: ${siblingTestPath}`);

                            if (siblingTestPath.startsWith("Content/")) {
                                // Use fs.stat to check if the folder exists
                                const fsCheckPath = getFsCheckPath(siblingTestPath);
                                logger.debug("ImportPathConverter", `Filesystem check path: ${fsCheckPath}`);
                                const folderExists = await this.folderExists(workspaceFolder, fsCheckPath);

                                if (folderExists) {
                                    logger.debug("ImportPathConverter", `Found sibling module folder at: ${siblingTestPath}`);

                                    // Extract the path after "Content/" or set to empty if at Content root
                                    let relativePath = "";
                                    if (parentPath === "Content") {
                                        relativePath = "";
                                    } else if (parentPath.startsWith("Content/")) {
                                        relativePath = "/" + parentPath.substring("Content/".length);
                                    }
                                    logger.debug("ImportPathConverter", `Calculated relative path for sibling: ${relativePath}`);

                                    if (!locations.includes(relativePath)) {
                                        locations.push(relativePath);
                                        logger.debug("ImportPathConverter", `Added sibling module location: ${relativePath}`);
                                    }
                                }
                            }
                        }

                        // THEN: Try ascending directory traversal (parent directories)
                        for (let i = dirSegments.length - 2; i >= 0; i--) { // Start from grandparent
                            const checkPath = dirSegments.slice(0, i + 1).join("/");
                            const testPath = `${checkPath}/${modulePath}`;

                            // Only search if still within Content folder
                            if (testPath.startsWith("Content/")) {
                                // Use fs.stat to check if the folder exists
                                const fsCheckPath = getFsCheckPath(testPath);
                                const folderExists = await this.folderExists(workspaceFolder, fsCheckPath);

                                if (folderExists) {
                                    // Found in a parent directory
                                    logger.debug("ImportPathConverter", `Found module folder at checkPath: ${checkPath}, testPath: ${testPath}`);

                                    // Extract the path after "Content/" or set to empty if at Content root
                                    let relativePath = "";
                                    if (checkPath === "Content") {
                                        relativePath = "";
                                    } else if (checkPath.startsWith("Content/")) {
                                        relativePath = "/" + checkPath.substring("Content/".length);
                                    }
                                    logger.debug("ImportPathConverter", `Calculated relative path: ${relativePath}`);

                                    if (!locations.includes(relativePath)) {
                                        locations.push(relativePath);
                                        logger.debug("ImportPathConverter", `Found module in parent directory: ${relativePath}`);
                                    }
                                }
                            }
                        }

                        // ALSO: Check all direct children of Content folder (they are public)
                        const contentDirectChild = `Content/${modulePath}`;
                        logger.debug("ImportPathConverter", `Checking direct child of Content: ${contentDirectChild}`);

                        const fsCheckPathDirect = getFsCheckPath(contentDirectChild);
                        if (await this.folderExists(workspaceFolder, fsCheckPathDirect)) {
                            logger.debug("ImportPathConverter", `Found module as direct child of Content: ${contentDirectChild}`);

                            if (!locations.includes("")) {
                                locations.push("");
                                logger.debug("ImportPathConverter", `Added Content direct child location (empty string for root)`);
                            }
                        } else {
                            logger.debug("ImportPathConverter", `Module not found as direct child of Content`);
                        }
                    } else {
                        logger.debug("ImportPathConverter", `File is NOT in Content folder: ${currentFileDir}`);
                    }
                } else {
                    logger.debug("ImportPathConverter", `Could not get workspace folder for: ${currentFileUri.fsPath}`);
                }
            } else {
                logger.debug("ImportPathConverter", `No current file URI provided for context-aware search`);
            }

            // Skip the general wildcard search since we've already done targeted checks
            // The sibling check, ascending traversal, and Content direct children check
            // should handle all common cases. For deeper nested modules, the explicit
            // module definition search (Phase 2) will handle them.
        } catch (error) {
            logger.debug("ImportPathConverter", `Error searching for folder module: ${error}`);
        }

        // Phase 2: Search for explicit module definitions in .verse files (only if Phase 1 didn't find enough)
        // Only search in Content folder
        if (locations.length === 0) {
            logger.debug("ImportPathConverter", `Phase 1 found no locations, starting Phase 2: searching for explicit module definitions`);
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
                                let relativePath = path.relative(workspaceFolder.uri.fsPath, file.fsPath).replace(/\\/g, "/");
                                relativePath = path.dirname(relativePath).replace(/\\/g, "/");

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
    async convertFromFullPath(importStatement: string, documentUri: vscode.Uri): Promise<ImportConversionResult | null> {
        // Check if it's a built-in module (should not be converted)
        if (this.isBuiltinModule(importStatement)) {
            logger.debug("ImportPathConverter", "Cannot convert built-in module to relative path");
            return null;
        }

        // Check if it's actually a full path
        if (!this.isFullPathImport(importStatement)) {
            logger.debug("ImportPathConverter", "Import is not in full path format");
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
            logger.debug("ImportPathConverter", "Could not extract relative path from full path");
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
                logger.debug("ImportPathConverter", "Import is a built-in module and should not be converted");
            } else {
                logger.debug("ImportPathConverter", "Import is already in full path format");
            }
            return null;
        }

        // Extract module path and name
        const moduleInfo = this.extractModuleFromImport(importStatement);
        if (!moduleInfo) {
            logger.debug("ImportPathConverter", "Could not extract module info from import");
            return null;
        }

        const { fullPath: modulePath, moduleName } = moduleInfo;

        // Get project verse path
        const projectVersePath = await this.projectPathHandler.getProjectVersePath();
        if (!projectVersePath) {
            vscode.window.showWarningMessage("Could not find .uefnproject file in workspace. Please ensure you have a valid UEFN project.");
            return null;
        }

        logger.debug("ImportPathConverter", `Project verse path: ${projectVersePath}`);

        // Find possible module locations, using current file location for smarter inference
        const possibleLocations = await this.findModuleLocations(modulePath, documentUri);
        logger.debug("ImportPathConverter", `findModuleLocations returned ${possibleLocations.length} location(s)`);
        possibleLocations.forEach((loc, idx) => logger.debug("ImportPathConverter", `  Location ${idx}: '${loc}'`));

        // Determine if import is using curly braces or dot notation
        const usesCurlyBraces = importStatement.includes("{");

        if (possibleLocations.length === 0) {
            // No specific location found, try to infer from common patterns
            logger.debug("ImportPathConverter", `No locations found for ${modulePath}, attempting to infer location`);

            // Try common patterns based on current file location
            if (documentUri) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
                if (workspaceFolder) {
                    const currentFilePath = path.relative(workspaceFolder.uri.fsPath, documentUri.fsPath).replace(/\\/g, "/");
                    let currentFileDir = path.dirname(currentFilePath).replace(/\\/g, "/");

                    // Check if workspace folder IS the Content folder
                    const workspaceFolderName = path.basename(workspaceFolder.uri.fsPath);
                    const workspaceFolderIsContent = workspaceFolderName === "Content";

                    // If workspace IS the Content folder, prepend "Content/" to normalize paths
                    if (workspaceFolderIsContent) {
                        if (currentFileDir === "" || currentFileDir === ".") {
                            currentFileDir = "Content";
                        } else {
                            currentFileDir = "Content/" + currentFileDir;
                        }
                    }

                    // If we're in Content/Something/Module, try Content/Something as a base path
                    if (currentFileDir.startsWith("Content/")) {
                        const dirSegments = currentFileDir.split("/");
                        if (dirSegments.length > 2) {
                            // Try using the parent's parent as the base (e.g., Content/Components)
                            const inferredBase = dirSegments.slice(0, dirSegments.length - 1).join("/");
                            const inferredLocation = inferredBase.substring("Content/".length);
                            const inferredFullPath = `${projectVersePath}/${inferredLocation}/${modulePath}`;

                            logger.debug("ImportPathConverter", `Inferred path: ${inferredFullPath} based on current file location`);

                            const fullPathImport = usesCurlyBraces ? `using { ${inferredFullPath} }` : `using. ${inferredFullPath}`;
                            return {
                                originalImport: importStatement,
                                fullPathImport,
                                moduleName,
                                isAmbiguous: false,
                            };
                        }
                    }
                }
            }

            // Fallback: use the module path directly (original behavior)
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
            logger.debug("ImportPathConverter", `Could not find import line: ${conversion.originalImport}`);
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
