/**
 * Configuration types for the Verse Auto Imports extension
 */

export interface GeneralConfig {
    autoImport: boolean;
    diagnosticDelay: number;  // Deprecated
    autoImportDebounceDelay: number;
}

export interface BehaviorConfig {
    importSyntax: 'curly' | 'dot';
    preserveImportLocations: boolean;
    sortImportsAlphabetically: boolean;
    importGrouping: 'none' | 'digestFirst' | 'localFirst';
    ambiguousImports: Record<string, string>;
    multiOptionStrategy: 'quickfix' | 'auto_shortest' | 'auto_first' | 'disabled';
}

export interface QuickFixConfig {
    sortAlphabetically: boolean;
    showDescriptions: boolean;
}

export interface PathConversionConfig {
    enableCodeLens: boolean;
    scanDepth: number;
}

export interface ExperimentalConfig {
    useDigestFiles: boolean;
    unknownIdentifierResolution: 'digest_only' | 'digest_and_inference' | 'disabled';
}

export interface VerseAutoImportsConfig {
    general: GeneralConfig;
    behavior: BehaviorConfig;
    quickFix: QuickFixConfig;
    pathConversion: PathConversionConfig;
    experimental: ExperimentalConfig;
}