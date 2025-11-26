<div align="center">

**This is project is built and maintained for free for the Verse community.**
**If you find it helpful, consider supporting its development!**

<a href="https://www.paypal.com/donate/?hosted_button_id=SANPYNE27HHYA">
  <img src="https://raw.githubusercontent.com/aha999/DonateButtons/master/Paypal.png" alt="Donate via PayPal" width="180" style="vertical-align: middle;"/>
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://buymeacoffee.com/vukefn">
  <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee" width="180" style="vertical-align: middle;"/>
</a>

</div>

---

# Verse Auto Imports

**Intelligent import management for Verse development in UEFN**

Stop manually managing imports in your Verse code. This extension automatically detects missing imports, provides smart suggestions, and keeps your code organized with zero configuration.

![Demo of auto-importing](https://i.ibb.co/cKx35ymv/demo.gif)

## Key Features

-   **Automatic Import Detection** - Detects missing imports in real-time as you code
-   **Multi-Option Quick Fixes** - Choose from multiple import options when VS Code finds ambiguous identifiers
-   **Full Path Conversion** - Convert relative imports to full path format with CodeLens (NEW!)
-   **Smart Error Recognition** - Enhanced pattern matching for various Verse compiler errors
-   **Zero Configuration** - Works perfectly out of the box with sensible defaults
-   **Import Organization** - Automatically sorts and consolidates imports with proper spacing
-   **Flexible Configuration** - Customize behavior to match your coding style

## Quick Start

### Installation

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for "Verse Auto Imports"
4. Click Install

### Basic Usage

Just start coding! The extension works automatically:

```verse
# Type this - you'll get an error for missing import
if(MyCharacter := Player.GetFortCharacter[]){}

# Extension automatically adds: using { /Fortnite.com/Characters }
# Or shows you quick fix options to choose from!
```

**That's it!** The extension handles the rest automatically.

## Features

### Automatic Import Detection

When you use an identifier that needs an import, like `player` or `creative_device`, the Verse compiler shows an error. The extension:

1. **Detects** the error pattern
2. **Extracts** the required import information
3. **Adds** the import automatically or **shows quick fix options**

### Multi-Option Quick Fixes

When VS Code encounters ambiguous identifiers, you get **multiple import options**:

```verse
// When you type this:
MyComponent : some_component = some_component{}

// And VS Code shows: "Did you mean any of: GameFramework.some_component, UI.Components.some_component"
// You'll see quick fix options:
// Add import: using { GameFramework } (some_component from GameFramework)
// Add import: using { UI.Components } (some_component from UI.Components)
```

**How to use:**

1. Hover over the error (red squiggly line)
2. Click the lightbulb 💡 or press `Ctrl+.`
3. Choose the import option you want

### Auto-Import Debouncing

Auto-imports now wait for you to stop typing before triggering:

-   **Default delay:** 3 seconds (3000ms)
-   **Configurable:** Adjust to your preference
-   **Smart debouncing:** Timer resets when you continue typing

This prevents distracting import suggestions while you're actively coding. The extension waits for the configured duration after your last keystroke before analyzing and auto-importing.

**To customize the delay:**

```json
{
    "verseAutoImports.general.autoImportDebounceDelay": 5000 // Wait 5 seconds instead of 3
}
```

**How it works:**

1. You type code that needs an import
2. Each keystroke cancels any pending auto-import
3. When you stop typing for 3 seconds (configurable)
4. Only then does the auto-import trigger

This makes coding smoother and less distracting!

### Path Conversion (Absolute ↔ Relative)

Convert between relative and absolute import paths with a single click:

```verse
// Before: relative import
using { Textures }

// After: absolute path import
using { /creator@fortnite.com/MyProject/ProjectFiles/Textures }
```

**How it works:**

1. Hover over any import statement line
2. Click "Use absolute path" or "Use relative path" that appears above the import
3. For ambiguous modules (found in multiple locations), choose from a list
4. Or use "Use absolute paths for all" to convert all imports at once

The extension automatically detects your project's Verse path from the `.uefnproject` file.

**Dot Notation Support:**
The extension properly handles Verse's dot notation for nested modules:

-   `using { HUD.Textures }` → searches for `Textures` module in `HUD` folder
-   `using { UI.Components.Button }` → searches for `Button` in `UI/Components` path
-   Converts to full paths like `/vuke@fortnite.com/Project/HUD/Textures`

**Module Detection:**
The extension finds both:

-   **Implicit modules**: Every folder in Content/ is automatically a module
-   **Explicit modules**: Code-defined using `ModuleName := module:` syntax

**Digest Modules:**
The extension skips digest modules that are already in their correct form:

-   `/Fortnite.com/` modules (e.g., `/Fortnite.com/Devices`)
-   `/UnrealEngine.com/` modules (e.g., `/UnrealEngine.com/Temporary/SpatialMath`)
-   `/Verse.org/` modules (e.g., `/Verse.org/Simulation`)

These modules won't show the conversion CodeLens as they don't need to be converted.

**Disabling the Feature:**
If you prefer not to see the path conversion options when hovering:

1. Open the Status Bar menu (click "Auto Imports" in status bar)
2. Toggle "Path Conversion Helper" off
3. Or search for "Path Conversion" in VS Code settings (`Ctrl+,`)

### Manual Import Control

Prefer manual control? Disable auto-import and use quick fixes:

```json
{ "verseAutoImports.general.autoImport": false }
```

Then use `Ctrl+.` on any error to see import options.

### Import Location Control

**Preserved Locations (Default):** Keep existing imports where they are, add new ones at top

```json
{ "verseAutoImports.behavior.preserveImportLocations": true }
```

**Consolidated Imports:** All imports moved to the top, sorted alphabetically

```json
{ "verseAutoImports.behavior.preserveImportLocations": false }
```

### Command Palette

-   **Verse: Optimize Imports** - Sort and organize all imports in current file
-   **Verse: Add Import** - Add a specific import (used by quick fixes)
-   **Verse: Use Absolute Path** - Convert a single import to absolute path format
-   **Verse: Use Absolute Paths for All** - Convert all relative imports to absolute paths
-   **Verse: Use Relative Path** - Convert a single import to relative path format
-   **Verse: Use Relative Paths for All** - Convert all absolute path imports to relative paths

### Ambiguous Import Handling

Configure preferred modules for classes that exist in multiple places:

```json
{
    "verseAutoImports.behavior.ambiguousImports": {
        "vector3": "/UnrealEngine.com/Temporary/SpatialMath",
        "vector2": "/UnrealEngine.com/Temporary/SpatialMath",
        "rotation": "/UnrealEngine.com/Temporary/SpatialMath"
    }
}
```

### Experimental Features

**Digest-Based Suggestions** (opt-in): Enhanced suggestions based on official Verse API documentation

```json
{
    "verseAutoImports.experimental.useDigestFiles": true,
    "verseAutoImports.experimental.unknownIdentifierResolution": "digest_and_inference"
}
```

_Note: These features are experimental and may not always provide accurate suggestions._

## Configuration

Settings are now organized into logical sections for easier navigation. Access via `Ctrl+,` → Search "Verse Auto Imports"

### General

Core functionality settings:

| Setting                           | Default | Description                                                                       |
| --------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `general.autoImport`              | `true`  | Enable/disable automatic importing                                                |
| `general.autoImportDebounceDelay` | `3000`  | Debounce delay (ms) - waits this long after you stop typing before auto-importing |
| `general.diagnosticDelay`         | `1000`  | [Deprecated - use autoImportDebounceDelay] Delay (ms) before processing errors    |

### Import Behavior

Control how imports are handled:

| Setting                              | Default      | Description                               |
| ------------------------------------ | ------------ | ----------------------------------------- |
| `behavior.importSyntax`              | `"curly"`    | Use `using { /Path }` or `using. /Path`   |
| `behavior.preserveImportLocations`   | `true`       | Keep existing imports where they are      |
| `behavior.sortImportsAlphabetically` | `true`       | Sort imports alphabetically               |
| `behavior.importGrouping`            | `"none"`     | Group digest vs local imports (see below) |
| `behavior.emptyLinesAfterImports`    | `1`          | Number of empty lines after imports (0-5) |
| `behavior.multiOptionStrategy`       | `"quickfix"` | How to handle multiple import options     |
| `behavior.ambiguousImports`          | `{...}`      | Preferred paths for ambiguous classes     |

**Import Grouping Options:**

Control how imports are organized and grouped:

```json
{
    "verseAutoImports.behavior.importGrouping": "none" // No grouping (default)
    // "digestFirst"  // Digest imports first, then local imports
    // "localFirst"   // Local imports first, then digest imports
}
```

-   **`"none"`** - All imports are mixed together (legacy behavior)
-   **`"digestFirst"`** - Groups digest imports (`/Verse.org/`, `/Fortnite.com/`, `/UnrealEngine.com/`) first, followed by local imports with a blank line separator
-   **`"localFirst"`** - Groups local imports first, followed by digest imports with a blank line separator

Example with `"digestFirst"`:

```verse
using { /Fortnite.com/Devices }
using { /UnrealEngine.com/Temporary/SpatialMath }
using { /Verse.org/Simulation }

using { ../shared/Utils }
using { ./components/PlayerManager }
using { ./local/CustomDevice }
```

**Empty Lines After Imports:**

Control the spacing between imports and code:

```json
{
    "verseAutoImports.behavior.emptyLinesAfterImports": 1 // Default: 1 empty line
}
```

-   **`0`** - No empty line between imports and code
-   **`1`** - One empty line (default, recommended)
-   **`2-5`** - Multiple empty lines for additional visual separation

This setting is automatically applied:

-   When saving files
-   When adding new imports (auto-import or quick fix)
-   When running "Optimize Imports" command

**Multi-Option Strategies:**

```json
{
    "verseAutoImports.behavior.multiOptionStrategy": "quickfix" // Show quick fix menu (recommended)
    // "auto_shortest"  // Automatically choose shortest path
    // "auto_first"     // Automatically choose first option
    // "disabled"       // Ignore multi-option scenarios
}
```

### Quick Fix

Quick fix menu customization:

| Setting                     | Default        | Description                                   |
| --------------------------- | -------------- | --------------------------------------------- |
| `quickFix.ordering`         | `"confidence"` | Sort by confidence, alphabetical, or priority |
| `quickFix.showDescriptions` | `false`        | Show descriptions in quick fix menu           |

### Path Conversion

Absolute/relative path conversion settings:

| Setting                            | Default   | Description                                                          |
| ---------------------------------- | --------- | -------------------------------------------------------------------- |
| `pathConversion.enableCodeLens`    | `true`    | Show CodeLens actions to convert paths                               |
| `pathConversion.codeLensVisibility`| `"hover"` | When to show CodeLens: `"hover"` or `"always"`                       |
| `pathConversion.codeLensHideDelay` | `1000`    | Milliseconds before hiding CodeLens after leaving hover (hover mode) |
| `pathConversion.scanDepth`         | `5`       | Max directory depth for module scanning                              |

### Experimental

Experimental features (use with caution):

| Setting                                    | Default      | Description                            |
| ------------------------------------------ | ------------ | -------------------------------------- |
| `experimental.useDigestFiles`              | `false`      | ⚠️ Use digest files for suggestions    |
| `experimental.unknownIdentifierResolution` | `"disabled"` | ⚠️ Resolution strategy for unknown IDs |

### Advanced Configuration

All settings with their full paths:

```json
{
    "verseAutoImports.general.autoImport": true,
    "verseAutoImports.general.autoImportDebounceDelay": 3000,
    "verseAutoImports.general.diagnosticDelay": 1000,
    "verseAutoImports.behavior.importSyntax": "curly",
    "verseAutoImports.behavior.preserveImportLocations": true,
    "verseAutoImports.behavior.sortImportsAlphabetically": true,
    "verseAutoImports.behavior.importGrouping": "none",
    "verseAutoImports.behavior.emptyLinesAfterImports": 1,
    "verseAutoImports.behavior.multiOptionStrategy": "quickfix",
    "verseAutoImports.quickFix.ordering": "confidence",
    "verseAutoImports.quickFix.showDescriptions": false,
    "verseAutoImports.pathConversion.enableCodeLens": true,
    "verseAutoImports.pathConversion.codeLensVisibility": "hover",
    "verseAutoImports.pathConversion.codeLensHideDelay": 1000,
    "verseAutoImports.pathConversion.scanDepth": 5,
    "verseAutoImports.experimental.useDigestFiles": false,
    "verseAutoImports.experimental.unknownIdentifierResolution": "disabled"
}
```

## Requirements

-   **VS Code:** 1.85.0 or newer
-   **Environment:** Working with `.verse` files in a UEFN project
-   **Language Server:** Verse language support enabled

## Troubleshooting

**Extension not working?**

1. Ensure you're working with `.verse` files
2. Check that Verse language support is enabled
3. Check the Output panel for logs:
    - `View` → `Output` → `Verse Auto Imports` (shows important messages)
    - `View` → `Output` → `Verse Auto Imports - Debug` (shows detailed debug logs)
4. Export logs for sharing: Status Bar menu → Utilities → Export Debug Logs

**Wrong imports being suggested?**

1. Configure `ambiguousImports` for your preferred modules
2. Adjust `multiOptionStrategy` to get more control
3. Use manual mode with `autoImport: false`

## Contributing

Found a bug or want to contribute? We welcome issues and pull requests!

-   **GitHub Repository:** [verse-auto-imports](https://github.com/VukeFN/verse-auto-imports)
-   **Issues:** Report bugs and request features
-   **Discussions:** Share ideas and get help

## What's New

### Version 0.6.0 - Latest

**Smart Auto-Import Debouncing**

-   Auto-imports now wait for you to stop typing before triggering (default: 3 seconds)
-   Prevents distracting imports while actively coding
-   Each keystroke resets the timer for a smoother coding experience

**Enhanced Logging System**

-   Dual output channels for better debugging:
    -   User channel shows important messages (INFO, WARN, ERROR)
    -   Debug channel shows all details (TRACE, DEBUG, INFO, WARN, ERROR, FATAL)
-   Performance tracking for slow operations
-   Module-specific logging for easier troubleshooting

**Improvements**

-   Enhanced error detection for "Unknown identifier" errors with specific import suggestions
-   Better path normalization in import path converter
-   Backward compatibility for legacy settings

**Configuration Updates**

-   New `general.autoImportDebounceDelay` setting (replaces `diagnosticDelay`)
-   Changed defaults: `preserveImportLocations` now `true`, `showDescriptions` now `false`

---

For the complete version history, see [CHANGELOG.md](CHANGELOG.md).

## License

This project is licensed under a proprietary license. See the [LICENSE.md](LICENSE.md) file for full details.

Copyright © 2025 VukeFN. All rights reserved.
