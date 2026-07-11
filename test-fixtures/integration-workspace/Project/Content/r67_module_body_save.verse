# Regression #67 (PR #73): the on-save import spacing pass must only apply to
# the file-top import block, never inside a module body. The module-scoped
# using below is intentionally NOT followed by a blank line; the pre-fix bug
# inserted one there on save.

using { /Verse.org/Simulation }

r67_utilities := module:
    using { /Verse.org/Random }
    GenerateId<public>():int = GetRandomInt(1, 100)
