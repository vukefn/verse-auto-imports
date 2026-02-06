import * as vscode from "vscode";
import { logger } from "../utils";
import { ImportSuggestion, ImportSuggestionSource, ImportConfidence } from "../types";
import { DigestParser, AssetsDigestParser } from "../services";
import { ImportFormatter } from "./ImportFormatter";

/**
 * Handles parsing error messages and diagnostics to extract import suggestions.
 */
export class ImportSuggestionExtractor {
    private digestParser: DigestParser;
    private formatter: ImportFormatter;
    private assetsDigestParser: AssetsDigestParser | null;

    constructor(
        outputChannel: vscode.OutputChannel,
        formatter: ImportFormatter,
        assetsDigestParser?: AssetsDigestParser,
        extensionContext?: vscode.ExtensionContext
    ) {
        this.digestParser = new DigestParser(outputChannel, extensionContext);
        this.formatter = formatter;
        this.assetsDigestParser = assetsDigestParser || null;
    }

    /**
     * Finds the correct module path from a fully qualified name by checking
     * if any intermediate segments are known asset class names.
     *
     * @param fullName The fully qualified name (e.g., "Ake.UI.UI_UMG.ClassName")
     * @returns The correct module path and class name, or null if invalid
     */
    private findCorrectModulePath(fullName: string): { modulePath: string; className: string } | null {
        const parts = fullName.split(".");
        if (parts.length < 2) {
            return null;
        }

        // Check from second-to-last segment backwards to find asset class names
        // The last segment is always assumed to be the actual identifier being referenced
        for (let i = parts.length - 2; i > 0; i--) {
            const segment = parts[i];

            // Check if this segment is a known asset class name
            if (this.assetsDigestParser?.isAssetClassName(segment)) {
                // This segment is a class, so the module path is everything before it
                const modulePath = parts.slice(0, i).join(".");
                const className = parts[parts.length - 1];

                logger.debug(
                    "ImportSuggestionExtractor",
                    `Found asset class '${segment}' in path '${fullName}'. Module: ${modulePath}, Class: ${className}`
                );

                return { modulePath, className };
            }
        }

        // No asset class found in intermediate segments - use default behavior
        // (last segment is the class, everything else is the module)
        const lastDotIndex = fullName.lastIndexOf(".");
        return {
            modulePath: fullName.substring(0, lastDotIndex),
            className: fullName.substring(lastDotIndex + 1),
        };
    }

    /**
     * Parses error messages for multi-option import suggestions.
     * Handles three patterns:
     * 1. "Did you mean any of:\n<options>"
     * 2. "Did you forget to specify one of:\nusing { /Path }\nusing { /Path }"
     * 3. "Identifier X could be one of many types: (/Path1:)X or (/Path2:)X"
     */
    private parseMultiOptionSuggestions(errorMessage: string): string[] {
        // Pattern 1: "Did you mean any of:\n<options>"
        const multiOptionPattern1 = /Did you mean any of:\s*\n(.+)/s;
        const match1 = errorMessage.match(multiOptionPattern1);

        if (match1) {
            const optionsText = match1[1];
            const options = optionsText
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0);

            logger.debug("ImportSuggestionExtractor", `Found ${options.length} multi-options (pattern 1): ${options.join(", ")}`);
            return options;
        }

        // Pattern 2: "Did you forget to specify one of:\nusing { /Path }\nusing { /Path }"
        const multiOptionPattern2 = /Did you forget to specify one of:\s*\n((?:using \{[^}]+\}\s*\n?)+)/s;
        const match2 = errorMessage.match(multiOptionPattern2);

        if (match2) {
            const optionsText = match2[1];
            const options: string[] = [];

            // Extract all "using { /Path }" patterns
            const usingPattern = /using \{ (\/[^}]+) \}/g;
            let usingMatch;
            while ((usingMatch = usingPattern.exec(optionsText)) !== null) {
                options.push(usingMatch[1]);
            }

            logger.debug("ImportSuggestionExtractor", `Found ${options.length} multi-options (pattern 2): ${options.join(", ")}`);
            return options;
        }

        // Pattern 3: "Identifier X could be one of many types: (/Path1:)X or (/Path2:)X"
        const multiOptionPattern3 = /Identifier \w+ could be one of many types:\s*(.+)/;
        const match3 = errorMessage.match(multiOptionPattern3);

        if (match3) {
            const optionsText = match3[1];
            const options: string[] = [];

            // Extract all "(/Path:)" patterns
            const pathPattern = /\((\/[^:)]+):\)/g;
            let pathMatch;
            while ((pathMatch = pathPattern.exec(optionsText)) !== null) {
                options.push(pathMatch[1]);
            }

            logger.debug("ImportSuggestionExtractor", `Found ${options.length} multi-options (pattern 3): ${options.join(", ")}`);
            return options;
        }

        return [];
    }

    /**
     * Selects the best option from multiple import options based on configuration.
     */
    private selectBestOption(options: string[]): string {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const strategy = config.get<string>("behavior.multiOptionStrategy", "auto_shortest");

        switch (strategy) {
            case "auto_shortest":
                // Return the option with the shortest path
                return options.reduce((shortest, current) => (current.length < shortest.length ? current : shortest));
            case "auto_first":
                return options[0];
            default:
                return options[0]; // fallback
        }
    }

    /**
     * Creates an ImportSuggestion object.
     */
    private createImportSuggestion(importStatement: string, source: ImportSuggestionSource, confidence: ImportConfidence, description?: string): ImportSuggestion {
        const modulePath = this.formatter.extractPathFromImport(importStatement);
        return {
            importStatement,
            source,
            confidence,
            description,
            modulePath: modulePath || undefined,
        };
    }

    /**
     * Looks up an identifier in digest files for import suggestions.
     */
    private async lookupIdentifierInDigest(identifier: string): Promise<ImportSuggestion[]> {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const useDigestFiles = config.get<boolean>("experimental.useDigestFiles", false);
        const preferDotSyntax = config.get<string>("behavior.importSyntax", "curly") === "dot";

        if (!useDigestFiles) {
            return [];
        }

        try {
            const digestEntries = await this.digestParser.lookupIdentifier(identifier);
            const suggestions: ImportSuggestion[] = [];

            for (const entry of digestEntries) {
                if (!entry.modulePath) {
                    continue;
                }

                const importStatement = this.formatter.formatImportStatement(entry.modulePath, preferDotSyntax);
                const confidence: ImportConfidence = entry.identifier === identifier ? "high" : "medium";
                const description = `${entry.type} from ${entry.modulePath}`;

                suggestions.push(this.createImportSuggestion(importStatement, "digest_lookup", confidence, description));
            }

            if (suggestions.length > 0) {
                logger.debug("ImportSuggestionExtractor", `Found ${suggestions.length} digest-based suggestions for: ${identifier}`);
            }

            return suggestions;
        } catch (error) {
            logger.error("ImportSuggestionExtractor", `Error looking up identifier in digest`, error);
            return [];
        }
    }

    /**
     * Extracts import suggestions from an error message.
     * This is the main method for parsing compiler errors.
     */
    async extractImportSuggestions(errorMessage: string): Promise<ImportSuggestion[]> {
        logger.debug("ImportSuggestionExtractor", `Extracting import suggestions from error: ${errorMessage}`);

        // Ignore errors that suggest using 'set' instead of import issues
        if (errorMessage.includes("Did you mean to write 'set")) {
            logger.debug("ImportSuggestionExtractor", `Ignoring 'set' suggestion error`);
            return [];
        }

        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const preferDotSyntax = config.get<string>("behavior.importSyntax", "curly") === "dot";
        const ambiguousImportMappings = config.get<Record<string, string>>("ambiguousImports", {});

        // Check for multi-option "Did you mean any of" pattern first
        const multiOptions = this.parseMultiOptionSuggestions(errorMessage);
        if (multiOptions.length > 0) {
            logger.debug("ImportSuggestionExtractor", `Found multi-option pattern with ${multiOptions.length} options`);
            const suggestions: ImportSuggestion[] = [];

            for (const option of multiOptions) {
                // Check if option is a module path (starts with /)
                if (option.startsWith("/")) {
                    // Direct module path from "using { /Path }" format
                    const importStatement = this.formatter.formatImportStatement(option, preferDotSyntax);

                    logger.trace("ImportSuggestionExtractor", `Multi-option (module path): ${option}`);

                    suggestions.push(this.createImportSuggestion(importStatement, "error_message", "high", `Import from ${option}`));
                } else {
                    // Fully qualified class name (e.g., "Module.ClassName" or "Module.AssetClass.Member")
                    const result = this.findCorrectModulePath(option);
                    if (result && result.modulePath) {
                        const importStatement = this.formatter.formatImportStatement(result.modulePath, preferDotSyntax);

                        logger.debug("ImportSuggestionExtractor", `Multi-option: ${option} -> namespace: ${result.modulePath}, class: ${result.className}`);

                        suggestions.push(this.createImportSuggestion(importStatement, "error_message", "high", `${result.className} from ${result.modulePath}`));
                    } else {
                        // No namespace detected, treat as simple reference
                        const importStatement = this.formatter.formatImportStatement(option, preferDotSyntax);
                        logger.trace("ImportSuggestionExtractor", `Multi-option (no namespace): ${option}`);

                        suggestions.push(this.createImportSuggestion(importStatement, "error_message", "medium", `Import ${option}`));
                    }
                }
            }

            return suggestions;
        }

        // Check for unknown identifier with ambiguous mapping or digest lookup
        const classNameMatch = errorMessage.match(/Unknown identifier `([^`]+)`/);
        if (classNameMatch) {
            const className = classNameMatch[1];

            // Check if this unknown identifier error also includes a specific import suggestion
            // Pattern: "Unknown identifier `editable`. Did you forget to specify using { /Verse.org/Simulation }"
            const specificSuggestionMatch = errorMessage.match(/Unknown identifier `[^`]+`.*Did you forget to specify using \{ (\/[^}]+) \}/s);
            if (specificSuggestionMatch) {
                const path = specificSuggestionMatch[1];
                const importStatement = this.formatter.formatImportStatement(path, preferDotSyntax);
                logger.debug("ImportSuggestionExtractor", `Found specific import suggestion for unknown identifier ${className}: ${importStatement}`);
                return [this.createImportSuggestion(importStatement, "error_message", "high", `Import ${className} from ${path}`)];
            }

            // First check configured ambiguous mappings
            if (ambiguousImportMappings[className]) {
                const preferredPath = ambiguousImportMappings[className];
                const importStatement = this.formatter.formatImportStatement(preferredPath, preferDotSyntax);

                logger.debug("ImportSuggestionExtractor", `Using configured path for ambiguous class ${className}: ${importStatement}`);
                return [this.createImportSuggestion(importStatement, "error_message", "high", `Configured import for ${className}`)];
            }

            // Try digest-based lookup for unknown identifier
            const digestSuggestions = await this.lookupIdentifierInDigest(className);
            if (digestSuggestions.length > 0) {
                logger.debug("ImportSuggestionExtractor", `Found digest-based suggestions for unknown identifier: ${className}`);
                return digestSuggestions;
            }
        }

        // Pattern 1: "Did you forget to specify using { /Path }"
        let match = errorMessage.match(/Did you forget to specify (using \{ \/[^}]+ \})/);
        if (match) {
            const path = match[1].match(/using \{ (\/[^}]+) \}/)?.[1];
            if (path) {
                const importStatement = this.formatter.formatImportStatement(path, preferDotSyntax);
                logger.debug("ImportSuggestionExtractor", `Found import statement: ${importStatement}`);
                return [this.createImportSuggestion(importStatement, "error_message", "high", `Standard import for ${path}`)];
            }
        }

        // Pattern 2: "Did you mean Namespace.Component" (single option)
        match = errorMessage.match(/Did you mean ([^`\n]+)/);
        if (match) {
            const fullName = match[1].trim();
            const result = this.findCorrectModulePath(fullName);
            logger.trace("ImportSuggestionExtractor", `Finding module path for: ${fullName}`);
            if (result && result.modulePath) {
                const importStatement = this.formatter.formatImportStatement(result.modulePath, preferDotSyntax);
                logger.debug("ImportSuggestionExtractor", `Inferred import statement: ${importStatement} (class: ${result.className})`);
                return [this.createImportSuggestion(importStatement, "error_message", "high", `Inferred import for ${fullName}`)];
            }
        }

        logger.debug("ImportSuggestionExtractor", "No import suggestions found in error message");
        return [];
    }

    /**
     * Legacy method for backward compatibility.
     * @deprecated Use extractImportSuggestions instead
     */
    async extractImportStatement(errorMessage: string): Promise<string | null> {
        const suggestions = await this.extractImportSuggestions(errorMessage);
        if (suggestions.length > 0) {
            return suggestions[0].importStatement;
        }
        return null;
    }

    /**
     * Extracts import suggestions from VS Code diagnostics.
     * Parses error messages to find missing imports.
     */
    extractImportsFromDiagnostics(diagnostics: vscode.Diagnostic[]): string[] {
        logger.debug("ImportSuggestionExtractor", `Extracting imports from ${diagnostics.length} diagnostics`);

        const suggestedPaths = new Set<string>();

        for (const diagnostic of diagnostics) {
            const errorMessage = diagnostic.message;

            // Skip non-import related errors
            if (!errorMessage.includes("using") && !errorMessage.includes("Unknown identifier") && !errorMessage.includes("Did you forget") && !errorMessage.includes("Did you mean")) {
                continue;
            }

            // Pattern 0: "Unknown identifier `x`. Did you forget to specify using { /Path }" (combined pattern)
            const unknownWithSuggestionMatch = errorMessage.match(/Unknown identifier `[^`]+`.*Did you forget to specify using \{ (\/[^}]+) \}/s);
            if (unknownWithSuggestionMatch) {
                suggestedPaths.add(unknownWithSuggestionMatch[1]);
                logger.debug("ImportSuggestionExtractor", `Found path from unknown identifier with suggestion: ${unknownWithSuggestionMatch[1]}`);
                continue;
            }

            // Pattern 1: "Did you forget to specify using { /Path }"
            const forgetMatch = errorMessage.match(/Did you forget to specify using \{ (\/[^}]+) \}/);
            if (forgetMatch) {
                suggestedPaths.add(forgetMatch[1]);
                logger.debug("ImportSuggestionExtractor", `Found path from 'forget' pattern: ${forgetMatch[1]}`);
                continue;
            }

            // Pattern 2: Multiple options "Did you forget to specify one of:"
            const multiMatch = errorMessage.match(/Did you forget to specify one of:\s*\n((?:using \{[^}]+\}\s*\n?)+)/s);
            if (multiMatch) {
                const optionsText = multiMatch[1];
                const usingPattern = /using \{ (\/[^}]+) \}/g;
                let usingMatch;
                while ((usingMatch = usingPattern.exec(optionsText)) !== null) {
                    suggestedPaths.add(usingMatch[1]);
                    logger.debug("ImportSuggestionExtractor", `Found path from multi-option: ${usingMatch[1]}`);
                }
                continue;
            }

            // Pattern 3: "Identifier X could be one of many types: (/Path1:)X or (/Path2:)X"
            const identifierMatch = errorMessage.match(/Identifier \w+ could be one of many types:\s*(.+)/);
            if (identifierMatch) {
                const optionsText = identifierMatch[1];
                const pathPattern = /\((\/[^:)]+):\)/g;
                let pathMatch;
                while ((pathMatch = pathPattern.exec(optionsText)) !== null) {
                    suggestedPaths.add(pathMatch[1]);
                    logger.debug("ImportSuggestionExtractor", `Found path from identifier pattern: ${pathMatch[1]}`);
                }
                continue;
            }

            // Pattern 4: "Did you mean Module.Class" - extract module
            const didYouMeanMatch = errorMessage.match(/Did you mean ([^`\n]+)/);
            if (didYouMeanMatch) {
                const fullName = didYouMeanMatch[1].trim();
                const result = this.findCorrectModulePath(fullName);
                if (result && result.modulePath) {
                    // Check if it's an absolute path or relative module
                    if (result.modulePath.startsWith("/")) {
                        suggestedPaths.add(result.modulePath);
                    } else {
                        // For relative modules, we might need to handle them differently
                        // For now, add as-is
                        suggestedPaths.add(result.modulePath);
                    }
                    logger.debug("ImportSuggestionExtractor", `Found path from 'did you mean': ${result.modulePath}`);
                }
            }
        }

        const result = Array.from(suggestedPaths);
        logger.debug("ImportSuggestionExtractor", `Extracted ${result.length} unique import paths from diagnostics`);
        return result;
    }
}
