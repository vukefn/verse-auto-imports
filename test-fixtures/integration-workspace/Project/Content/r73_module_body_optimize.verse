# Regression #67 (PR #73): Optimize Imports must leave a module-scoped using
# in place - not hoist it into the file-level import block.

using { /Verse.org/Simulation }
using { /Fortnite.com/Devices }

r73_utilities_optimize := module:
    using { /Verse.org/Random }

    GenerateId<public>():int = GetRandomInt(1, 100)
