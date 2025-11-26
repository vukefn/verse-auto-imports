# Changelog

All notable changes to the "Verse Auto Imports" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.6.0] - Unreleased

### Added

-   **Organized Status Bar Menu**: Menu items are now grouped into logical categories with labeled separators:
    -   Quick Actions, General, Import Behavior, Path Conversion, Experimental, Utilities
-   **CodeLens Visibility Submenu**: Access CodeLens visibility settings directly from the status bar menu
-   **Configurable Empty Lines After Imports**: Control spacing between imports and code
    -   New `behavior.emptyLinesAfterImports` setting (0-5 lines, default: 1)
    -   Automatically applied when saving files, adding new imports, or running "Optimize Imports"
    -   Maintains consistent code formatting across your project
-   **Import Grouping**: Separate digest imports from local imports for better organization
    -   New `behavior.importGrouping` setting with three options:
        -   `"none"` - No grouping (default, maintains backward compatibility)
        -   `"digestFirst"` - Groups digest imports (/Verse.org/, /Fortnite.com/, /UnrealEngine.com/) first, then local imports
        -   `"localFirst"` - Groups local imports first, then digest imports
    -   Automatic blank line separator between groups for visual clarity
    -   Works with both "Optimize Imports" command and auto-import
    -   Respects `sortImportsAlphabetically` setting within each group
    -   Toggle option available in status bar menu
-   **Smart Auto-Import Debouncing**: Auto-imports now wait for you to stop typing before triggering
    -   Prevents distracting imports while actively coding
    -   Configurable delay (default 3 seconds)
    -   Properly cancels pending imports when you continue typing
    -   Each keystroke resets the timer for a smoother coding experience
-   **Enhanced Logging System**: Improved debugging with multi-level logging
    -   Six log levels: TRACE, DEBUG, INFO, WARN, ERROR, FATAL
    -   Dual output channels:
        -   "Verse Auto Imports" - User-facing channel showing INFO+ messages
        -   "Verse Auto Imports - Debug" - Debug channel showing all log levels
    -   **Export Debug Logs**: Export debug logs to a file for sharing or analysis
        -   Access via Status Bar menu → Utilities → Export Debug Logs
        -   Choose save location with native file dialog
        -   Logs up to 10,000 entries in memory
    -   Performance tracking with built-in timers for slow operations
    -   Structured logging with module context and error stack traces
    -   No configuration needed - works out of the box
-   **Full Path Import Conversion**: Added CodeLens support to convert relative imports to full path format
-   **CodeLens Visibility Options**: Configure when path conversion CodeLens appears
    -   `pathConversion.codeLensVisibility`: Choose between `"hover"` (default) or `"always"` visible
    -   `pathConversion.codeLensHideDelay`: Customize how long CodeLens stays visible after leaving hover (default: 1 second)
-   **Project Path Detection**: Automatically detects project Verse path from .uefnproject files
-   **Ambiguous Module Handling**: Smart detection and resolution when modules exist in multiple locations
-   **Batch Conversion**: Convert all imports to full paths with a single command
-   **Configuration Reorganization**: Settings now organized into logical sections for better discoverability
    -   `General`: Core functionality (auto-import, diagnostic delay)
    -   `Import Behavior`: Import handling (syntax, locations, multi-option strategy)
    -   `Quick Fix`: Quick fix menu customization (ordering, descriptions)
    -   `Path Conversion`: Absolute/relative path conversion settings
    -   `Experimental`: Experimental features (digest files)
-   **Path Conversion Toggle**: New setting to enable/disable the path conversion helper
    -   Toggle via Status Bar menu, Settings UI, or Command Palette
    -   Command: `Verse: Toggle Path Conversion Helper`
-   New `general.autoImportDebounceDelay` setting (default: 3000ms)
-   Configuration options for CodeLens visibility and module scan depth
-   Buy Me a Coffee donation option

### Changed

-   **Updated CodeLens Icons**: Path conversion actions now use clearer icons (`$(arrow-both)` for single, `$(arrow-swap)` for bulk) instead of thin arrows for better visibility
-   Default for `preserveImportLocations` changed to `true` (was `false`) - now preserves import locations by default
-   Default for `showDescriptions` changed to `false` (was `true`) - cleaner quick fix menu by default
-   Deprecated `general.diagnosticDelay` in favor of the new clearer naming `autoImportDebounceDelay`
-   **Instant CodeLens Updates**: Path conversion actions now update immediately (no more 1-second delay)
-   **Theme-Aware Status Bar**: Status bar tooltip now uses VS Code theme colors
    -   Automatically adapts to Light, Dark, and High Contrast themes
    -   Native button appearance without unsupported CSS properties

### Configuration Changes

Settings have been reorganized with new names (old settings will need to be updated):

-   `autoImport` → `general.autoImport`
-   `diagnosticDelay` → `general.diagnosticDelay`
-   `importSyntax` → `behavior.importSyntax`
-   `preserveImportLocations` → `behavior.preserveImportLocations`
-   `ambiguousImports` → `behavior.ambiguousImports`
-   `multiOptionStrategy` → `behavior.multiOptionStrategy`
-   `quickFixOrdering` → `quickFix.ordering`
-   `showQuickFixDescriptions` → `quickFix.showDescriptions`
-   `showFullPathCodeLens` → `pathConversion.enableCodeLens`
-   `fullPathScanDepth` → `pathConversion.scanDepth`
-   `useDigestFiles` → `experimental.useDigestFiles`
-   `unknownIdentifierResolution` → `experimental.unknownIdentifierResolution`

### Improved

-   **Smart Snooze Cancellation**: Snooze is now automatically cancelled when auto imports are manually enabled mid-snooze, keeping the UI state consistent with user intent
-   **Faster CodeLens Updates**: Optimized CodeLens refresh performance by eliminating redundant refresh calls
-   Better Timer Management: Enhanced diagnostic handler with proper debouncing mechanism
-   Enhanced Error Detection: Improved handling of "Unknown identifier" errors that include specific import suggestions
-   Backward Compatibility: Legacy `diagnosticDelay` setting still works while transitioning to new `autoImportDebounceDelay`
-   Enhanced import path resolution with workspace-aware scanning
-   Better support for UEFN project structure (Content folder detection)

### Fixed

-   Path normalization in import path converter for better handling of forward/backward slashes
-   Properly removes trailing slashes after stripping module paths
-   Module path conversion now works correctly when workspace folder IS the Content folder (not just containing it)
-   Shows clear error notification when module cannot be found instead of silently producing incorrect paths

### Documentation

-   Updated all configuration examples with new setting names
-   Improved README organization with sectioned settings tables

## [0.5.3] - 2024-10-04

### Fixed

-   Ignore ambiguous data errors suggesting 'set' syntax

## [0.5.2] - 2024-09-30

### Fixed

-   Added support for "Identifier X could be one of many types" error pattern format

## [0.5.1] - 2024-09-30

### Fixed

-   Added support for "Did you forget to specify one of" error pattern format

## [0.5.0] - 2024-09-15

### Added

-   **Multi-Option Quick Fixes**: When VS Code shows "Did you mean any of", you now get separate import options for each possibility
-   **Enhanced Error Recognition**: Improved pattern matching for various Verse compiler error formats
-   **Advanced Configuration**: New settings for fine-tuning extension behavior
-   **Better Import Organization**: Proper spacing and consolidation when moving imports to top
-   **Experimental Digest Integration**: Optional API-based suggestions (disabled by default)

### Improved

-   Fixed multi-option parsing to extract correct namespaces
-   Disabled experimental features by default for better stability
-   Enhanced quick fix menu with confidence indicators and descriptions
-   Better handling of edge cases in import organization

## [0.4.4] - 2024-05-15

### Fixed

-   Fixed detection of custom namespace patterns
-   Disabled module visibility management features
-   Improved error handling and diagnostics

## [0.4.3] - 2024-04-04

### Fixed

-   Fixed outdated error message pattern detection

## [0.4.2] - 2024-03-15

### Added

-   `preserveImportLocations` setting

### Improved

-   Fixed code deletion between scattered import statements
-   Improved import block handling

## [0.4.1] - 2024-03-14

### Added

-   Configurable import syntax (`using { }` vs `using.`)
-   Diagnostic processing delay for better performance
-   Quick fix support for manual import management
-   Ambiguous import handling
-   Improved logging and error handling

## Earlier Versions

See [GitHub Releases](https://github.com/VukeFN/verse-auto-imports/releases) for complete changelog of earlier versions.
