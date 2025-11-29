import * as vscode from "vscode";
import { logger } from "../utils/logger";

/**
 * Handles import formatting, syntax preferences, grouping, and path utilities.
 */
export class ImportFormatter {
    /**
     * Formats an import statement using the specified syntax.
     * @param path The module path to import
     * @param useDotSyntax Whether to use dot syntax (using. /path) or curly syntax (using { /path })
     */
    formatImportStatement(path: string, useDotSyntax: boolean): string {
        return useDotSyntax ? `using. ${path.trim()}` : `using { ${path.trim()} }`;
    }

    /**
     * Extracts the module path from an import statement.
     * Handles both curly syntax (using { /path }) and dot syntax (using. /path).
     * @param importStatement The full import statement
     * @returns The extracted path or null if not found
     */
    extractPathFromImport(importStatement: string): string | null {
        const curlyMatch = importStatement.match(/using\s*\{\s*([^}]+)\s*\}/);
        if (curlyMatch) {
            return curlyMatch[1].trim();
        }

        const dotMatch = importStatement.match(/using\.\s*(.+)/);
        if (dotMatch) {
            return dotMatch[1].trim();
        }

        return null;
    }

    /**
     * Determines if an import is a digest import (from Verse.org, Fortnite.com, or UnrealEngine.com).
     * @param importPath The import path or statement to check
     * @returns true if the import is from a digest source, false otherwise
     */
    isDigestImport(importPath: string): boolean {
        // Extract the path if this is a full import statement
        let path = importPath;
        if (importPath.includes("using")) {
            path = this.extractPathFromImport(importPath) || importPath;
        }

        // Get configurable digest prefixes
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const digestPrefixes = config.get<string[]>("behavior.digestImportPrefixes", [
            "/Verse.org/",
            "/Fortnite.com/",
            "/UnrealEngine.com/"
        ]);

        // Check if it's a digest import
        return digestPrefixes.some(prefix => path.startsWith(prefix));
    }

    /**
     * Groups and formats imports based on the configuration settings.
     * @param importPaths Array of import paths to group and format
     * @param preferDotSyntax Whether to use dot syntax for imports
     * @param sortAlphabetically Whether to sort imports alphabetically
     * @param importGrouping The grouping strategy ('none', 'digestFirst', or 'localFirst')
     * @returns Array of formatted import statements with potential empty lines for grouping
     */
    groupAndFormatImports(importPaths: string[], preferDotSyntax: boolean, sortAlphabetically: boolean, importGrouping: string): string[] {
        if (importGrouping === "none") {
            // Legacy behavior: simple alphabetical sort if enabled
            const sortedPaths = sortAlphabetically ? [...importPaths].sort((a, b) => a.localeCompare(b)) : importPaths;
            return sortedPaths.map((path) => this.formatImportStatement(path, preferDotSyntax));
        }

        // New grouping behavior: separate digest and local imports
        const digestImports: string[] = [];
        const localImports: string[] = [];

        for (const path of importPaths) {
            if (this.isDigestImport(path)) {
                digestImports.push(path);
            } else {
                localImports.push(path);
            }
        }

        // Sort within groups if enabled
        if (sortAlphabetically) {
            digestImports.sort((a, b) => a.localeCompare(b));
            localImports.sort((a, b) => a.localeCompare(b));
        }

        // Format the imports
        const formattedDigestImports = digestImports.map((path) => this.formatImportStatement(path, preferDotSyntax));
        const formattedLocalImports = localImports.map((path) => this.formatImportStatement(path, preferDotSyntax));

        // Combine based on configuration
        let formattedImports: string[] = [];
        if (importGrouping === "digestFirst") {
            formattedImports = [...formattedDigestImports];
            // Add spacing between groups if both have imports
            if (formattedDigestImports.length > 0 && formattedLocalImports.length > 0) {
                formattedImports.push(""); // Empty line between groups
            }
            formattedImports.push(...formattedLocalImports);
        } else if (importGrouping === "localFirst") {
            formattedImports = [...formattedLocalImports];
            // Add spacing between groups if both have imports
            if (formattedLocalImports.length > 0 && formattedDigestImports.length > 0) {
                formattedImports.push(""); // Empty line between groups
            }
            formattedImports.push(...formattedDigestImports);
        }

        return formattedImports;
    }
}
