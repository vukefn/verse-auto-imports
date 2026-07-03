# Regression #67 (PR #73): a module-scoped using must not be hoisted,
# deleted, or duplicated when auto-import adds a file-level import.

using { /Verse.org/Simulation }

r73_utilities_auto := module:
    using { /Verse.org/Random }

    GenerateId<public>():int = GetRandomInt(1, 100)

r73_probe_auto := class:
    var MaybeButton:?button_device = false
