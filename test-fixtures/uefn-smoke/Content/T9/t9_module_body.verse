# T9 cases D-E: a module-scoped using inside a module body (case D) and the
# indented import style at file level (case E). Both are valid Verse per the
# book (16_modules). Expected with the extension active: NEITHER using is
# moved, deleted, or duplicated by auto-import, Optimize Imports, or saving.

using:
    /Verse.org/Simulation

t9_utilities := module:
    using { /Verse.org/Random }

    T9GenerateId<public>():int = GetRandomInt(1, 100)

T9Probe(Who:agent):void = {}
